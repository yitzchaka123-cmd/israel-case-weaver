## Goal
Clean up the Packaging → Box Text panel so it matches the final field list. Front cover section moves to the top with only the fields that get baked. Back cover gets pruned to the must-have selling fields, plus a live brand/footer preview and brand selector.

## Front cover text (top of Box Text UI)
Show in this order, with a read-only Title row pulled from the project:

1. **Title** — read-only, sourced from `projects.title` (link to Overview to edit).
2. **Tagline (under title)** — uses existing `project_marketing.tagline`. Baked under the title on the front cover.
3. **Bottom paragraph** — existing `front_subtext`.
4. **Design notes** — existing `projects.cover_prompt` (or new `front_design_notes` if cleaner). Helper text explicitly says: *"These notes are sent to the cover generator together with the brand reference image."*

A small chip near the top of the section shows the active brand reference thumbnail (from active company profile's house default) so the user sees what "the reference" means.

## Back cover text
Replace the current 9-field block with exactly these fields, in order:

1. **Back headline** (`back_headline`)
2. **Short teaser → QR** (`back_teaser`) — helper updated: *"Ends with an arrow pointing to the QR; the YouTube teaser must match this copy."* Renders next to the **primary QR preview** inline (small thumb pulled from `project_qr_codes` where `is_primary=true`).
3. **In-game scenes (4)** — embed the existing `InGameScenesPanel` here so it lives with the rest of the back-cover deck instead of in Barcode & Back.
4. **Main back description** (`back_body`)
5. **Contents** (`back_whats_in_box`, relabel to "Contents")
6. **Age / duration / players** (`back_specs`) — helper notes this is also baked on the front.
7. **Company / legal / footer text** (`back_footer_text`)
8. **EAN-13 barcode** — inline preview + Generate/Regenerate button (move from Barcode & Back panel).
9. **Brand footer preview** — read-only card built from the active company profile (logo, name, address, legal, warning, made-in, age rating). Includes a **brand selector** (dropdown of `company_profiles_v2` for this owner) that updates `projects.company_profile_id`.

## Removals
Delete from the UI (and from the back/front prompt composers in `composePrompts.ts` and the marketing-copy edge function so they stop being drafted):
- `back_how_to_play`
- `back_feature_bullets`
- `back_content_note`
- Mini-movie QR sub-card (`mini_movie_url`, `qr_label`, `qr_helper_text`, `qr_code_url`) — replaced by the inline primary QR next to the teaser. Existing primary QR managed in Barcode & Back is reused.
- The standalone "Front cover text" card's logo chip stays, but the redundant front fields stay removed (already done in prior pass).

DB columns are kept (no migration) so old data isn't lost; they're just no longer surfaced or composed into prompts.

## Layout move
- `BarcodeAndBackPanel`: keep barcode generation logic accessible but the UI moves into the new "EAN-13 barcode" row inside Box Text. The QR code manager (multi-QR list) stays in `BarcodeAndBackPanel` since it's more than the single primary QR. The 4 in-game scenes panel moves out of Barcode & Back into Box Text.
- Packaging nav order updated: **Box Text → Cover & Visuals → Barcode & QR → Company Profile → Storyboard**.

## Front-cover bake updates
`bakeCover.bakeFrontCover` already takes title/subtitle/logo/bottomParagraph. Add:
- `tagline` (drawn under the title)
- `specs` (Age / duration / players, drawn as a small badge above the bottom strip)

`composeFrontPrompt` updated to mention the tagline and specs as additional reserved zones.

## Files touched
- `src/features/project/packaging/BoxCopyPanel.tsx` — field list rewrite, brand preview card, inline barcode + primary-QR previews, embed `InGameScenesPanel`.
- `src/features/project/packaging/BarcodeAndBackPanel.tsx` — remove the now-relocated barcode UI + scenes panel; keep multi-QR manager and the existing back-cover image generator.
- `src/features/project/packaging/composePrompts.ts` — drop removed fields, add tagline + specs to front prompt.
- `src/features/project/packaging/bakeCover.ts` — add tagline + specs rendering on front.
- `src/features/project/PackagingSection.tsx` — reorder nav items.
- `supabase/functions/generate-marketing-copy/index.ts` — stop generating the removed fields; ensure tagline + back_specs are still produced.

No DB schema changes.

## Open question
Do you want the **EAN-13 barcode** generator to stay duplicated (inline preview in Box Text *and* the existing card in Barcode & QR), or fully move it into Box Text and leave Barcode & QR for QR codes only? The plan above assumes the latter.