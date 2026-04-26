## Goal

Make the Logic Flow Canvas board light up **live** while the assistant is generating it — clues, deductions, suspects, envelopes, hints and edges appear one-by-one as the model emits them, instead of all at once after a 2–3 minute wait.

## Why this works in our stack

- `canvas_nodes` and `canvas_edges` are already on the Realtime publication.
- `ProjectWorkspace.tsx` already subscribes to `postgres_changes` on both tables and invalidates the Canvas queries on every change. So **any row we insert during generation will pop into the Canvas board automatically** — no client changes needed for the live-paint effect itself.
- The bottleneck is the edge function: `generate-logic-flow` waits for the full LLM response, parses one big JSON tool call, then bulk-inserts everything. We need to switch to a **streaming** LLM call and insert rows as we parse them.

## Plan

### 1. Switch `generate-logic-flow` to a streaming LLM call

File: `supabase/functions/generate-logic-flow/index.ts`

- Add `stream: true` to the `chatCompletions` call (the AI router already supports it for OpenAI/Gemini/Lovable AI; verify with the existing helper and fall back gracefully if a given provider can't stream tool calls).
- Read the response with `resp.body.getReader()` and accumulate `tool_calls[0].function.arguments` chunks into a growing string buffer.

### 2. Incrementally parse the partial tool-call JSON

The model emits one big JSON object: `{ summary, envelopes[], nodes[], edges[] }`. We need a tolerant parser that can extract **completed array elements** from a still-incomplete JSON string.

- Add a small helper (`parsePartialArrayItems(buffer, key)`) that:
  - Finds `"nodes":[` / `"edges":[` / `"envelopes":[` in the buffer.
  - Walks the buffer counting braces/brackets and string escapes to find each fully-closed `{...}` element.
  - Returns the indexes consumed so we don't re-emit the same item.
- Run this every time a new chunk arrives.

### 3. Insert rows live as they're parsed

For each newly-completed element from the streaming buffer:

- **Envelope** (only when `noEnvelopes`): insert into `envelopes`, remember the new `id`.
- **Node**: insert one row into `canvas_nodes` (board=`logic`), keep the LLM's stable id (`clue_1`, `env_1`, …) → DB uuid in an in-memory `idMap`.
- **Edge**: only insert into `canvas_edges` once both endpoints exist in `idMap`; queue any edge whose endpoints haven't streamed yet, and flush the queue every chunk.

If `replace` is true, do the existing `delete from canvas_edges/canvas_nodes where board='logic'` **before** the stream starts so the board visibly clears, then re-fills.

### 4. Final-pass reconciliation

When the stream ends:

- Flush any remaining queued edges.
- Run the existing envelope cross-link logic (`linked_node_ids`, `final_layout_locked`, etc.) on the now-complete set.
- Save `solution_summary` on the project (unchanged).
- Run the same `logAiRun` accounting as today, just at the end.

If the stream errors mid-way, leave whatever has been inserted on the board (it's still useful) and surface the error to the assistant so it can offer "retry".

### 5. Keep the assistant's UX honest

File: `supabase/functions/assistant-chat/index.ts`

- The assistant currently fires `generate-logic-flow` as fire-and-forget (`EdgeRuntime.waitUntil`) and tells the user "refresh in 2–3 minutes". With live streaming we can change the message to:
  > "I've started rebuilding the Logic Flow — open **Canvas → Logic Flow** now and you'll see it draw itself in real time."
- No tool signature changes.

### 6. Small Canvas polish (optional, low risk)

File: `src/features/project/CanvasSection.tsx`

- While the Logic Flow board is being streamed, show a subtle "Generating live…" pill in the toolbar. We can detect this either by:
  - a new boolean column `projects.logic_flow_generating` toggled at the start/end of the edge function, **or**
  - simply by checking `assistant_runs` for an in-flight `generate-logic-flow` row (we already log runs).
- We'll go with the `assistant_runs` approach so we don't need a schema change.

## Out of scope

- We are **not** streaming the `summary` paragraph live into the UI — only the graph nodes/edges. The summary lands when the stream ends.
- We are not changing how envelopes / hints / suspects pages render.
- We are not changing the AI router's tool-call contract.

## Files to change

- `supabase/functions/generate-logic-flow/index.ts` — switch to streaming + incremental insert (main work)
- `supabase/functions/assistant-chat/index.ts` — update the user-facing message after kicking off generation
- `src/features/project/CanvasSection.tsx` — add a "Generating live…" indicator driven by `assistant_runs`

## Risk / rollback

- If a provider returns a tool call that can't be safely partial-parsed (rare with OpenAI/Gemini structured tool streaming), the helper will simply emit nothing until more bytes arrive, and at end-of-stream we fall back to the existing whole-blob `JSON.parse` path. Net effect in the worst case: same behavior as today.
- Rollback is a single-file revert of `generate-logic-flow/index.ts`.
