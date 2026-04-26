## Why arrange is slow + random today

Looking at `supabase/functions/arrange-canvas/index.ts` and `CanvasSection.tsx`:

1. **Every press calls an LLM** with a 75 s hard timeout. On the final flow this round-trip dominates the wall clock — the user waits 10–60 s every click.
2. **The LLM frequently fails the 80 % coverage check** (`pos.length < ceil(nodes.length * 0.8)`) or returns invalid coords → silent fall through to `fallbackLayout`, which is the generic lane layout. That is the "random-looking" output you're seeing.
3. **The fallback isn't role-aware for the final flow.** `create-final-documents-map` already stamps each node with `finalMapRole: "logic" | "document"`, `sourceLogicNodeId`, `envelopeNumber`, `docNumber`, `sourceLogicNodeIds`, `linkedLogicTitles` — the fallback ignores all of that and treats final-flow nodes the same as logic-flow nodes.
4. The model used (`gemini-3-flash` default) is non-reasoning so it's not actually planning a story — it just shuffles columns, which reads as random.
5. Each position write is a separate UPDATE (already parallel, but still N round-trips to Postgres).

## Fix — three-tier strategy

### Tier 1: Deterministic, context-aware layout (default, instant)

Run a real layout algorithm in the edge function — **no LLM** by default. Returns in <1 s.

**For the LOGIC board** — keep current 7 lanes but make column assignment smarter:
- Topologically sort the DAG (suspects/clues feed deductions feed solution; envelopes pin to the trigger node).
- Use longest-path layering to pick a `column` per node (so an A→B→C chain becomes 3 columns, not 3 rows).
- Sort within each lane by column to align connected items vertically.

**For the FINAL board** — use the data the generator already stamps:
- Read `finalMapRole`, `envelopeNumber`, `docNumber`, `sourceLogicNodeIds` for every node.
- Layout becomes 3 vertical bands left-to-right:
  - **Band A (left): logic chain** — laid out by topological depth using existing logic-flow positions if present (so the final board mirrors the logic board the user already approved).
  - **Band B (middle): documents** — each document sits in the row of its `sourceLogicNodeIds[0]` (the logic beat it materialises). Multiple docs per beat stack vertically with `ROW_GAP` between them. Doc 0 (contents) anchors at the top of its envelope's column.
  - **Band C (right): envelopes** — each envelope sits in the row of its highest-numbered document, sorted top-to-bottom by `envelopeNumber`.
- This produces a clean **suspects/clues → deduction → "becomes document" → "physical insert in envelope N"** reading flow that matches how the case actually plays.

Both boards use a final overlap-resolution pass (sweep nodes; if two centers are within `NODE_W + 40` × `NODE_H + 60`, push the later one down a row).

Performance: pure JS, runs server-side in tens of milliseconds. Replace the per-node `Promise.all(updates)` with a single batched `upsert` (one round-trip).

### Tier 2: Single batched DB write

Replace this:
```ts
const updates = await Promise.all(
  Object.entries(positions).map(([id, p]) =>
    supa.from("canvas_nodes").update({ position_x: p.x, position_y: p.y }).eq("id", id),
  ),
);
```
with one `upsert(rows, { onConflict: "id" })` containing all rows. Cuts ~N×30 ms of round-trips down to one.

### Tier 3: AI polish as an opt-in second click ("Refine with AI")

Keep the LLM path but stop running it by default. Add a second toolbar button next to **Smart arrange**:

- **Smart arrange** (instant, deterministic) — the new default.
- **Refine with AI** (slower, optional) — feeds the *already-laid-out* board to the model and asks it only to make small adjustments (group by suspect, shorten edge label collisions). Because the model now has a good starting layout it returns much better results, and we can keep the timeout at ~30 s instead of 75 s. If it fails or returns <80 % coverage we just keep the deterministic layout — no visible regression.

This way: the default press is instant + sensible. The "AI" press is for polish, not the critical path.

## Files to change

- `supabase/functions/arrange-canvas/index.ts` — rewrite:
  - New `deterministicLogicLayout(nodes, edges)` (topological lanes + longest-path columns).
  - New `deterministicFinalLayout(nodes, edges)` (uses `finalMapRole`, `sourceLogicNodeIds`, `envelopeNumber` to build the 3-band layout).
  - New `mode` param: `"deterministic"` (default) | `"ai-refine"`.
  - Batched `upsert` instead of N updates.
  - Drop the 80 % coverage retry loop on the deterministic path (it's always 100 %).
- `src/features/project/CanvasSection.tsx` — split the toolbar button:
  - Rename current button to **Smart arrange** (calls with `mode: "deterministic"`).
  - Add **Refine with AI** dropdown item that calls with `mode: "ai-refine"` and uses the existing `logicModel`.
  - Keep optimistic local update + `qc.invalidateQueries` flow.
- No DB schema changes.
- No new dependencies.

## What you'll see after

- Pressing **Smart arrange** on either board returns in <1 s.
- The **final flow** specifically reads as: logic chain on the left, documents in the middle aligned with the logic node they came from, envelopes on the right in numerical order — the exact "review the game structure" view you asked for.
- The AI refine button is still there if you want to spend the 20 s on a polish pass for a screenshot.

## Open question

The current code defaults to model `gemini-3-flash` for arrange even though your logic-flow model is `openai-5.2`. After this change AI refine will reuse `logicModel` (which is what the toolbar already sends), so an `openai-5.2` press will route through your OpenAI key. Want me to keep that, or hard-pin AI refine to a faster model (e.g. `gemini-3-flash`) so it stays cheap regardless of the logic-flow setting?