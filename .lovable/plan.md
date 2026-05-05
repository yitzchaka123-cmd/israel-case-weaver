## What's actually broken

Two distinct problems are stacking on top of each other:

### 1. The assistant kills its own run as a "zombie" (server bug)

In `supabase/functions/assistant-chat/index.ts` (~line 3529–3551), the request handler self-heals by marking **all** `assistant_runs` for the project with `status='running'` as `auto_closed_zombie`. That sweep runs **before** the new placeholder/run row is inserted — but it filters only on `project_id` + `status=running`, with no time floor and no exclusion for the run that's about to start.

Symptom in DB right now for project `ac854710…`:
- User msg `ccbd6bc6` ("Draft all in one shot") inserted at `21:59:04.066`
- `assistant_runs` row started `21:59:03.878`, finished `21:59:04.152` with `error = auto_closed_zombie`
- Assistant placeholder `be3a2a78` still has `metadata.in_progress = true`, `content = ""`
- Edge log shows `[stream-reasoning] openai-responses … effort=low tools=26` AFTER the run was already marked errored

Net effect: the model streams, but the run row it's tied to is already "error", so the client's `useAssistantRun` hook treats the turn as failed (silently, because `auto_closed_zombie` is in the suppressed-errors list), the placeholder bubble is hidden (in_progress + empty content), and the user sees nothing.

This was almost certainly introduced or worsened by the recent "anti-stall nudge" / batching work — the sweep got stricter and now nukes the current turn.

### 2. The preview iframe lost its Vite client

Console: `[vite] server connection lost. Polling for restart…`
Runtime: `Failed to fetch dynamically imported module: …/virtual:tanstack-start-client-entry`

That's a separate transient — `lovable-tagger` failed to resolve `tailwind.config.ts` (this project uses Tailwind v4 via `src/styles.css`, no `tailwind.config.ts` exists), and the dev server hasn't recovered the client entry. A clean reload usually clears it; the fix is to make the tagger tolerant.

## Plan

### A. Fix the self-zombie sweep (root cause of "assistant isn't working")

In `supabase/functions/assistant-chat/index.ts`, change the zombie sweep that runs before creating the new placeholder so it cannot kill the in-flight turn:

1. Add an age floor: only mark prior runs as `auto_closed_zombie` if `started_at < now() - interval '90 seconds'` (well above any realistic concurrent send, well below the 3-min stale ceiling already used elsewhere).
2. Same age floor on the `chat_messages` placeholder cleanup that flips `in_progress=true → false`.
3. Move the sweep to run **after** the new `assistant_runs` row is inserted, and pass that new run's id as an explicit `neq('id', newRunId)` guard for safety.
4. Recover the orphaned placeholder for `be3a2a78-…` once (a one-shot `UPDATE chat_messages SET metadata = jsonb_set(metadata,'{in_progress}','false')`) so the user's current "Draft all in one shot" turn doesn't sit forever on "Starting…".

### B. Make the dev-server tagger non-fatal for Tailwind v4

The repo has no `tailwind.config.ts` (Tailwind v4 uses `@theme` in `src/styles.css`). `lovable-tagger` is throwing because it expects one. Add an empty stub `tailwind.config.ts` exporting `export default {}` so the tagger's esbuild step resolves. This silences the error and lets the Vite client entry rebuild reliably, fixing the "failed to fetch dynamically imported module" in the preview.

### C. Verify

1. After A: send a new message in the project; confirm `assistant_runs` reaches `done` and the assistant bubble fills in.
2. After B: reload preview; confirm no `virtual:tanstack-start-client-entry` error and no tagger esbuild error in `/tmp/dev-server-logs/dev-server.log`.

## Files to edit

- `supabase/functions/assistant-chat/index.ts` — sweep guards (A1–A3) + one-shot recovery insert (A4, can be a small migration instead).
- `tailwind.config.ts` (new, stub) — fix B.

No schema changes required. No client changes required.