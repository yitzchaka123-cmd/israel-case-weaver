# Canvas zoom + cover generators upgrade

Five focused changes. Front- and back-cover generators get a real graphic-design pipeline (logo/title/QR baked in), QR support becomes multi-link, and the company profile becomes the single source of truth in Settings.

## 1. Canvas: wider zoom range

In `src/features/project/CanvasSection.tsx` on the `<ReactFlow>` element:
- Set `minZoom={0.05}` (currently defaults to 0.5) and `maxZoom={4}` (default 2). Lets you zoom out to see the whole map and zoom in close to read node bodies.
- Tighten the post-arrange `fitView` so nodes don't shrink to dots: change `maxZoom: 1.15` → `maxZoom: 1.4`, keep `padding: 0.18`.
- Apply the same `minZoom`/`maxZoom` to the `<MiniMap>`.

## 2. Back cover gets the same prompt assistant as the front

In `BarcodeAndBackPanel.tsx`:
- Add `<ImagePromptAssistant>` (already used by the front cover) above the Generate button, persisted to a new column `project_marketing.back_cover_prompt` (text).
- The composed final prompt = assistant draft + the existing layout-requirements suffix (reserved barcode area, reserved QR area, reserved logo area, reserved title area). User can refine before each generation, just like the front cover.
- Hint passed to the assistant: title, subtitle, mystery type, setting, back headline, back body, tagline, company name + tagline.

## 3. Multi-QR support, auto-baked onto the back cover

New table `project_qr_codes` (project_id, id, label, target_url, qr_image_url, position, created_at). RLS auth-all to match siblings.

UI lives in `BarcodeAndBackPanel.tsx` under a new "QR codes" subsection:
- "Add QR" → row with label input + URL input + Generate button → renders QR client-side via existing `marketing/qr.ts`, uploads to `media` bucket, saves row.
- Mark exactly one row as the **primary** QR (the mini-movie one). The existing `project_marketing.qr_code_url` / `mini_movie_url` keep working — primary just mirrors into them for backwards-compat.
- Up to ~4 QRs supported. Each shows preview, label, link, delete.

Back-cover bake step (extend `bakeBarcodeIntoImage` in same file, rename to `bakeBackCoverElements`):
- Always bakes the EAN-13 in the lower-right (unchanged).
- Bakes the **primary QR** (with its label underneath) in the lower-left in a clean white card.
- Bakes the **company logo** (from `company_profiles.logo_url`) top-center, small.
- Bakes the **company address + legal_text** as a small typeset block along the bottom edge using canvas 2D text (white card, dark text), pulled from the workspace company profile.
- Secondary QRs (if any) are baked as a small horizontal strip above the address block, each with its tiny label.
- Layout coordinates derived from the reserved zones already requested in the prompt — final composite stays crisp because everything is overlaid post-render.

The prompt suffix is updated to also reserve a lower-left QR zone (~20%×20%), a top-center logo zone (~30%×8%), and a bottom address strip (~100%×8%).

## 4. Front cover becomes a real game cover

`CoverAndVisuals.tsx` — extend `handleGenerateCover`:
- Build the prompt with structured guidance (title, subtitle, mystery_type, setting, company tagline) plus explicit graphic-design requirements: reserve top area for **TITLE** (large), middle for hero art, lower-third for **SUBTITLE**, top-right for **company logo**, "do NOT render text — typography is added in post."
- After the image lands (use the same realtime-driven bake hook pattern as the back cover), bake on:
  - The **game title** (large, custom font, top area) — uses `project.title`.
  - The **subtitle** (smaller, under title) — uses `project.subtitle`.
  - The **company logo** (top-right, ~12% width, with subtle white card if needed).
- The baked URL replaces `cover_image_url`, original raw render kept in history so the user can re-bake if they tweak title/subtitle/logo.
- New "Re-bake typography" button on the cover preview that reruns just the bake step against the latest raw render — no new image generation.

Add `<ImagePromptAssistant>` already present on cover. Hint is enriched with the new company fields.

## 5. Company profile lives only in Settings, with more fields

`company_profiles` already exists per-user in Settings (`/settings`) and `MarketingSection` already shows a read-only summary linking to Settings — so the "take it out of every game" ask is mostly already done. We:
- Add the **read-only company summary** (logo, name, address, legal text) directly under the back-cover preview in `BarcodeAndBackPanel.tsx` so the user sees what will be baked on, without leaving Marketing.
- Expand `company_profiles` with: `phone`, `vat_number`, `manufactured_by`, `distributed_by`, `warning_text` (e.g. choking-hazard line), `box_footer_line` (custom one-line override). Add to `CompanyProfilePanel.tsx` form.
- These new fields flow into the back-cover bake (warning + footer along the bottom strip).
- Remove any per-project company override fields if present — confirmed none exist today, so nothing to migrate out.

## Technical details

- Migrations:
  - `ALTER TABLE project_marketing ADD COLUMN back_cover_prompt text;`
  - `CREATE TABLE project_qr_codes (id uuid pk default gen_random_uuid(), project_id uuid not null references projects(id) on delete cascade, label text, target_url text not null, qr_image_url text, is_primary boolean default false, position int default 0, created_at timestamptz default now());` + RLS auth-all + realtime publication.
  - `ALTER TABLE company_profiles ADD COLUMN phone text, ADD COLUMN vat_number text, ADD COLUMN manufactured_by text, ADD COLUMN distributed_by text, ADD COLUMN warning_text text, ADD COLUMN box_footer_line text;`
- The bake helpers stay client-side (canvas 2D), no edge-function changes needed for compositing. `assistant-chat`'s back-cover prompt-builder gets the new reserved-zone instructions.
- Fonts for baked title/subtitle: load `Cinzel` and `Inter` from Google Fonts via `document.fonts.load()` before drawing, so the canvas uses the real typeface.
- All existing realtime channels already cover `project_marketing` and `media_assets`; add a channel for `project_qr_codes`.

## Files touched

- `src/features/project/CanvasSection.tsx` — zoom limits.
- `src/features/project/marketing/BarcodeAndBackPanel.tsx` — prompt assistant, multi-QR UI, expanded bake (logo/QR/address).
- `src/features/project/marketing/CoverAndVisuals.tsx` — typography + logo bake on front cover, re-bake button.
- `src/features/settings/CompanyProfilePanel.tsx` — new fields.
- `supabase/functions/assistant-chat/index.ts` — updated reserved-zone instructions for cover prompts.
- New migration with the three schema changes above.
- New tiny helper `src/features/project/marketing/bakeCover.ts` shared by front + back compositing.
