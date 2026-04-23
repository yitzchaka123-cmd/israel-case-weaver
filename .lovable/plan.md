

## Make every "edit" actually update — not duplicate (suspects, documents, envelopes, hints, canvas nodes)

Right now the assistant only has `add_*` tools. When you say *"tweak suspect 1"* or *"rename document 3"*, it has no `update_*` option and no visibility into existing IDs, so it creates a duplicate row.

This change adds real `update_*` tools across all five item types, injects numbered rosters into the system prompt so the model knows what already exists, and makes receipts read *"Updated suspect: Dana Levi (motives)"* vs. *"Created suspect: Dana Levi"* so duplicates become visually obvious.

### What changes in the conversation

- *"Change suspect 2's motive to revenge"* → `update_suspect` → **"Updated suspect: Yossi Bar (motives)"**
- *"Rename document 5 to 'The Letter'"* → `update_document` → **"Updated document #5: The Letter (title)"**
- *"Change envelope 3's task"* → `update_envelope` → **"Updated envelope #3 (task)"**
- *"Soften hint 2 at level 1"* → `update_hint` → **"Updated hint (stage 2, level 1)"**
- *"Rename the murder-weapon node"* → `update_canvas_node` → **"Updated node: Murder Weapon (title)"**

### Files touched

| File | Change |
|---|---|
| `supabase/functions/assistant-chat/index.ts` | **(a)** Replace bare counts in CURRENT PROJECT STATE with numbered rosters (capped, name-truncated) for: suspects (`id, name, role_in_case`, top 50), documents (`id, doc_number, title, doc_type, status`, top 100), envelopes (`id, number, label`, top 50), hints (`id, stage, level`, top 50), canvas nodes (`id, title, node_type, board`, top 100). **(b)** Add 5 new tool definitions: `update_suspect`, `update_document`, `update_envelope`, `update_hint`, `update_canvas_node`. Each takes a required `id` plus all-optional patch fields matching the table's editable columns. **(c)** Implement 5 executor branches: each strips undefined keys, runs `.update(patch).eq("id", id).eq("project_id", projectId)`, re-stamps `created_by_message_id = messageId` on tables that have it, returns `{ ok, message: "Updated X: <name> (<changed-fields>)", id }`. If the row isn't in this project, returns `{ ok: false, message: "No <thing> with that id in this project" }` — never cross-project writes. **(d)** Add a TOOL USE rule: *"When the user references an existing item (by name, number, pronoun, or role), you MUST call the matching `update_*` tool with the id from the roster — never the `add_*` variant. Use `add_*` only for items not present in the roster."* **(e)** Keep all existing `add_*` gating untouched. |
| `src/features/project/AssistantSection.tsx` | Add `update_document`, `update_envelope`, `update_hint`, `update_canvas_node` to `destinationFor()` (Documents / Envelopes / Hints / Canvas tabs). `update_suspect` is already routed. Existing `ToolReceipts` already renders `t.result.message`, which will now read "Updated …". |

### Technical notes

- Roster injection is bounded (50–100 rows, names truncated to 60 chars) so a giant project can't blow up the prompt budget.
- Patch executors only write fields the model passes — undefined keys are stripped before `.update()`, so partial edits don't wipe other columns.
- `.eq("id", id).eq("project_id", projectId)` guarantees a hallucinated id from another project silently updates 0 rows and returns a clear error.
- The `(<changed-fields>)` suffix in receipts comes from `Object.keys(patch).join(", ")` so you can see exactly what was touched.
- No DB migration needed — every column the new tools write to already exists.

### What stays the same

- All `add_*` tools, the Documents / Suspects / Envelopes / Hints / Canvas tabs, the `generate-document` pipeline, quick-reply buttons, and existing receipts keep working unchanged.

