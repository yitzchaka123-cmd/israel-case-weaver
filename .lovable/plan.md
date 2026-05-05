# Stop the assistant from asking "should I draft 1–3?" — just draft everything

## What's wrong

The assistant approved the proposal, then paused and asked for permission to start the batched `add_documents` calls ("Tell me 'go' and I'll create them in 14 batched calls"). The user already said draft them all. The system prompt (rule **C** in `supabase/functions/assistant-chat/index.ts`) already forbids this pause, but the model is doing it anyway because:

1. It hit the per-call cap of 3 docs and treated that as a reason to confirm.
2. There's no rule about *grouping* docs across batches (consistent sets first, the rest after).
3. The "no pause" rule is buried inside a long paragraph and easy to skip past.

## What you actually want

When you approve a 40-doc proposal:

1. **No confirmation question.** The assistant fires Doc 0 + the batched `add_documents` calls in the same turn, with no "ready? say go" prompt.
2. **Smart batch order.** Group docs that need to look consistent (interrogation logs together, suspect-related forms together, forensic reports together, etc.) into the same `add_documents` calls so a later `generate_consistent_document_set` call gets clean groups. Then drop the remaining standalone docs into the trailing batches.
3. **One closing line.** After all batches return, a single short reply: "Drafted 40/40. Next stage: generate images + PDFs?" — no questions about which docs to start with.

## Plan

### 1. Tighten the system prompt (rule C, around lines 489–492)

Promote the "do not pause" rule into a separate top-level bullet and add the grouping rule:

- Rewrite C so the very first sentence is: *"When the user approves a multi-doc proposal — even a 40-doc one — you fire ALL batches in this turn with no confirmation question. Asking 'ready?', 'should I start?', 'starting with docs 1–3?' is a CRITICAL failure."*
- Add an explicit anti-pattern list of forbidden phrasings: "Tell me 'go'", "ready?", "starting with 1–3?", "Before I fire those batches".
- Add a new sub-rule **C.1 — BATCH GROUPING**: "When you split a proposal across `add_documents` calls, group docs that share a visual template (interrogation transcripts, witness statements, forensic reports, suspect file pages, police briefings, anything you'd later pass to `generate_consistent_document_set`) into the SAME 3-doc batches. Standalone one-off docs (maps, photos, news clippings, letters) go into the remaining batches. This way a later 'generate all' run can call `generate_consistent_document_set` per group with clean inputs."

### 2. Strengthen the server-side anti-pause nudge (around lines 3896–3912)

There's already an "anti-loop nudge" that fires when the user asked for a batch action and the model returns prose without a batch tool call. Extend it so it also fires when:

- The model emitted prose containing any of: `"tell me \"go\""`, `"ready?"`, `"starting with"`, `"before I fire"`, `"quick confirmation"`, `"do you want me to draft"`.
- AND the prior user message contained an approval/draft-all signal.

When it fires, inject a stronger system message: "STOP asking for confirmation. The user already approved. Emit `add_documents` batches NOW for ALL remaining docs in this turn." and force one more tool round.

### 3. (Optional, deferred) Raise the per-call cap

The 3-doc cap exists because the model used to choke on bigger payloads. If `add_documents` of 5–8 docs per call is reliable now, raising the cap to 8 would mean 5 batches instead of 14 and remove the temptation to pause. **Out of scope for this fix** — flag it as a follow-up only if the prompt fix doesn't fully cure the pausing.

## Files to edit

- `supabase/functions/assistant-chat/index.ts` — rule C in the BATCH RULES block (lines ~489–492) and the anti-loop nudge (lines ~3896–3912).

No DB changes, no client changes.
