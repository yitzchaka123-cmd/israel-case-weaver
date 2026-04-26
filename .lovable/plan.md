# Make the assistant fast

The assistant is slow because of four compounding issues; this plan attacks each one. Target: typical turns drop from **15–30s** to **3–8s**.

---

## 1. Drop reasoning effort to `low` for the assistant chat (BIGGEST WIN)

`supabase/functions/assistant-chat/index.ts` currently passes `reasoningEffort` from `project.ai_reasoning_effort` (default `"medium"`). Every Responses-API round on `gpt-5.2` spends ~2–4s "thinking" before emitting even a tiny tool call.

- Change the **default** for assistant chat to `"low"` (still good for picking next field / formatting Hebrew). Keep `medium`/`high` as opt-in via the existing setting.
- Inside the tool loop, **force `low` for tool-only rounds** (rounds where the previous step was a tool result and we're just bouncing back for the next call). Save `medium` for the *final* prose round. This alone typically cuts 5–10s off a multi-tool turn.

**Expected impact:** −30 to −50% latency per turn.

---

## 2. Stop re-sending the full conversation every turn

`src/features/project/AssistantSection.tsx:265` sends every `chat_messages` row back. After ~25 turns this is huge.

- Send only the **last 16 messages** (configurable). Older context is already baked into project rosters (suspects/docs/envelopes/hints/canvas nodes) which the server prompt re-renders fresh every turn.
- Drop assistant messages that are pure tool-receipts (already-stored side effects) when building the wire payload — keep their final prose only. Implement a small `trimChatForWire(messages)` helper.

**Expected impact:** −20 to −40% latency on long projects, plus lower token spend.

---

## 3. Reduce `MAX_ROUNDS` from 8 → 4 and add an early-exit signal

`assistant-chat/index.ts:1570`. 8 rounds is overkill — and when the model loops, each extra round is a 3–5s wall-clock cost.

- Lower to **4** (3 tool rounds + 1 final prose round). Same as the legacy sync path already uses.
- After round 2, append a short hidden system-style hint: *"You have one tool round left — make remaining calls in a single batch, then write your reply."* The model batches better when it knows.

**Expected impact:** caps worst-case turns at ~4 round-trips instead of 8.

---

## 4. Shrink the system prompt

The prompt is ~30 stitched blocks plus 5 rosters plus claude-skill catalog plus depth picker. Concrete cuts:

- **Skip the rosters when they're empty** (currently emit `"  (none yet)"` 5 times).
- **Cap rosters at 25 rows** instead of 50/100 — the model only needs IDs + short titles to call tools; it doesn't read 100 documents.
- **Inline only the depth block matching the current depth** (express / guided / deep). Today all three are concatenated via `renderPlanningDepthBlock`. Drop the unused two.
- **Move the giant Phase-4 / document-mode lecture behind a phase gate** — only include it when `project.phase` is null/`phase_3`/`phase_3_5`/`phase_4`. Phase-1 turns don't need it.
- **Drop the Claude-skills catalog when the model isn't Anthropic.** Already conditionally loaded but still rendered as a header.

**Expected impact:** −2 to −4s per round (less prompt = less prefill + cheaper reasoning).

---

## 5. Show a "Thinking…" banner immediately

The placeholder INSERT happens but the bubble only renders content at the end. Add a tiny `metadata.stage` field that we update between rounds (`"thinking"`, `"calling update_project"`, `"writing reply"`). The realtime UPDATE on `chat_messages` already triggers a re-render, so the user sees motion within ~1s of pressing Send.

- New metadata field `stage` (string).
- AssistantSection renders `stage` as a small italic line above the spinner when `in_progress=true`.

**Expected impact:** perceived latency drops dramatically even before the actual numbers improve.

---

## 6. Small cleanups

- Cache the resolved playbook + tweaks per `owner_id` for 60s (in-process Map). Right now every turn does an extra `profiles` SELECT.
- Fix the realtime channel re-subscribe with `Math.random()` in `useAssistantRun.ts` — use a stable name `assistant-runs-${projectId}` and rely on `removeChannel` cleanup. The current code creates a new channel every effect cycle.
- Memoize `buildTools(playbook)` per playbook hash so we don't `JSON.parse(JSON.stringify(...))` 30 tool defs every round.

---

## Files to edit

- `supabase/functions/assistant-chat/index.ts` — reasoning tier per round, MAX_ROUNDS, stage updates, prompt trimming, playbook cache, memoized tools
- `supabase/functions/_shared/assistant-playbook.ts` — single-depth `renderPlanningDepthBlock(depth, playbook)` (already takes depth, just stop concatenating all three)
- `src/features/project/AssistantSection.tsx` — trim wire payload to last 16, render `stage` line
- `src/features/project/assistant/useAssistantRun.ts` — stable realtime channel name

No DB migration, no new secrets, no breaking change to existing chats. Models, tools, and behavior stay identical — just faster.
