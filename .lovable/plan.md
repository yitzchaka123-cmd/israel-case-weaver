

## Envelope nodes in the logic flow — make them appear and make them useful

### Why you didn't see envelope nodes

Your project currently has **zero envelopes** in the database. The logic-flow generator is conditional: it only emits envelope nodes when `envelopes.length > 0`. With no envelopes drafted, the entire envelope section of the prompt is omitted, so the model has nothing to render on the right-hand lane of the canvas.

On top of that, even when envelopes exist, the envelope nodes today only carry a short title — **not the task or how it ties into the case structure**, which is exactly what you want to read at a glance on the board.

### Fix — three changes

**1. `supabase/functions/generate-logic-flow/index.ts`**

- **Auto-scaffold envelopes when none exist.** Before building the prompt, if `envelopes.length === 0`, derive a sensible default count from `project.target_doc_count` (≈ one envelope per 6-8 documents, clamped to 4-7) and ask the model to also propose `{ number, label, task }` for each as part of the same tool call. After the response, insert these into the `envelopes` table so the Envelopes tab is populated and the canvas nodes link to real rows.
  - Add an `envelopes` array to the `emit_logic_flow` tool schema (only required when no envelopes exist on input): `{ number, label, task, design_instructions }`.
  - Insert the new envelope rows BEFORE inserting nodes, then map the envelope node ids onto them via the existing `linked_node_ids` write-back loop.
- **Make every envelope node body informative.** Update the prompt so each `envelope` node's `description` field is required and must contain three lines:
  - **Task:** _<what the player physically does with this envelope — open, scan QR, assemble, etc.>_
  - **Contains:** _<one-line summary of which clues/deductions sit inside it>_
  - **Why it matters:** _<one sentence on how it advances the case structure / what it unlocks for the next envelope>_
- Keep the existing right-side vertical lane positioning (x ≈ 1400, y stepping 160) and the `envelope_n → envelope_{n+1}` chain edges.

**2. `src/features/project/canvas/CanvasNodeTypes.tsx`**

- The `CaseNode` body already renders `data.description` but truncates with `line-clamp-2`. Bump envelope nodes specifically to `line-clamp-4` (or remove the clamp on envelope/solution types) and slightly widen the max width from 240 → 280 for envelope nodes so the three-line "Task / Contains / Why it matters" body is readable without opening the node.
- Add a small **"Envelope #N"** label in the colored header strip when `node_type === "envelope"` (pull the number from `data.envelopeNumber`, which we'll start writing during node insert), so the player flow order is visible at a glance.

**3. Persist the envelope number on the node** (small migration-free change)

- In `generate-logic-flow`, when a node is type `envelope`, store the envelope number in the `data` JSONB column (e.g. `data: { envelopeNumber: 1 }`). The canvas reads this directly via `data.envelopeNumber` — no schema change required.

### What you'll see after this lands

Re-running "Generate logic flow" on this project will:
1. Scaffold ~5 envelopes (based on your 40-doc target) into the Envelopes tab with placeholder labels and tasks the AI proposes from the case brief.
2. Add 5 colored envelope nodes in a vertical lane on the right side of the canvas, each labeled `Envelope #1 … #5` in the header strip.
3. Each node body shows the **task**, what it **contains**, and **why it matters** — three short lines, fully visible on the card.
4. Edges connect clues/deductions → their envelope, and `Envelope #N → Envelope #N+1` so the player flow reads top-to-bottom on the right edge.

### Files touched

- `supabase/functions/generate-logic-flow/index.ts` — auto-scaffold envelopes when none exist; require richer envelope-node descriptions; persist `envelopeNumber` in node `data`.
- `src/features/project/canvas/CanvasNodeTypes.tsx` — wider envelope nodes, looser line clamp, header shows envelope number.

### Out of scope

- Re-running this on projects that already have envelopes will NOT overwrite their labels/tasks — auto-scaffolding only triggers when zero envelopes exist.
- Two-way sync (editing the envelope node body on the canvas writing back to the `envelopes` row) — out of scope; the node is a read-only mirror for now.
- Auto-generating envelope cover art — separate flow, untouched.

