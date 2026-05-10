## Goal

Replace the two separate cover generators with a single "Generate front + back cover" action that fires **one GPT-image-2 call with `n=2`**. The model receives the full brand profile, the full packaging copy deck, the cover reference image, and an explicit instruction that image 1 = front, image 2 = back. Because GPT-image-2's batched results share style across the set, the two outputs come back as visual siblings.

## How it works

```text
[Cover & Visuals panel]                 [GPT-image-2 /v1/images/edits]
   "Generate front + back"   ───►   { model: gpt-image-2, n: 2,
                                       prompt: COMBINED_PROMPT,
                                       image: <reference.jpg>,
                                       size: 1024x1536, quality: high }
                                              │
                                              ▼
                                    data[0]  ─►  front cover (projects.cover_image_url)
                                    data[1]  ─►  back  cover (project_marketing.back_cover_url
                                                              + media_assets row, category=marketing-back)
```

After the two images land, the existing client-side bake pipeline runs as today: front gets `bakeFrontCover` (title, subtitle, logo, slogan), back gets `bakeBackCover` (barcode, primary QR, secondary QRs, logo, address, legal, footer).

## What changes

### 1. New edge function `generate-cover-pair`

`supabase/functions/generate-cover-pair/index.ts` — purpose-built for the n=2 case so we don't fork the single-image function.

- Body: `{ projectId, frontPrompt, backPrompt, referenceImageUrl, quality }`.
- Server-side composes ONE combined prompt:

```text
You are producing a TWO-IMAGE BATCH for the same boxed murder-mystery game.
Both images must share the SAME palette, lighting, illustration technique,
typography mood, paper finish and brand fingerprint as the attached
REFERENCE IMAGE (publisher: <company.company_name>).

IMAGE 1 — FRONT COVER (portrait, print-ready):
<frontPrompt with all front meta + brand brief>

IMAGE 2 — BACK COVER (portrait, print-ready):
<backPrompt with headline/body/copy deck/QR+barcode reserved zones>

Return both images. They must look like the front and back of the SAME box.
```

- Calls `POST https://api.openai.com/v1/images/edits` (multipart) with `model=gpt-image-2`, `n=2`, the reference image attached, `size=1024x1536`, `quality=high`, `output_format=jpeg`.
- Uploads `data[0].b64_json` → front, `data[1].b64_json` → back into the `covers` and `media` storage buckets.
- Writes:
  - `projects.cover_image_url` + `cover_prompt` + `cover_effective_model` (front) — same fields the current cover flow writes, so existing realtime + history strip pick it up.
  - `media_assets` row (category `marketing-back`, source linked to project) holding the back image — same shape `BarcodeAndBackPanel` already lists.
  - `project_marketing.back_cover_url` is left for the existing back-bake step to fill after `bakeBackCover` runs.
- Logs to `ai_run_logs` with surface `generate-cover-pair` and the truncated prompt + reference URL.
- Background-mode parity: writes a single `image_generations` row with a new `pair_role` discriminator (or two rows `front` + `back`) so the existing batch progress pill can poll. Simplest version: insert ONE `image_generations` row, finish it when both images are saved, push the URLs through realtime by then; the panel reloads via the `media_assets` + `projects` realtime channels it already subscribes to.

### 2. Frontend wiring

**`src/features/project/packaging/CoverAndVisuals.tsx`** — remove the standalone "Generate front cover" generator. Replace it with a single "Generate front + back cover" button. Keep the prompt textarea and the model picker (locked to gpt-image-2 for this surface, with a small note explaining why). On click:
- Re-validate the union of today's front + back checklists. Bail with a single toast listing every missing field.
- Build `frontPrompt` via the existing `composeFrontPrompt` (already includes brand brief, meta, copy deck).
- Build `backPrompt` via a NEW shared helper `composeBackPrompt` extracted from `BarcodeAndBackPanel.composeFinalPrompt` so both panels can call it. Move it into a new `src/features/project/packaging/composePrompts.ts`.
- POST to `generate-cover-pair` with both prompts, `referenceImageUrl = project.cover_reference_url || houseDefault.url`, and `referenceLabel = company.company_name`.
- Show progress via the existing `BatchProgressContext` with two labels (`Front cover`, `Back cover`).

**`src/features/project/packaging/BarcodeAndBackPanel.tsx`** — remove the standalone "Generate back of box" button and its 4-variation generator. The panel keeps every other thing it already does: barcode, QR codes, copy deck editing, the box-side panel images (those stay separate — only the back cover itself is folded into the combined call). Add a small explanatory line: "The back cover is now generated together with the front from the Cover & Visuals panel." with a button that scrolls to that section.

### 3. Reference image logic

Unchanged from today's resolution: `effectiveReferenceUrl = project.cover_reference_url || houseDefault.url || null`. If neither exists we still call `gpt-image-2`, but via `/v1/images/generations` (no edits endpoint, no reference) — the function picks the right endpoint based on whether a reference was fetched, mirroring the logic already in `generate-image/index.ts`.

### 4. Pre-bake validation (combined)

Block generation unless ALL are present (toast lists every missing one):
- Title (front)
- Barcode (back)
- Primary QR (back)
- Back headline (back)
- Back body copy (back)
- Active company profile with `company_name` and `logo_url`

### 5. After generation — bake pipeline

No change to `bakeFrontCover` / `bakeBackCover`. The existing `useEffect` in `CoverAndVisuals` auto-bakes a fresh front the moment `cover_image_url` flips. We add the same auto-bake trigger for the back cover in `BarcodeAndBackPanel` if it isn't already there (it already runs today after a back-cover generation, so likely no-op).

## Out of scope

- The 4 box-side panel images stay on their existing per-image flow (they're separate from front/back).
- No DB migration. We reuse `image_generations`, `media_assets`, `projects.cover_image_url`, and `project_marketing.back_cover_url`.
- No model picker changes — gpt-image-2 is hard-coded for the combined call (only model that supports n=2 with shared style + reference image edit). The single-image fallback path still respects per-surface model overrides.

## Acceptance check

1. Hitting the new button on a fully-populated project sends ONE `POST /v1/images/edits` with `n=2`, the reference image, and the combined prompt — verifiable in `supabase--edge_function_logs` for `generate-cover-pair`.
2. Within ~60–90s both `projects.cover_image_url` and a new `media_assets` row (category `marketing-back`) are populated and visible on Overview, Cover & Visuals, and Barcode & Back without a refresh.
3. The two images visibly share palette/illustration/typography mood with the reference and with each other.
4. The standalone "Generate front" and "Generate back" buttons are gone.
