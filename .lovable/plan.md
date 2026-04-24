I found where this is coming from and why it can go wrong.

Right now Doc 0 instructions exist in the assistant playbook as a universal document: “Doc 0 — Contents / Case File Inventory” should list every planned document, envelope, physical insert, and generated piece, with no spoilers. The Final Flow generator also creates a Doc 0 node with that purpose.

But the actual document text generator does not have special Doc 0 logic. When `generate-document` creates body text, it only sends the model this generic brief:

```text
Document title
Document type
Print size
Design notes
Case title / setting / goal
Write the full body now
```

It does not fetch the Final Flow document nodes, envelopes, suspects, or the project’s full document list. So unless the assistant already wrote a perfect checklist into `hebrew_content` or `design_instructions`, the model has to invent or approximate the Doc 0 content. That is the bug.

For your current case, I also see multiple Doc 0 rows were created. The newest one does contain a checklist-style body, but the system is not enforcing that it matches the actual final map. It is still too dependent on whatever the assistant wrote in chat.

## Plan to fix it

1. Add a hard Doc 0 detection rule
   - Treat any document with `doc_number = 0`, title containing Doc 0 / contents / inventory, or doc type `contents checklist` as the universal box inventory.
   - This should override generic document generation.

2. Build Doc 0 from real project data
   - When generating Doc 0 text/image/PDF, load:
     - Final board document nodes
     - Existing document rows
     - Envelopes
     - Suspects
     - Relevant physical pieces / inserts planned in the final map
   - Generate the body as an actual inventory list of what is in the game, grouped by envelope/section.
   - Include generated/ungenerated status only if useful internally; the player-facing list should not expose app workflow unless you want it.

3. Make Final Flow the source of truth
   - If Final Flow exists, Doc 0 lists the planned document nodes from that flow.
   - If Final Flow does not exist, the assistant must not produce a final Doc 0 from guesses. It should ask to generate the Final Flow first.

4. Strengthen assistant instructions
   - Update the assistant prompt so it knows Doc 0 is not a normal evidence document.
   - Before generating Doc 0, it must verify the Final Flow exists and say it is using the mapped final documents.

5. Add editable Universal Documents section in the Playbook
   - Expose the existing universal document settings in Settings → Assistant Playbook.
   - Let you edit Doc 0 title, purpose, doc type, print size, list scope, and whether it is enabled.
   - This solves your earlier requirement: “I want to fix these things exactly from the playbook.”

6. Clean up duplicate Doc 0 behavior going forward
   - When the assistant creates Doc 0, reuse/update the existing Doc 0 row instead of creating multiple Doc 0 documents.
   - Link the Doc 0 row to the Doc 0 node in the Final Flow.

## Technical details

Files to update:
- `supabase/functions/generate-document/index.ts`
  - Add Doc 0-specific context loading and prompt construction.
  - Use Final Flow document nodes and envelopes as the authoritative inventory.
- `supabase/functions/assistant-chat/index.ts`
  - Enforce Doc 0 workflow in assistant tool-use rules.
  - Prevent duplicate Doc 0 creation where possible.
- `supabase/functions/create-final-documents-map/index.ts`
  - Ensure Doc 0 node has enough structured data for inventory generation.
- `src/features/settings/AssistantPlaybookPanel.tsx`
  - Add editable Universal Documents / Doc 0 controls.
- `src/lib/assistant-playbook.ts` and `supabase/functions/_shared/assistant-playbook.ts`
  - Keep the universal document schema/rendering consistent.

No new database tables are required. This uses existing `documents`, `canvas_nodes`, `canvas_edges`, `envelopes`, `suspects`, and `profiles.assistant_playbook` data.