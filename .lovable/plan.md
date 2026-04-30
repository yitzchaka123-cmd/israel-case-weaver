## What's actually happening

The bulk job from last night is a ghost. Docs 0–3 generated successfully (~22:38–22:41 UTC). After Doc 3, the background worker died (Worker eviction or unhandled crash) but the `bulk_generation_jobs` row was never closed. The UI keeps showing "Working on: Building Keycard Access Log Extract" because that was the last `current_doc_title` written before death — nothing is actually generating. The frontend then blocks all new bulk runs because it sees `status='running'`.

Root causes:
1. The worker uses `req.waitUntil(...)` — that API does not exist on Deno's `Request`. The fallback is "fire and forget", so when the HTTP response returns the runtime can evict the worker mid-batch. (`generate-image` already uses the correct `globalThis.EdgeRuntime.waitUntil` — `bulk-generate-documents` doesn't.)
2. There is no `finally` / hard-timeout / heartbeat that guarantees the job row gets closed. A killed worker = permanent ghost.
3. There is no per-doc job state, so we can't tell what's pending vs done vs failed without scanning `documents`.
4. `increment_bulk_completed` RPC doesn't exist — every successful doc does a SELECT-then-UPDATE round-trip (works, but slow and not atomic).
5. The assistant's `bulk_generate_documents` tool is fine, but nothing **forces** the assistant to use it for small batches (2, 3, 5 docs). It tends to call `add_documents` / `generate_document` in a loop instead, which is what kept blowing out reasoning rounds.
6. Bulk run UI never asks "skip already-generated or overwrite?" up front in the assistant flow — only in the manual modal.

---

## Fix plan

### 1. Kill the ghost job (data fix, not migration)
Mark the stuck row from 22:37 UTC as `failed` with an explanatory error, so the Documents tab unlocks. Docs 0–3 keep their generated images.

### 2. Make the bulk worker un-killable in the obvious ways
Edit `supabase/functions/bulk-generate-documents/index.ts`:
- Replace `req.waitUntil(...)` with `globalThis.EdgeRuntime.waitUntil(work)` (matches `generate-image` and `assistant-chat`).
- Wrap the entire background `work` body in `try / catch / finally`. The `finally` always closes the job (`completed` / `failed` / `cancelled_stale`) so a crash can never leave `status='running'`.
- Add a hard ceiling (e.g. 25 min). If exceeded, mark the job `failed` with reason "exceeded hard timeout".
- Add a stale-job sweep at the **start** of every bulk kickoff: any row with `status='running'` AND no heartbeat for 4 min → close it as `failed` with reason "auto-closed: stale (no heartbeat)". This unblocks future runs even without the data fix above.

### 3. Add a heartbeat (small migration)
Add two columns to `bulk_generation_jobs`:
- `last_heartbeat_at timestamptz` (default `now()`)
- `cancel_requested boolean` (default `false`)

The worker writes `last_heartbeat_at = now()` before each doc, after each doc, and during the 30s rate-limit sleeps. The worker checks `cancel_requested` between docs and exits cleanly if true.

### 4. Add a "Stop / Resume" UI
In `DocumentsSection.tsx`:
- Show heartbeat age. If stale (>4 min) and not finished → red banner "Looks stuck — last update Xm ago" with a **Force-stop** button that sets `cancel_requested=true` and `status='failed'`.
- After any failed/stale job, show a **Resume remaining** button → kicks a new bulk run with `skipExisting=true`, same scope/mode.
- The "running" guard that blocks new runs softens: if heartbeat is stale, the guard auto-clears the ghost instead of blocking.

### 5. Make the assistant use bulk for any 2+ docs (the part you asked for)
Two changes in `supabase/functions/assistant-chat/index.ts` and the playbook:

**a. Hard rule in the system prompt / playbook (`assistant-playbook.ts`):**
> When generating, drafting, or regenerating **2 or more documents**, you MUST call `bulk_generate_documents`. Calling `generate_document` more than once per turn is forbidden — use the bulk tool with `scope='ids'` and the explicit document_ids. This is non-negotiable; one-shot per-doc calls are only for a single document the user pointed at by name.

**b. Server-side guard (defense in depth):**
After the assistant emits its tool calls in a round, count `generate_document` calls. If ≥2 in the same round (or ≥2 cumulative this turn), reject them with a synthetic tool-result that says: "🛑 You called generate_document N times. Use bulk_generate_documents with scope='ids' and these document_ids: [...]. Re-emit now." The assistant then re-emits a single bulk call.

**c. Mandatory clarifying question for any "all"/multi-doc request:**
Before the assistant calls `bulk_generate_documents`, it must check whether **any** of the target docs already have output for the requested mode (`hebrew_content` for draft, `generated_asset_url` for image, `generated_document_url`/`generated_pdf_url` for document). If yes, it must ask the user **one** question with two buttons:
- **Skip already-done** (`skipExisting: true`) — keep what's there, only fill the gaps.
- **Regenerate everything** (`skipExisting: false`) — overwrite all of them.

This is enforced by:
- Adding an `ask_bulk_overwrite_choice` helper tool the assistant calls when any conflict exists. It writes a `project_notifications` row with `kind='bulk_overwrite_choice'` and two starter prompts, OR posts an interactive question via the existing question system. The assistant then waits for the user's pick before launching the bulk run.
- Updating the playbook so this is the literal flow: detect conflicts → ask → launch bulk.

### 6. Pass the user's image quality through bulk
Right now bulk runs always use the project default. Add `imageModelOverride` and `quality` pass-through in both `bulk-generate-documents` (request body) and `callGenerateDocument`. The Documents bulk modal already has the picker; just wire it through. (Keeps the existing per-doc HIGH-quality background path working — gpt-image-2 high mode goes async, the bulk worker will see `status: 202` and poll `image_generations` instead of treating it as a failure.)

### 7. Per-doc retry visibility
When a doc fails inside a bulk run, write a row to `project_notifications` (already done) **plus** save the error onto the doc itself in a new `last_generation_error` column (small migration) so the user sees a red dot inline next to the doc in the Documents table without opening the bell.

---

## Files I'll change

- `supabase/functions/bulk-generate-documents/index.ts` — `EdgeRuntime.waitUntil`, `try/finally`, heartbeat writes, cancel check, stale sweep, image quality pass-through
- `supabase/functions/assistant-chat/index.ts` — server-side ≥2-call guard + overwrite-question gating
- `supabase/functions/_shared/assistant-playbook.ts` and `src/lib/assistant-playbook.ts` — the "2+ → bulk" rule and the overwrite-question rule
- `src/features/project/DocumentsSection.tsx` — stale banner, Force-stop button, Resume remaining button, soften the running guard
- `src/features/project/useActiveBulkJob.ts` — treat stale heartbeat as not-active
- New migration: add `last_heartbeat_at`, `cancel_requested` to `bulk_generation_jobs`; add `last_generation_error` to `documents`
- One-time data update: close the ghost row from 22:37 UTC

---

## What you'll see after

- The stuck "Bulk generation in progress · 0/41" banner clears.
- "Draft all" / "Generate all" works again immediately.
- If the worker ever crashes again, within ~4 min the UI shows "Looks stuck — Force stop / Resume remaining" instead of locking up overnight.
- When you tell the assistant "draft these 5", "generate images for docs 4–10", "regenerate docs 6 and 7" — it calls `bulk_generate_documents` once, never a per-doc loop.
- Before any multi-doc generation that would overwrite work, the assistant asks: **Skip already-generated** or **Regenerate everything**, with the two buttons. Single-doc generations don't ask.

Approve and I'll implement.