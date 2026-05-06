
# Assistant chat — debugging three related bugs

You reported three problems:
1. After hitting Send: no "Sent / Thinking" feedback — the bubble and spinner don't appear, then the answer just pops in.
2. When you ask "did you finish generating the documents?", the assistant says it doesn't know — but bulk generation state is in our DB and it should.
3. One answer briefly appears, then disappears and is replaced by a different answer.

Below is what I found and the fixes I'll make.

---

## What's actually happening

### Bug 1 — No "Sent" / "Thinking" feedback
Reading `src/features/project/AssistantSection.tsx` and `src/features/project/assistant/useAssistantRun.ts`:

- `send()` already does an optimistic insert of the user bubble into the React Query cache, AND `useAssistantRun.send()` flips `isRunning=true` BEFORE the fetch.
- The composer + live bubble (lines 821–885) are gated on `sending`. There's a fallback "Starting…" bubble when no in-flight placeholder exists yet.

So the wiring is there, but the live bubble is too quiet (no message-bubble shape, no "✓ Sent" affordance, just a tiny inline loader) and on mobile widths the optimistic user bubble re-renders identically to a real one, so it visually feels like nothing happened. The fallback "Starting…" also shares the same row layout as the eventual placeholder, but because the placeholder INSERT can take 1–3s on slow networks, users perceive a dead window.

### Bug 2 — Assistant doesn't know about bulk document generation
In `supabase/functions/assistant-chat/index.ts` `buildSystemPrompt` (lines ~580–700), the rosters that get injected every turn include suspects, documents, envelopes, hints, canvas nodes, edges count, `proposed_document_set`, `solution_summary`. But there is **no information about `bulk_generation_jobs`** — neither active jobs nor the most recent finished/failed one. So when you ask "did the bulk generation finish?", the model literally has no signal and (correctly, from its POV) says it doesn't know.

There is also no read tool the model could call to fetch this. So the only fix is to inject a "Bulk generation status" block into the system prompt every turn.

### Bug 3 — Answer appears, disappears, then a different answer shows
Two real causes in the server loop:

1. **Round-end overwrite**: `processConversation` writes content to the placeholder row only at the FINAL round. But `flushProgress` updates `tools` and `stage` mid-flight on the same row, with `content: ""` left intact. The client live bubble is keyed on `inFlight` (latest `in_progress=true` assistant message) — once a finalized row arrives, `sending` flips to `false` (via `assistant_runs` realtime), the live bubble unmounts, and the rendered list re-evaluates. There's a small window where the realtime update for `chat_messages` (final content) lags the realtime update for `assistant_runs` (status=done). During that window the live bubble has already vanished but the messages-list hider still sees `in_progress=true && content===""` and hides it → the user sees the message blink out.

2. **Nudge re-runs**: When the model stalls on prose without calling a batch tool (line ~3940), we push a system nudge and run another round. The placeholder row is later UPDATEd with the second-round reply — overwriting whatever brief content snippet may have been visible. Combined with #1 above, you get "answer A → blank → answer B".

---

## Plan

### A. Make "Sent" + "Thinking" feedback unmissable (Bug 1)
- In `AssistantSection.tsx`:
  - Render the optimistic user message with a subtle "Sending…" footer that switches to "Sent" once the realtime DB row replaces the optimistic one.
  - Replace the bare-loader fallback bubble with a proper assistant message bubble shape (rounded card matching `MessageBubble`) showing: animated dots + "Thinking…" + the elapsed seconds counter. This makes the "I sent something, the assistant heard me" state obvious even on mobile.
  - Disable the "Stop" → "Send" flip latency: `sending` already updates synchronously inside `send()`, but verify the Send button visibly converts to the red Square within one paint by setting local React state too, not relying solely on the React Query subscription.

### B. Tell the assistant about bulk generation (Bug 2)
- In `supabase/functions/assistant-chat/index.ts` (`processConversation` rosters fetch around line 3406):
  - Add a parallel query: `supa.from("bulk_generation_jobs").select("id, status, scope, mode, total, completed, failed, started_at, finished_at, error, current_doc_title, cancel_requested").eq("project_id", projectId).order("started_at", { ascending: false }).limit(3)`.
- In `buildSystemPrompt`, render a "Bulk document generation status" section listing:
  - Any `running` job (with progress `completed/total`, current doc, started_at).
  - The most recent finished/failed job (status, completed/total, finished_at, error excerpt).
  - "(none)" if no jobs exist.
- Update the playbook copy to mention: "If the user asks about bulk doc generation status, answer from the Bulk generation section above — never say 'I don't know'."

### C. Stop the answer-overwrite blink (Bug 3)
- In `useAssistantRun.ts` realtime handler:
  - When `assistant_runs` flips to `done`/`error`, do NOT immediately set `isRunning=false`. Instead, kick a one-shot refetch of `chat_messages` and only flip `isRunning=false` once we've confirmed the latest assistant row has `in_progress=false` (or after a 1.2s safety timeout). This eliminates the lag window where both the live bubble and the hidden placeholder are gone.
- In `AssistantSection.tsx` `isHiddenAssistantPlaceholder`:
  - Soften the rule so we don't hide a placeholder that has `tools.length > 0` (it has visible work to show). Today's rule (`in_progress || tools.length===0`) hides any empty-content placeholder even when tools have completed and would otherwise be visible.
- In `assistant-chat/index.ts` nudge path (~line 3940):
  - Before issuing the nudge, do NOT yet update the placeholder `content` from the stalled prose. We already don't, but add a comment + assertion so future edits don't accidentally write partial content that the next round will overwrite.
  - When we do write the FINAL content, do it in a single atomic UPDATE that sets `content`, `metadata.in_progress=false`, AND clears `metadata.stage` in one call (already mostly true — verify both the success and round-budget-exhausted paths).

### D. Cleanup
- Add `"round_budget_exhausted"` and `"empty_model_response"` to the synthetic-error filter in `useAssistantRun.ts` so the error toast + duplicate "⚠️" chat insert don't fire when the server has already written an explanatory message into the placeholder.

---

## Files to edit

- `src/features/project/AssistantSection.tsx` — Sent/Thinking bubbles, hide-rule softening.
- `src/features/project/assistant/useAssistantRun.ts` — defer `isRunning=false` until the final assistant row lands; expand synthetic-error filter.
- `supabase/functions/assistant-chat/index.ts` — fetch & inject bulk_generation_jobs status; double-check final-content write atomicity.
- `supabase/functions/_shared/assistant-playbook.ts` — short rule: "Use the Bulk Generation Status block to answer 'did it finish' questions."
- `.lovable/plan.md` — record the fix.

No DB migrations. No new tables.

Approve and I'll implement.
