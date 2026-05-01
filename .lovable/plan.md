## Goal

Generate envelope page mock-ups with **ChatGPT Image 2** (`gpt-image-2`) instead of Nano Banana 2, and confirm we're calling OpenAI's image API the right way per the latest docs.

## On gpt-image-2 (per OpenAI docs)

- Endpoint: `POST https://api.openai.com/v1/images/generations` ✅ (we already use this)
- Model id: `gpt-image-2` ✅ (already mapped in `IMAGE_MODEL`)
- Sizes: `1024x1024`, `1024x1536` (portrait), `1536x1024` (landscape) ✅
- Quality: `low` | `medium` | `high` ✅
- `n`: supported (per-call multi-image), `output_format`: `png` | `jpeg` | `webp`, `output_compression`, `moderation: "auto"` ✅
- **Streaming**: not supported. **Function calling**: not supported.
- **Batch API** (`v1/batch`): supported, but it's an **asynchronous 24-hour-turnaround** job queue meant for offline workloads — not for an interactive "Generate all" button. So we **won't** wire it up for envelope mock-ups; instead we already fan out parallel `n=1` requests with `runWithConcurrency`, which is the correct pattern for synchronous UI.
- Rate limits on Tier 1 are very tight (5 IPM). If the user hits 429 during "Generate all page mock-ups", we should surface the existing 429 message clearly. No code change needed beyond what we already do.

Conclusion: our existing OpenAI call shape is already correct and on-spec. The only thing wrong is that we force-route envelopes off OpenAI.

## Changes

### 1. `supabase/functions/generate-image/index.ts`

Remove the auto-reroute that downgrades envelopes to Nano Banana 2.

- Delete the line that flips `pref` to `"nano-banana-2"` when `target === "envelope"` and the requested model is OpenAI (around line 276). Envelopes should honor whatever model the caller picked, just like every other surface.
- Keep the existing 145s `AbortController` timeout and the friendly 504 error message — that's the right safety net if `gpt-image-2` at high quality runs long.
- No other changes to the OpenAI request body — `model`, `prompt`, `size`, `quality`, `n: 1`, `moderation: "auto"`, `output_format: "jpeg"`, `output_compression: 90` are all valid for `gpt-image-2`.

### 2. `src/components/ImageModelPicker.tsx`

Stop hiding ChatGPT Image options for the envelope surface.

- In `getStoredImageModel`, remove the special-case `if (surface === "envelope" && (v === "chatgpt-image" || v === "chatgpt-image-2")) return fallback;` so a stored ChatGPT preference for envelopes is respected.
- In the picker render, remove the `surface === "envelope" ? IMAGE_MODELS.filter(...) : IMAGE_MODELS` filter so all models (including both `chatgpt-image-2` and `chatgpt-image-1`) appear in the envelope dropdown.

### 3. `src/features/project/EnvelopesSection.tsx`

Make ChatGPT Image 2 the default for envelopes and stop forcing medium quality on OpenAI.

- Change `getStoredImageModel("envelope", "nano-banana-2")` → `getStoredImageModel("envelope", "chatgpt-image-2")` so new users default to ChatGPT Image 2 and existing nano-banana selections persist.
- Remove the `envelopeImageQuality` downgrade (`model.startsWith("chatgpt-image") && quality === "high" ? "medium" : quality`). gpt-image-2 supports `high`; let the user choose. We keep the 145s timeout in the edge function as the safety net, and the picker already shows the "High can take up to 2 min" warning.
- The `pageInsertPrompt` wrapper stays as-is (it instructs the model that this is an A4 page insert, not an envelope cover, with varied tactile realism — that's exactly what we want for gpt-image-2 too).

### 4. (No change) Generation flow

- "Generate all page mock-ups" already fans out per-envelope with `runWithConcurrency` and `mode: "background"`, so each call is its own job and a single slow envelope can't block the others. That's the correct pattern for `gpt-image-2` since OpenAI's Batch API is asynchronous (24h SLA) and unsuitable for interactive use.

## Acceptance check

- Open an envelope card → model picker shows **ChatGPT Image 2** as the default and Nano Banana options are still selectable.
- Click "Generate all page mock-ups" → requests go to `gpt-image-2` via `api.openai.com/v1/images/generations`, return JPEGs, and land on each envelope card.
- AI Run Log shows `requestedModel: gpt-image-2`, `provider: openai-direct` (or `openai-image2` if `OPENAI_IMAGE2_API_KEY` is set), no automatic Gemini fallback.
- If a single call exceeds 145s, the user gets the existing "OpenAI took too long" message on that one envelope only; the rest still complete.

## Out of scope

- Wiring up OpenAI's `v1/batch` Files API for envelopes — async 24h turnaround makes it the wrong fit for a "click to generate" flow. Happy to add it later as an opt-in "Queue overnight render" if you want.
- Changing any other surface's default model.
- Text-drafting flow for envelopes (unchanged).
