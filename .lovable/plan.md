## What the trace actually tells us

Reading the round-by-round summaries from your run (this is the model's own reasoning, not ours):

**Round 0** — model spent the entire round just *thinking*: "Final Flow not mapped… should I call create_final_documents_map?… 21 docs exist… post-approval edit rule… need long Hebrew content for 20 docs…". **Zero tool calls emitted.**

**Round 1** — more thinking: "should I batch in 10s or 20?… design instructions are heavy… maybe two passes… transparency rule… let's get started!". **Zero tool calls emitted.**

**Round 2** — model believes it already called `create_final_documents_map` and `add_documents` for 21–40 (it didn't — that was hallucinated reasoning), and starts planning the roster reply.

So the actual failure is:
1. The model burns 2–3 reasoning rounds psyching itself up for the heavy `add_documents` call instead of emitting it.
2. Our anti-loop nudge from last round only fires **after** a round finishes with `tool_calls.length === 0`. Gemini and GPT-5 in "thinking" mode often produce a round of pure reasoning + a fake "I'll do this now" prose tail — which doesn't trip the nudge cleanly because the round ends with text, not with a tool. By the time the nudge fires, only 1–2 rounds remain.
3. **The "stuck assistant" message comes from a separate bug**: `assistant_runs` rows are left at `status='running'` forever. I just queried and there are runs from this morning still open at 4,049s, 19,957s, 27,313s. The frontend watchdog ("recovered a stuck assistant") triggers on these stale rows even when the actual chat completed fine. So you're seeing the recovery banner on *unrelated* old runs, not on the run that just completed.
4. The envelope confusion is real but secondary — the model wandered into "should I ask about envelopes?" inside its reasoning. The Rule C copy added last round is good but the model isn't reading it because it never gets to the tool-call stage.

## Plan

### A. Force tool emission earlier (assistant-chat/index.ts)

For batch requests, inject the anti-loop nudge **after round 0 with no tool call**, not after round 1. Currently:
```
if (isBatchRequest && !nudgedForBatch && executedTools.length === 0) { nudge }
```
Add: also nudge if `round === 0`, no tools called, AND the model produced >800 chars of prose (a clear "thinking out loud" signal). Track this as `stalledRounds` and escalate the nudge wording on round 1 to "EMIT THE TOOL CALL NOW. No more prose. No more analysis."

### B. Pre-flight the Final Flow before the model has to think about it

The trace shows ~40% of the model's first-round reasoning was "is the Final Flow mapped? should I call create_final_documents_map?". This is wasted budget — we already know from project state. Add a pre-flight in `assistant-chat`:

- If `isBatchRequest` AND user is in Phase 4 AND `proposed_document_set_status === 'approved'` AND Final Flow node count is 0 → server-side calls `create_final_documents_map` BEFORE the model's first round, then injects a system note: "Final Flow refreshed for you (N nodes). Proceed directly to add_documents."

This removes the entire decision tree the model was looping on.

### C. Close stale assistant_runs (the real "stuck" bug)

The 8-minute watchdog isn't the problem — runs stay `running` *forever*. Two fixes:

1. **Server-side**: every exit path in `assistant-chat` (success, error, round-exhaustion, early return, thrown exception) must update `assistant_runs` to `done`/`error`. Audit every `return new Response(...)` in the function and ensure it goes through a single `finally`-style cleanup that sets `finished_at = now()`.

2. **One-time backfill migration**: mark all `assistant_runs` where `status='running'` AND `started_at < now() - interval '15 minutes'` as `status='error', error='auto-closed: stale run'`. This clears the existing 3+ ghost runs that are fooling the frontend watchdog.

### D. Tighten envelope confusion in Rule C

Add one line to the existing batch rule: *"If you find yourself thinking 'should I ask about envelopes?' during a document batch — STOP. Envelopes are a separate workflow. Emit add_documents now."* The model literally wrote that thought out loud in round 0; quoting it back at the model is the most reliable jailbreak from the loop.

### Files to touch
- `supabase/functions/assistant-chat/index.ts` — earlier nudge (round 0), pre-flight Final Flow refresh, audit run-close paths, tighten envelope line in Rule C. Apply to BOTH chat loops (around lines 3237 and 3892).
- New SQL migration — backfill stale `assistant_runs` to `error`.

### What this does NOT change
- The `add_documents` batch tool itself works (you have 21 rows from previous runs).
- The Logic Flow / Case Board green indicator (fixed last round).
- The envelope count (fixed last round).
- The playbook copy (fixed last round).

### Why I'm confident this is the fix
The trace is unambiguous: the model never emits a tool call in rounds 0–1, then hallucinates that it did in round 2. That's a *budget* problem, not a *prompt* problem. Fixing it requires (a) shorter decision tree at round 0 (pre-flight), (b) earlier nudge, and (c) cleaning up the ghost runs that make every interaction look "stuck" even when it isn't.

**Approve and I'll implement.**