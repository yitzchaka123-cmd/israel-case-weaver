## Problem

When you ask the assistant to add something to an already-approved case (e.g. "add a map"), it calls `add_canvas_node` which:

1. ✅ Creates a node row.
2. ❌ Does NOT create any **edges** to wire it into the logic graph (so it floats disconnected on the Canvas).
3. ❌ Does NOT update the **`solution_summary`** (now stale — the new clue isn't reflected).
4. ❌ Does NOT refresh the **Final Flow / production map** if one already exists (so the new node is invisible to document planning).
5. ❌ Does NOT propose to re-approve logic, regenerate the summary, or rebuild the Final Flow.

There is currently no `add_canvas_edge` tool at all and no concept of "post-approval edits dirty downstream artifacts".

## Fix

### 1. Add a real `add_canvas_edge` tool (`supabase/functions/assistant-chat/index.ts`)

- New tool definition: `add_canvas_edge` with `source_id`, `target_id`, optional `label`, optional `board` (defaults to `logic`).
- New executor branch that inserts into `canvas_edges` and stamps `created_by_message_id`.
- Strengthen `add_canvas_node` description: when the node is `clue / deduction / contradiction / red_herring / solution / document`, the assistant **MUST** also call `add_canvas_edge` in the same turn to wire it to at least one existing roster node (or explain why it's intentionally floating).

### 2. New `mark_logic_dirty` / auto-dirty signal

When `add_canvas_node`, `update_canvas_node`, or `add_canvas_edge` runs **after** `logic_approved_at` is set, the executor will:

- Return a receipt that includes a `requires_followup` flag listing what's now stale (`solution_summary`, `final_flow`, `proposed_document_set`).
- The system prompt gets a new **POST-APPROVAL EDIT RULE**: whenever the receipt has `requires_followup`, the assistant must in the same turn:
  1. Briefly state which downstream artifacts are now stale.
  2. Call `propose_options` with up to 3 buttons:
     - "Update the case summary" → triggers `set_solution_summary` with a freshly-rewritten summary that incorporates the change.
     - "Rebuild the Final Flow" → calls `create_final_documents_map` (only shown if a Final board already exists).
     - "Leave as-is for now" → no-op.

### 3. Roster-aware system prompt

Add a small block to the existing `CURRENT PROJECT STATE` section (~line 305) that surfaces:

- `Existing canvas edges` count (so the model can see the graph isn't empty).
- A `Logic graph dirty since approval` flag derived from `max(canvas_nodes.updated_at)` vs `logic_approved_at`.

This lets the assistant know on subsequent turns that the graph is out of sync with the saved summary even across sessions.

### 4. Tighten the system-prompt wording for `add_canvas_node`

Update lines 259 and the EDIT-VS-CREATE rule block to explicitly say:

> When you add a clue, deduction, red herring, contradiction, document, or solution node, you MUST in the same turn (a) call `add_canvas_edge` to connect it into the existing graph, AND (b) if `logic_approved_at` is set, follow the POST-APPROVAL EDIT RULE.

### Files touched

- `supabase/functions/assistant-chat/index.ts` (new tool, new executor branches, prompt additions, roster additions)
- *(No DB migration needed — `canvas_edges` table already exists with the right shape.)*

### Out of scope

- Auto-rewriting the solution summary without user confirmation (kept behind the proposed_options button so you stay in control).
- Auto-deleting/re-laying-out existing nodes (only adding edges and rebuilding Final Flow on demand).
