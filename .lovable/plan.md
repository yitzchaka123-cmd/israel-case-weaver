## What I tested

I read the chat history, `assistant_runs`, and the live-bubble code path for the project you're on (`8267a98f…`). There are two distinct bugs causing what you're seeing:

### Bug 1 — "Starting to think" appears even though the previous turn already finished

- Run `40135f45` (the one that posted "Drafts mode locked…") has `status='running'` and `finished_at=NULL` in `assistant_runs` — it never closed. The next two runs ran fine, but that row is still "running".
- The assistant message it wrote (`5d64cbdb`) was saved with `metadata.in_progress = true` and never flipped back to `false`, even though it has full content and two later assistant messages exist after it.
- The live "Starting…" bubble in `AssistantSection.tsx` (line 806) finds *any* assistant message with `in_progress: true`. Our recent guard only suppresses it when the *latest* assistant message is settled — but here the latest IS settled, so the guard should fire. Re‑reading: the guard checks `lastAssistant.metadata?.in_progress`. That's `false` on `c502b021`, so the bubble *should* be hidden… unless `sending` flips on before the new user message has rendered, in which case `lastAssistant` is still that older zombie. So the bubble shows the OLD turn's stage/reasoning while a new turn is starting. That's the "still showing starting and everything" you saw.

### Bug 2 — Clicked the button, got the same response back

- Looking at the last 3 assistant turns, the model asked the cast-size question **three times in a row** ("Keep 4 / Expand to 6 / Expand to 7"). Each time you answered "Keep 4 suspects" it acknowledged and then re‑asked the same gate, sometimes paired with a new gate ("draft everything vs draft 5–8"). That's why clicking a button produced "the same thing".
- Also — the message at 15:14 still says "draft Docs **0–40**" (mentions Doc 0 in the user-visible plan), which you told me earlier must never happen.

## Plan

### A. Kill the stale "thinking" bubble for good
1. In `AssistantSection.tsx`, change the live-bubble selection so it only renders when *the very last assistant row* is `in_progress` AND that row was created after the most recent user message. If the last assistant message is settled (or older than the latest user message), render nothing — even while `sending` is true. This eliminates the "shows the previous turn's reasoning" flash.
2. Also clear `inFlight.metadata.reasoning / stage_history` from the live bubble when the bubble is suppressed, so we never reuse stale stages for a new turn.

### B. Self-heal zombie `in_progress` rows
3. In `assistant-chat/index.ts`, when a new run starts for a project, mark any prior `chat_messages` row in that project with `metadata.in_progress = true` as `false` and set `metadata.error = 'auto_closed_zombie'`. Pair this with closing any `assistant_runs` row left in `running` for that project (status='error', error='auto_closed_zombie'). This is what the existing client-side 8‑minute watchdog tries to do, but it's leaving the `chat_messages` row dirty.
4. One-time fix for the current project: close run `40135f45` and clear `in_progress` on message `5d64cbdb` so the UI stops surfacing it as "live".

### C. Stop the model from re-asking confirmed gates
5. In `_shared/assistant-playbook.ts` (and `src/lib/assistant-playbook.ts` mirror), add a hard rule under the Phase 3→4 handoff:
   > Once cast size has been confirmed (suspects table is non-empty AND user has either approved logic OR responded to a previous cast-size `propose_options`), DO NOT re-ask cast size. Treat it as locked. Never call `propose_options` for cast size more than once per project.
6. Same section: add an explicit "single-gate-per-turn" rule — when the user has just answered a `propose_options`, the next assistant turn must move forward (draft / build / generate), not pose another structurally identical gate.
7. Server-side guardrail in `assistant-chat/index.ts`: before persisting an assistant message that contains a `propose_options` whose labels include "Keep N suspects" / "Expand to N suspects", check the prior 3 assistant turns. If the same cast-size options were already posted, strip them from `metadata.options` and rewrite the prose tail to a short "Cast size already confirmed — proceeding." This prevents the loop even if the prompt rule is missed.

### D. Re-enforce the "Doc 0 is invisible" rule
8. Same playbook file: tighten the existing rule to "Never mention Doc 0, Doc zero, the box doc, or any 0-indexed document in user-facing prose, options, or proposed-document titles. The drafting range you communicate is always **Docs 1..N**."
9. Add a server-side scrub in `assistant-chat/index.ts` final-message-write step: regex-strip mentions of "Doc 0", "Doc zero", "Docs 0–", "Doc 0 +" from `content` before insert. Cheap belt-and-suspenders.

### E. Verify
10. After deploy, send "Keep 4 suspects" once more from the same project and confirm: (i) no "Starting…" bubble flashes after the response settles, (ii) the assistant moves forward to actually drafting Doc 1 instead of re-asking cast size, (iii) no "Doc 0" appears in any new message.

## Files

- `src/features/project/AssistantSection.tsx` — tighten live-bubble guard (A1, A2).
- `supabase/functions/assistant-chat/index.ts` — zombie cleanup on new run (B3), cast-size loop guard (C7), Doc 0 scrub (D9).
- `supabase/functions/_shared/assistant-playbook.ts` + `src/lib/assistant-playbook.ts` — rules C5, C6, D8.
- One-time SQL: close run `40135f45`, clear `in_progress` on message `5d64cbdb` for project `8267a98f…` (B4).

Approve and I'll implement.