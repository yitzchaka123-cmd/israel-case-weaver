Three independent issues, three fixes.

## 1. Medium case has only 4 suspects

**Why it happens.** There is no difficulty → cast-size guidance anywhere in the assistant playbook. Whatever the model picked on its very first cast-creation turn becomes the locked roster (the `CAST SIZE LOCK (HARD RULE)` at line 451 explicitly forbids re-asking). For your project (`difficulty='medium'`) it picked 4, and that's now permanent unless you say "add a suspect".

**Fix.** In `supabase/functions/assistant-chat/index.ts` system prompt:
- Add a CAST SIZE GUIDANCE block (used only on the *first* roster proposal): easy → 3–4, medium → 5–6, hard → 7–9 suspects. Treat as a strong default, override only on explicit user request.
- Relax the CAST SIZE LOCK: if `difficulty` is medium/hard but `suspects.length < recommendedMin(difficulty)`, the assistant SHOULD proactively offer (via `propose_options`) to add more suspects in one turn — once — rather than silently leaving an under-cast case.

Result: a fresh medium case starts at 5–6, and the existing 4-suspect case will get a one-time "Add 1–2 more suspects?" prompt.

## 2. Suspect portraits don't render in the Suspects UI

**Why it happens.** All 4 rows in `suspects` for this project have `thumbnail_url=null` AND `thumbnail_prompt=null`. The auto-generator in `SuspectsSection.tsx` (line 104) only fires when `thumbnail_prompt` is set; it isn't, so no portrait is ever requested. The `add_suspect` tool schema (line 927) doesn't even accept a `thumbnail_prompt` field, so the assistant has no way to seed one.

**Fix.**
- Extend `add_suspect` (and `update_suspect`) tool schemas in `assistant-chat/index.ts` with optional `thumbnail_prompt` (string, ~40–80 words: photoreal portrait brief). Update the playbook to REQUIRE the assistant to write a portrait prompt for every new suspect (deriving age/look/wardrobe from `summary` + `role_in_case`). When the field is set, `SuspectsSection` already auto-generates the image — no client change needed.
- One-time backfill for the 4 existing suspects: call the assistant tool path or, simpler, add a small backfill helper that the user can trigger from the Suspects panel: a new "Generate missing portraits" button that asks the assistant (via existing `mystudio:assistant-prompt` event) to fill `thumbnail_prompt` for any suspect missing one. (No DB migration; assistant writes the prompts and the existing pipeline takes over.)

## 3. "Reasoning while running" never appears — only after the run ends

**Why it happens.** In `AssistantSection.tsx` (lines 821–858) the live "Thinking…" bubble only renders when the last message is an assistant placeholder with `metadata.in_progress=true` whose `created_at` is **after** the last user message. The optimistic user message we insert on send uses `new Date().toISOString()` (client clock). The server placeholder uses server clock. On mobile (iOS, your current viewport is 647×1705 = phone) clock skew of even a couple of seconds makes `placeholderStale=true`, so we fall back to the static "Starting…" bubble for the entire run. When the run finishes, realtime replaces the optimistic row with the server's user row (server time), and only then does the placeholder appear "newer" — by which time `in_progress` is already false and the reasoning shows up as the final collapsed disclosure on the assistant message.

**Fix.** In `AssistantSection.tsx`:
- Drop the timestamp comparison entirely. While `sending` is true, an in-progress assistant placeholder is by definition the current run (the server only ever has one running placeholder per project at a time, guarded by the run's age-floor sweep we just added). Use the simpler rule: pick the **most recent** assistant message with `metadata.in_progress=true` as the live bubble; if none exists yet, show "Starting…".
- Also tag the optimistic user message with a flag (`metadata.optimistic=true`) and prefer the server-confirmed user message ordering, so we never rely on client `created_at` for ordering decisions.

Result: the streaming "Thinking…" disclosure (with reasoning segments + tool receipts) appears the moment the server inserts the placeholder (~0.5–1.5s after send), and stays live for the whole run.

## Files touched

- `supabase/functions/assistant-chat/index.ts` — playbook (cast-size guidance + portrait-prompt requirement) and tool schemas (`add_suspect`/`update_suspect` gain `thumbnail_prompt`).
- `src/features/project/SuspectsSection.tsx` — small "Generate missing portraits" action that nudges the assistant for any suspect lacking `thumbnail_prompt`.
- `src/features/project/AssistantSection.tsx` — live-bubble selection no longer depends on client-vs-server timestamps; mark optimistic messages.

No DB migrations needed.