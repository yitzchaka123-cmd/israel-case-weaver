What happened

Your case is approved already: the database shows `logic_approved_at` is set and the logic board has nodes. But the Final board has zero nodes.

That is because the new Final Documents Map workflow was added after this case had already passed the approval point. Right now, the map is only enforced when the assistant is about to create final document rows; simply revisiting an old approved logic flow does not automatically run the new map step. You are not doing anything wrong.

Also, the current Canvas approval button only switches you to the Final board after approval. It does not itself create the planned document nodes. So for existing cases, you need either the assistant to run `create_final_documents_map`, or the UI needs a direct “Create Final Documents Map” action.

Plan to fix it

1. Add a Final board call-to-action for approved cases
- When Logic Flow is approved and the Final board is empty, show a clear panel:
  - “Final Documents Map not created yet”
  - “Create map from approved logic” button
  - short explanation that this creates planned document nodes only, not document rows/assets.

2. Add a backend function for generating the map from existing case data
- Reuse the existing assistant map behavior, but expose it as a deterministic backend action the Canvas can call.
- It will read the approved solution summary, logic nodes, envelopes, target document count, existing documents, and universal Doc 0 rules.
- It will create `document` nodes on the Final board with status:
  - `ungenerated` for planned docs not created yet
  - `draft row created` / linked when an existing document row already exists.

3. Backfill existing documents into the map
- Your current case already has two Doc 0 rows with no linked node.
- The new map generation should either:
  - create one Doc 0 node and link the most recent Doc 0 row to it, or
  - if duplicates exist, mark the newest as the active linked one and leave the older row untouched.
- The node description should say whether it is already created or still ungenerated.

4. Make approval create or prompt for the Final map
- After pressing “Approve & start producing documents,” the app should not just switch to an empty Final board.
- It should either auto-create the map or immediately show the “Create Final Documents Map” prompt on the Final board.
- This makes the workflow obvious for both new and existing cases.

5. Improve assistant instructions for existing cases
- If the user says “show me the final flow/map” and Logic Flow is already approved but the Final board is empty, the assistant should create the Final Documents Map first instead of staying silent or only explaining the rule.

Technical notes

Files likely to change:
- `src/features/project/CanvasSection.tsx`
  - detect empty Final board after approval
  - add the CTA and button
  - invalidate node queries after map creation
  - show linked/generated status in the Final board panel
- `supabase/functions/assistant-chat/index.ts`
  - strengthen existing-case behavior in the system prompt
  - optionally share/route the map-creation logic
- New or updated backend function, likely under `supabase/functions/`, to create the Final Documents Map from an approved project without requiring a chat message.

Database changes are probably not required because `canvas_nodes.data`, `documents.linked_node_ids`, and existing project/document columns already support this workflow.

After this is implemented, you can open this existing case, go to Canvas → Final, click “Create Final Documents Map,” and see the final document plan laid out as nodes before generating the remaining docs.