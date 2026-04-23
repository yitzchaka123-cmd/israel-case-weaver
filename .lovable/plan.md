

## Goal

Make the OpenAI image models (ChatGPT Image 2 + ChatGPT Image 1) selectable everywhere in the app where images are generated. The picker already supports both — they're just missing from four panels. Also expose the optional second OpenAI account so you can route `gpt-image-2` to a separate billing key.

## What's already done (no change needed)

- The `ImageModelPicker` already lists **ChatGPT Image 2 (gpt-image-2) — latest** and **ChatGPT Image 1 (gpt-image-1)** at the top of the dropdown.
- The picker is already rendered on: **Suspects**, **Project cover (overview)**, **Envelopes**, **Documents**.
- Backend `generate-image` already routes both OpenAI models, including the optional dedicated key path (`OPENAI_IMAGE2_API_KEY`) for `gpt-image-2`.

## What's missing (the actual work)

The picker is NOT shown in these four image-generating panels — they silently use whatever was last picked under the `"media"` storage key:

1. **Media tab** (`src/features/project/MediaSection.tsx`) — main media generator
2. **Marketing → Cover & Visuals** (`src/features/project/marketing/CoverAndVisuals.tsx`) — back-of-box + extras
3. **Marketing → Storyboard Studio** (`src/features/project/marketing/StoryboardStudio.tsx`) — keyframe per shot
4. **Marketing → Barcode & Back Panel** (`src/features/project/marketing/BarcodeAndBackPanel.tsx`) — back-of-box render

### Changes per file

For each of the four files above:
- Import `ImageModelPicker` from `@/components/ImageModelPicker`.
- Render `<ImageModelPicker surface="..." defaultModel="..." />` next to the existing "Generate" button (matching the pattern already used in `EnvelopesSection` / `DocumentsSection`).
- Use a **dedicated surface key per panel** so each remembers its own model independently (today they all share `"media"`, which causes one panel's choice to silently affect another):
  - `MediaSection` → surface `"media"`, default `chatgpt-image-2`
  - `CoverAndVisuals` → surface `"marketing-cover"`, default `chatgpt-image-2`
  - `StoryboardStudio` → surface `"storyboard"`, default `nano-banana-2` (storyboards are many shots → speed matters)
  - `BarcodeAndBackPanel` → surface `"marketing-back"`, default `chatgpt-image-2`
- Update the matching `getStoredImageModel(...)` / `getStoredImageQuality(...)` calls in those files to use the new surface key.

### Default model bump

Currently most surfaces default to `chatgpt-image` (the legacy gpt-image-1). New default for cover, suspect, envelope, document, media, marketing surfaces becomes **`chatgpt-image-2`** (latest). Storyboard keeps `nano-banana-2` for speed. Existing user choices in localStorage are preserved.

### Optional second OpenAI key (already wired)

The picker already shows a small hint under "ChatGPT Image 2": *"Uses a dedicated OpenAI account if `OPENAI_IMAGE2_API_KEY` is set, otherwise the main OpenAI key."*

No code change needed — but the secret isn't currently configured. After the UI changes are in, if you want to route `gpt-image-2` traffic to a separate OpenAI billing account, add the secret `OPENAI_IMAGE2_API_KEY` in Lovable Cloud settings. (I'll prompt for it after the plan is approved if you want it.)

## Validation

- Open Media, Marketing → Cover & Visuals, Marketing → Storyboard, Marketing → Barcode/Back: each shows a model dropdown with **ChatGPT Image 2 (latest)** at the top.
- Selecting ChatGPT Image 2 in one panel does NOT change the model in another panel (per-surface persistence).
- Generating an image from any panel routes through OpenAI when an OpenAI model is picked, and through Gemini/Lovable AI when a Nano Banana model is picked.
- No console errors, no missing imports.

## Out of scope

- No backend / edge function changes.
- No DB migrations.
- No changes to non-image generators (text, copy, storyboard script, etc.).

