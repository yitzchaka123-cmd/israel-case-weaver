Three small playbook tweaks in `supabase/functions/assistant-chat/index.ts`. No DB or UI changes.

## 1. Restrict consistent-set families to three doc types

Today the playbook (sections C.1 and H) lists 7+ families as "consistent visual sets" — interrogation transcripts, witness statements, suspect file pages, forensic/autopsy reports, police briefings, lab reports, evidence intake forms — which makes the whole pile look samey. Restrict to exactly three:

- **Interrogation Transcripts**
- **Police Briefings** (also called Police Reports / Suspect Profiles)
- **Police Intake Reports**

Every other document is a STANDALONE one-off with its own unique paper, layout, fonts, and stamps — including forensic reports, witness statements, lab reports, etc. Visual variety is part of the player's experience.

## 2. Generation order: consistent docs first, then random standalones

Update C.1 + H so the batch ordering rule explicitly states:

- When `bulk_generate_documents` is called for a "generate all" run, FIRST issue `generate_consistent_document_set` for each of the three templated families (one call per family, max 8 ids per call), THEN issue the bulk run for the standalone one-offs. This way intake/interrogation/briefings render as locked sets before the random docs land.
- When drafting (`add_documents`), keep the existing rule that the three templated families go into the FIRST 3-doc batches, standalones in the trailing batches.

## 3. Update suspect counts by difficulty

Replace the cast-size guidance we just added (easy 3–4 / medium 5–6 / hard 7–9) with the user's preferred ranges:

- **easy → 5 suspects** (exactly, not less)
- **medium → 6–7 suspects**
- **hard → 7–10 suspects**

And update the "under-cast nudge" thresholds accordingly: medium with `<6` suspects or hard with `<7` may trigger the one-time `propose_options` "add 1–2 more suspects?" offer.

## Files touched

- `supabase/functions/assistant-chat/index.ts` — playbook sections C.1 + H + CAST SIZE GUIDANCE only.