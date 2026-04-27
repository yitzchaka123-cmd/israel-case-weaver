# Fix batch of 8 issues across canvas, marketing, assistant & media

## 1. Doc 0 envelopes are spoilers — hide their payloads

In `loadDoc0InventoryContext` (`supabase/functions/generate-document/index.ts`), the envelope list is currently passed to the model with the full task text:

```
- Envelope 2: Decode the cipher — open after you've identified the cipher key
```

…which the model then prints into Doc 0. **Hard rule:** Doc 0 must list envelopes by NUMBER + LABEL only — never the task / payload / opening-trigger text. Strip envelope `task` (and any `opening_trigger`) from the inventory context, and add an explicit "envelope tasks are SPOILERS — never list them" rule to every Doc 0 prompt (text, file, image). Render envelopes as a separate "Sealed envelopes" section (numbered) in the inventory output.

## 2. "Refine with AI" arrange isn't doing what you expect

The current `mode: "ai-refine"` only asks the LLM for **logical groupings** (which nodes should sit next to each other) and re-runs the deterministic packer. It never repositions individual nodes itself. That matches the original spec but clearly doesn't match what you want now.

**Question for you (asked below):** what should "Refine with AI" actually do?

Default plan if you confirm: rename the current button to "**Smart arrange**" (it already cycles deterministic variants), and rebuild "**Refine with AI**" to:
- Read the current node titles, descriptions, edges, AND your case brief.
- Re-cluster nodes by *narrative role* (suspect-by-suspect, clue-chain, red-herring sidebar, solution at the end).
- Push the suggested grouping AND a per-cluster ordering (which clue comes first inside each cluster) back into the deterministic packer.
- Add a 1-line summary toast: "AI grouped X clusters: <names>".

## 3. Canvas zoom — let me zoom way further out / in

`CanvasSection.tsx` already sets `minZoom={0.05}` / `maxZoom={4}` but ReactFlow's default Controls toolbar caps zoom-out at the configured `minZoom` after a couple of clicks. Open up to `minZoom={0.02}` / `maxZoom={6}`, and also widen the keyboard/wheel pan/zoom range so trackpad pinch can get there too. `fitView` will use the same range.

## 4. Batch image generation — show "X / N generated" pill

When the back-cover panel kicks 4 parallel jobs (`fireBackgroundImage` × N) there's currently no progress feedback. Add a sticky progress strip at the top of the **Marketing** tab (mirror of the existing one in `DocumentsSection.tsx` for `bulk_generation_jobs`).

Implementation: subscribe to `media_assets` realtime for the session's job ids and count them as they flip from `pending` → `generated`/`failed`. No new table — just track the kicked job ids in component state and display "Generated 2 / 4 …" with per-card spinners.

## 5. Assistant keeps yanking back to bottom while reasoning

`AssistantSection.tsx` line 269-272 calls `scrollTo({ top: scrollHeight })` on every `messages` / `sending` change — including on every reasoning-token streaming update. Fix: only auto-scroll if the user is **already near the bottom** (within ~80 px of `scrollHeight`). If they've scrolled up to read, let them stay. Add a small "↓ Jump to latest" pill that fades in when the user is scrolled up and there's new content.

## 6. Download icons in every media place

Add a small download button to:
- `ImageHistoryStrip` (top-right corner of each thumbnail's lightbox + a row in the strip)
- `MediaSection` (every asset card)
- `MediaLibrarySection` (every row)
- `SuspectsSection` (suspect thumbnails)
- `EnvelopesSection` (envelope cover mock-up)
- `CoverAndVisuals` (extras grid + main cover)
- `BarcodeAndBackPanel` (back-cover candidates + barcode + each QR PNG)
- `HintsSection` / `MediaSection` document files

One shared helper `downloadAsset(url, filename)` in `src/lib/utils.ts` (fetches the URL → blob → `<a download>` click). Renames default to a slug of the project + asset title.

## 7. Default image quality = high everywhere + assistant "high quality" trigger

- Change `getStoredImageQuality(... fallback)` default from `"medium"` to `"high"` everywhere it's called (covers, suspects, envelopes, hint sheets, back cover, marketing extras, storyboard).
- Change the `<select>` initial state in `ImageModelPicker.tsx` from `"medium"` to `"high"`.
- Keep the High warning ("can take up to 2 min").
- Add an assistant playbook rule: when the user says "high quality", "in high res", "redo at high quality", "regenerate hi-res" (and Hebrew variants "באיכות גבוהה"), the assistant must call the matching regenerate tool (cover / suspect / envelope / inline image / etc.) with `quality: "high"`. Existing tools all accept a `quality` arg; we'll just thread it through.

## 8. "Generation" tab → simple prompt-and-go generator

The Generation tab (`MediaSection.tsx`) overlaps with Marketing. Strip it down to:
- One image-model picker
- One `ImagePromptAssistant` (the same prompter used elsewhere)
- One "Generate image" button
- A single grid of every image generated from this surface (category = `external` / `manual`)
- Download icon per item

Remove the Cover / Back / News / Promo / External-uploads sub-tabs (they all live in Marketing now, except External uploads which stays as an upload box at the bottom of the simplified panel).

## 9. Cover generators must use ALL the marketing copy + barcode + QR + 4 extra back-of-box images

Front cover (`CoverAndVisuals.tsx` + `bakeCover.ts`):
- **Block generation** if `project.title` is empty (front needs at minimum: title; uses subtitle + company logo if available). Show a clear "Fill in title (and ideally subtitle) on Overview before generating the cover."
- The composed prompt now passes title, subtitle, mystery_type, setting, AND `front_subtext` / `front_company_slogan` / `front_logo_note` from `project_marketing` so the AI knows what zones to leave clean.
- After generation the existing `bakeFrontCover` already paints title/subtitle/logo — extend it to also paint the company slogan (small, under logo) and any `front_subtext` (small, bottom-left).

Back cover (`BarcodeAndBackPanel.tsx` + `bakeCover.ts`):
- **Block generation** if any of these are missing: barcode, primary QR, back_headline, back_body, company name, company logo. Show a checklist of what's missing.
- Pass barcode + primary-QR PNGs as `image_url` reference inputs (Nano Banana edit mode) so the AI builds the design AROUND the actual codes, not generic placeholders. Today they're only baked on after the fact.
- The composed prompt (`composeFinalPrompt`) now also includes: `back_whats_in_box`, `back_how_to_play`, `back_feature_bullets`, `back_specs`, `back_content_note`, `back_footer_text`, every QR's label, the company name + tagline, and every "extra image" caption — so the AI lays out a real back-of-box, not just a vibe shot.
- **Add 4 "box-side" image slots** to the back cover as discussed: spawn 4 small `marketing-back-extra` jobs using the back prompt's secondary scene description (component shots / mood pieces) and bake them along the right edge of the back cover at print time. Stored in the `marketing-back` category with `title` "Box side 1/2/3/4" so they're visible and downloadable in the Marketing gallery too.

## Files touched

- `supabase/functions/generate-document/index.ts` — Doc 0 envelope hiding
- `supabase/functions/arrange-canvas/index.ts` — narrative-cluster AI refine
- `supabase/functions/assistant-chat/index.ts` — "high quality" trigger
- `src/features/project/CanvasSection.tsx` — zoom range
- `src/features/project/AssistantSection.tsx` — sticky-only-when-at-bottom scroll
- `src/features/project/MediaSection.tsx` — strip down to simple generator
- `src/features/project/marketing/CoverAndVisuals.tsx` — gating + richer prompt
- `src/features/project/marketing/BarcodeAndBackPanel.tsx` — gating + richer prompt + 4 box-side images + reference PNG passthrough
- `src/features/project/marketing/bakeCover.ts` — extra slots + box-side painting
- `src/components/ImageHistoryStrip.tsx` — download icon
- `src/components/ImageModelPicker.tsx` — default quality = high
- `src/lib/utils.ts` — `downloadAsset()` helper
- `src/features/project/SuspectsSection.tsx` / `EnvelopesSection.tsx` / `MediaLibrarySection.tsx` — wire download icons
- (no DB schema changes)

## Out of scope for this turn
- Drag-to-reorder QR codes
- Storyboard-shot download icons (will land in a follow-up if you want)

Couple of clarifying questions are below so I don't guess wrong on the two ambiguous items.
