## Goal

1. Front cover only needs: **title** + **brand logo (top-left)** + **subtitle (under title)** + **bottom paragraph** — everything else comes from the brand's front-cover reference.
2. Back-of-box flow becomes two explicit buttons:
   - **Generate 4 in-game scenes** → one batch call (gpt-image-2, n=4), shared style, brand reference attached.
   - **Generate front + back covers** → uses brand reference + the 4 in-game scenes as additional reference images, fires a 2-image batch (n=2) for front + back.

---

## Front-cover fields cleanup (`CoverAndVisuals.tsx` + `composePrompts.ts`)

In the "Front cover text" section, **remove from UI and from prompt composition**:
- `tagline` (the marketing tagline duplicate)
- `front_company_slogan`
- `front_logo_note`
- `front_title_note` (was renamed to "Design brief" — also remove; brand's `cover_design_brief` covers this)
- `front_bottom_explanation` (consolidated into the one bottom paragraph below)

**Keep / rename:**
- Project `title` (Overview) — already baked top-center.
- Project `subtitle` (Overview) — relabel UI to "Subtitle (under title)".
- `front_subtext` → relabel UI to **"Bottom paragraph"**, single textarea, baked across the bottom strip.
- Brand: `logo_url` (top-left), `cover_design_brief` (always-on house style), and the chosen front-cover reference image — all driven entirely by the active company profile.

DB: no migration. Removed fields stay in the table (legacy data harmless) but UI no longer surfaces or sends them.

`composePrompts.ts → composeFrontPrompt` is reduced to: title + subtitle + bottom paragraph + publisher name + publisher cover_design_brief + FRONT_LAYOUT_SUFFIX.

`bakeFrontCover` call args trimmed to only the kept fields (`companySlogan`/`front_subtext` reduced to single `bottomParagraph`; logo still from `company.logo_url`).

---

## New: 4 in-game scenes

### UI (new section in `BarcodeAndBackPanel.tsx`, replaces the current 1/2/4 back-image generator)

```text
┌─────────────────────────────────────────────────────────────┐
│ In-game scenes (4)         [✨ Auto-suggest] [⚡ Generate 4]│
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Scene 1  │ │ Scene 2  │ │ Scene 3  │ │ Scene 4  │      │
│  │ [label]  │ │ [label]  │ │ [label]  │ │ [label]  │      │
│  │ [prompt] │ │ [prompt] │ │ [prompt] │ │ [prompt] │      │
│  │ [thumb ] │ │ [thumb ] │ │ [thumb ] │ │ [thumb ] │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
└─────────────────────────────────────────────────────────────┘
```

- Four labeled textareas (Scene 1–4), each with a short label/title field + the prompt.
- "Auto-suggest" → calls existing chat LLM (reuse `generate-text`/`ai-router` pattern) to fill all 4 from project context (suspects, setting, key props). User can edit afterwards.
- "Generate 4" → one call to the new edge function (below). Batch n=4, shared brand reference, shared style preface so they look like the same world.
- Thumbnails appear under each card after generation; individual regenerate-this-one button (single-image fallback path).

### Storage

- New rows in `media_assets` with `category = 'in-game-scene'`, `title = scene label`, position 1–4 stored in `prompt_history` metadata or by ordering on `created_at` (no schema change). Latest 4 are the "active set".

### New edge function: `generate-in-game-scenes`

- Input: `{ projectId, scenes: [{label, prompt}×4], referenceImageUrl }`.
- POST to OpenAI `/v1/images/edits` with `n=4`, the brand reference image attached, and one combined prompt that lists all 4 scenes with shared style preamble (same palette/lighting/illustration as reference, no text in image, square-ish).
- Saves 4 `media_assets` rows + writes to `ai_run_logs`.

---

## Updated front+back generator

### Trigger

Single button **"Generate front + back covers"** (already in place) — gated on:
- Title, bottom paragraph (front)
- Barcode, primary QR, back headline + body (back)
- Active company profile with logo
- **At least 4 in-game scenes exist** (new gate). Tooltip nudges user to "Generate 4 in-game scenes" first.

### What changes in `generate-cover-pair` edge function

- Accept new param `inGameSceneUrls: string[]` (up to 4).
- Call `/v1/images/edits` with `n=2`, attaching **multiple reference images** in the request: brand reference (first / primary) + the 4 in-game scene URLs.
- Combined prompt explicitly lists each attached reference and tells the model:
  - "Reference 1 = brand house style. Match palette / lighting / typography mood / paper finish."
  - "References 2–5 = scenes that exist INSIDE this case's world. Front cover may quote a hero detail from these; back cover MUST visually unify with these scenes."
- Front prompt half = trimmed `composeFrontPrompt` (title, subtitle, bottom paragraph, publisher cover_design_brief).
- Back prompt half = existing `composeBackPrompt` (unchanged).

### Frontend

`CoverAndVisuals.tsx` `handleGenerateCover`:
- Loads latest 4 `media_assets` where `category='in-game-scene'`.
- Adds them to the POST body as `inGameSceneUrls`.
- Validation message includes "Generate 4 in-game scenes first" when missing.

Auto-bake (`bakeFrontCover`) updated to use new field set: `title`, `subtitle`, `logoUrl`, `bottomParagraph` only.

---

## Files touched

**Edit**
- `src/features/project/packaging/CoverAndVisuals.tsx` — slim front fields UI, update validation, send `inGameSceneUrls`, update bake call.
- `src/features/project/packaging/BarcodeAndBackPanel.tsx` — remove old 1/2/4 back generator + box-side block, add new 4-scene UI section, add "Generate 4 in-game scenes" button + auto-suggest.
- `src/features/project/packaging/composePrompts.ts` — reduce `composeFrontPrompt` to the kept fields; extend `composeCoverPairPrompt` to mention attached in-game references.
- `src/features/project/packaging/bakeCover.ts` — adjust front-cover bake signature (single `bottomParagraph`, drop slogan).
- `supabase/functions/generate-cover-pair/index.ts` — accept `inGameSceneUrls`, attach as additional `image[]` entries on the OpenAI edits call.

**Create**
- `supabase/functions/generate-in-game-scenes/index.ts` — gpt-image-2 batch n=4 with brand reference + 4 prompts, writes 4 `media_assets`.
- (No migration — reuse `media_assets` + new `category` value.)

**Out of scope**
- DB schema changes, removing legacy `front_*` columns, model picker changes, the standalone box-side panel images concept (folded into in-game scenes).

---

## Acceptance

- Front-cover panel shows only: Subtitle (Overview-linked, read-only chip) + **Bottom paragraph** textarea. Tagline / company slogan / logo note / title note / bottom explanation gone.
- Back panel shows the 4-scene grid with auto-suggest + Generate 4 button. Old "Generate back of box (1/2/4 variations)" controls gone.
- Clicking "Generate 4 in-game scenes" produces 4 stylistically consistent images in ~60–90s.
- Clicking "Generate front + back covers" with 4 scenes present fires ONE `/v1/images/edits` call carrying brand-ref + 4 scene refs, returns 2 images that visibly belong to the same world as the scenes.
