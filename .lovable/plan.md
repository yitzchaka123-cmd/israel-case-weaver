## Goal

Guarantee that EVERY game's document set starts with two docs per suspect — a **Police Briefing** (with realistic AI portrait + bio) and an **Interrogation Transcript** — regardless of what the assistant model decides. Today this is only a soft prompt rule, so models skip it (your new case has 4 suspects and 0 such docs).

## Why your last change didn't work (short version)

- The rule lives only in the system prompt; nothing on the server enforces it.
- `propose_document_set` tool schema has no `linked_suspect_ids` field, so the model can't attach a portrait even if it wanted to.
- Suspects on the Logic canvas aren't mirrored into the `suspects` table for this project, so there's nothing to link or generate a portrait from.

## Changes

### 1. Make `suspects` table the source of truth (assistant-chat)
- When the assistant approves the Logic Flow (or when `propose_document_set` is called), auto-mirror every `canvas_nodes` row of type `suspect` (and `red_herring` if `is_red_herring` semantics apply) into `public.suspects` — name from node title, summary/role from node description. Idempotent (match by name within project).
- This gives every suspect a stable `suspects.id` to attach portraits and to use in `linked_suspect_ids`.

### 2. Extend `propose_document_set` tool
- Add `linked_suspect_ids: string[]` to the tool's JSON schema and to the `cleaned` mapping inside the handler so it's persisted into `proposed_document_set` jsonb.
- Update tool description to require: for each suspect, exactly one entry with `doc_type: "Police briefing"` and one with `doc_type: "Interrogation transcript"`, both with `linked_suspect_ids: [<that suspect id>]`, both as the first entries (doc_number 1..2N).

### 3. Server-side enforcement (the teeth)
Inside the `propose_document_set` handler in `supabase/functions/assistant-chat/index.ts`:
- Load `suspects` for the project (after the mirror in step 1).
- Validate the incoming `documents`:
  - For every suspect, exactly one Police Briefing + one Interrogation Transcript with that suspect's id in `linked_suspect_ids`.
  - These 2N entries occupy doc_number 1..2N (briefing then transcript per suspect, in suspect order).
- If the proposal is missing pairs or has them out of order, **auto-repair**: synthesize the missing briefing/transcript entries with sensible default titles in the project's `game_language`, renumber so they come first, and shift other docs' numbers up. Save the repaired list and return a note like `"Repaired: inserted N missing per-suspect docs."` so the assistant tells the user.
- This makes the rule structurally impossible to break — even on Just build it.

### 4. Carry `linked_suspect_ids` into Final board + `documents` rows
- `supabase/functions/create-final-documents-map/index.ts`: extend `ProposedDoc` type with `linked_suspect_ids`, pass through into the planned doc and the inserted `canvas_nodes.data`.
- When the final-map step (or whichever step writes `documents` rows) creates the actual `documents` row for these planned items, populate `documents.linked_suspect_ids` so the existing UI logic that pins the suspect's `thumbnail_url` into the document's first inline image slot fires automatically. (Existing playbook already says: anchor portrait = locked first inline image.)

### 5. Generate the realistic portrait if missing
- Before doc generation, ensure each suspect has a `thumbnail_url`. If a suspect linked to a Briefing/Interrogation has no portrait, trigger the existing suspect-portrait generation path (Nano Banana / `generate-image`) using the suspect's name + role + case era/setting from the project. Reuse the same portrait for both that suspect's briefing and interrogation (anchor consistency).

### 6. Backfill for the current project
- One-time backfill for project `d3e6eacc…`: mirror the 4 Logic suspect nodes into `suspects`, repair the existing `proposed_document_set` to insert 8 missing per-suspect docs at positions 1–8, renumber the rest, and re-run the final-map build so the user sees the corrected list immediately.

## Files to edit

- `supabase/functions/assistant-chat/index.ts` — schema + handler enforcement + auto-mirror suspects.
- `supabase/functions/_shared/assistant-playbook.ts` and `src/lib/assistant-playbook.ts` — minor wording: "Police Briefing + Interrogation are server-enforced, not optional".
- `supabase/functions/create-final-documents-map/index.ts` — pass `linked_suspect_ids` through; populate on `documents` row creation.
- (No DB schema changes — `documents.linked_suspect_ids` and `suspects.thumbnail_url` already exist.)

## What you'll see after this lands

- New cases: docs 1..2N are auto-named "Police Briefing — <Name>" and "Interrogation Transcript — <Name>" (translated to the game language), each pinned with the suspect's portrait.
- Your current case: the 4 suspects get 8 new docs inserted at the top, the other docs shift to 9+, and portraits get generated for any suspect that doesn't already have one.
