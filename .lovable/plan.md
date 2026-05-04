## Goal

Make documents and envelope inserts feel real by reasoning about realism *per document type*, and let the AI invent the document-type catalog *per game* — instead of leaning on a generic example list that defaults every page to "coffee stain + fold lines + stamps".

## Problems today

1. The realism floor (`assistant-playbook.ts` ~line 1055) gives the model a fixed example list — "paper aging tone, fold lines, punch holes, staples, **coffee/water stains**, smudged ink, typewriter offset, …". The model treats it as a checklist and reuses the same 4–6 items on every doc.
2. The "do not default to coffee stains" guardrail only exists for **envelope inserts** (`generate-envelopes`, `suggest-image-prompt`), not for regular documents (`generate-document`).
3. Realism isn't reasoned per doc-type. There's nothing telling the model "police report → mugshot photo + fingerprint card + booking number"; "school setting → homework page + report card + hall pass".
4. The doc-type catalog is a hardcoded list (`p.catalogs.document_types`) the model picks from. It doesn't think about which types belong to *this game's world* (school → homework / detention slips; corporate → expense reports / business cards; 1940s noir → telegrams / matchbook covers).

## Plan

### 1. Rewrite the realism floor (shared playbook)

Files: `src/lib/assistant-playbook.ts` and `supabase/functions/_shared/assistant-playbook.ts` (mirror).

Replace the fixed example list at `renderRealismParagraphs` with type-driven reasoning:

- Remove "coffee/water stains" from the inline examples; it's overused.
- Reframe the rule as: "Pick 3–6 realism details that a real example of THIS specific document type would have. A police booking sheet → mugshot photo strip, ten-print fingerprint card, booking number, arresting officer signature, intake stamp. An autopsy report → toe-tag reference, medical examiner letterhead, anatomical diagram, chain-of-custody seal. A school detention slip → student name field, period number, teacher initials, three-hole punch, hallway crease."
- Hard cap: at most ONE coffee/water stain across the entire game's document set. Default = none.
- Forbid copy-pasting the same realism details across two documents in the same case.

### 2. Apply the same anti-default rule to regular documents

File: `supabase/functions/generate-document/index.ts`.

Add a "no generic realism defaults" line to the realism block injected into the document-body prompt (mirroring what `generate-envelopes` and `suggest-image-prompt` already do for inserts). Tell the model: realism details must be reasoned from the doc_type + game era + setting, not from a generic prop list.

### 3. Per-game document type catalog

Files: `src/lib/assistant-playbook.ts` + `_shared/assistant-playbook.ts` (`renderDocumentSetDiversityBlock` / catalog area), and the `propose_document_set` tool guidance.

- Stop treating `p.catalogs.document_types` as the menu the model picks from. Reframe as "*reference examples only — invent the actual doc_type values for THIS game from its setting, era and characters*".
- Add an explicit step before `propose_document_set`: "First brainstorm 8–15 candidate document types that naturally exist in THIS game's world (school → homework, hall pass, yearbook page, detention slip, cafeteria menu; corporate HQ → expense report, business card, badge, memo, performance review; 1920s seance → calling card, telegram, séance log, newspaper clipping). Use those as the doc_type values. Do not default to police-procedural types unless the case actually involves law enforcement."
- Keep the diversity floor (≥12 distinct types, ≥6 families, family-share cap) — but families should now be derived from the *game's* invented types, not the hardcoded family map.

### 4. Envelope insert guidance softened

File: `supabase/functions/generate-envelopes/index.ts` and `suggest-image-prompt/index.ts`.

User said envelope inserts should just be "regular era-appropriate briefings" — strip the heavy "pick a DISTINCT document type per insert (telegram / mimeograph / dispatch / casebook page / index card / ledger…)" pressure. Replace with: "A simple in-world briefing page from the game's era and setting. Use a normal sheet that fits the case (e.g. a typed memo on letterhead). Don't pile on tactile gimmicks; subtle aging is enough." Coffee-stain ban stays.

### 5. Game-wide realism budget

In `generate-document`, when building the prompt, fetch the count of already-generated documents in the project that mention "coffee" / "water stain" in their `design_instructions` or `hebrew_content`. Pass a single line: "This game already has N documents with a coffee/water stain — do NOT add another." Threshold 1.

(Lightweight; doesn't require a new column. If too noisy we can just rely on the playbook rule.)

## Technical notes

- `renderRealismParagraphs(p)` is the single chokepoint — both files (`src/lib/...` and `supabase/functions/_shared/...`) must be updated identically; they're mirrored copies.
- No DB migration needed. No new edge functions.
- Edge functions touched (must redeploy): `generate-document`, `generate-envelopes`, `suggest-image-prompt`.
- Risk: loosening the hardcoded catalog could hurt diversity audits. Keep the numeric thresholds (≥12 distinct types, ≤25% per family) but compute families from the proposed list rather than the static `family_groups` map — add a fallback so existing audits still pass.

## Out of scope

- No UI changes.
- No changes to image generation models or per-slot inline image logic.
- Not removing the envelope-insert image-generation pipeline; only relaxing the prompt copy.