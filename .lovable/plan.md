# Roll out the Documents prompt system everywhere

Bring the new Documents experience — **Prompt Assistant (single Design field) + Create-prompt button + 24-item history carousel with click-to-preview + AI-origin badge + Final-asset selector (image vs. uploaded) + async polling** — to **all four image-generation surfaces**.

---

## 1. New shared component: `ImagePromptAssistant`

A trimmed cousin of `DocumentPromptAssistant` for image-only surfaces.

**File:** `src/components/ImagePromptAssistant.tsx`

- Two tabs: **Instructions** (free-text steering, component state) and **Final prompt** (single editable Design field, persisted via `onChange`).
- Single button: **Create prompt** → calls `suggest-image-prompt` with `category` and surface-specific context, clears the final prompt immediately, and fills it with the assistant's design output.
- Per-surface `PromptWriterModelPicker`.
- No "Generate automatically" / "Revise prompt" buttons (matches the Documents cleanup).

The existing `suggest-image-prompt` edge function already returns a `design` string — we'll just consume `design_instructions` and ignore `content` when called from these surfaces.

---

## 2. New shared component: `ImageHistoryStrip`

Extracted from the inline `HistoryStrip` in `DocumentsSection.tsx`.

**File:** `src/components/ImageHistoryStrip.tsx`

- Props: `items: MediaHistoryRow[]`, `currentUrl`, `onRestore(item)`, `title`.
- Up to 24 thumbnails, click opens a `Dialog` lightbox with `AiOriginBadge` showing the model + provider + fallback.
- Lightbox has a **Restore** button that calls `onRestore` (sets the row's image URL back + flips `active_version` to `generated`).

---

## 3. New shared component: `FinalAssetPicker`

Two-option `RadioGroup`: **Generated image** vs. **Uploaded file**. Disables options when the corresponding URL is null. Writes `active_version` back via `onChange`.

**File:** `src/components/FinalAssetPicker.tsx`

---

## 4. Database migrations

Add `active_version` (`text`, default `'generated'`) and uploaded-asset slots where missing, plus `source_*` columns on `media_assets` so history can be queried per surface.

**New migration file** under `supabase/migrations/`:

```sql
-- Suspects: track active asset + already have thumbnail_url + uploaded thumbnail
ALTER TABLE public.suspects
  ADD COLUMN IF NOT EXISTS active_version text NOT NULL DEFAULT 'generated',
  ADD COLUMN IF NOT EXISTS uploaded_thumbnail_url text;

-- Hint sheets
ALTER TABLE public.hint_sheets
  ADD COLUMN IF NOT EXISTS active_version text NOT NULL DEFAULT 'generated',
  ADD COLUMN IF NOT EXISTS uploaded_image_url text;

-- Projects already have cover_image_url. Add active_version + uploaded slot.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS cover_active_version text NOT NULL DEFAULT 'generated',
  ADD COLUMN IF NOT EXISTS uploaded_cover_url text;

-- Media assets: enable per-surface history queries
ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS source_suspect_id uuid,
  ADD COLUMN IF NOT EXISTS source_hint_sheet_id uuid,
  ADD COLUMN IF NOT EXISTS source_project_cover boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS media_assets_source_suspect_id_idx ON public.media_assets (source_suspect_id);
CREATE INDEX IF NOT EXISTS media_assets_source_hint_sheet_id_idx ON public.media_assets (source_hint_sheet_id);
```

(No RLS changes — `media_assets` already has the permissive auth-all policies.)

---

## 5. Edge function: stamp the source on every image

Update `supabase/functions/generate-image/index.ts` so that when it inserts a `media_assets` row it also sets the appropriate `source_suspect_id` / `source_hint_sheet_id` / `source_project_cover` based on `category` and the IDs already passed in the request body. Same change to the cover branch in `generate-document` is unnecessary (only documents/envelopes use it).

Also extend `image_generations` (used for async high-quality jobs) so suspect/hint/cover async runs are tracked the same way as documents — add nullable `source_suspect_id`, `source_hint_sheet_id`, `source_project_cover` columns:

```sql
ALTER TABLE public.image_generations
  ADD COLUMN IF NOT EXISTS source_suspect_id uuid,
  ADD COLUMN IF NOT EXISTS source_hint_sheet_id uuid,
  ADD COLUMN IF NOT EXISTS source_project_cover boolean NOT NULL DEFAULT false;
```

Then in `generate-image`, when running OpenAI High quality, kick off the same `EdgeRuntime.waitUntil` background job pattern that `generate-document` uses, and write to `image_generations` with the right source linkage. Return the `jobId` so the UI can poll.

---

## 6. Refactor each surface

### a) `src/features/project/SuspectsSection.tsx`
- Replace `<PromptPanel … surface="suspect">` with the new **Prompt Assistant** stack:
  - `ImagePromptAssistant` writing to `suspect.thumbnail_prompt`.
  - `ImageHistoryStrip` driven by `media_assets.source_suspect_id = suspect.id`.
  - Click-to-preview lightbox with `AiOriginBadge`.
  - `FinalAssetPicker` (Generated vs. Uploaded), bound to `active_version` + `uploaded_thumbnail_url`.
- Polling for async jobs: subscribe to `image_generations` rows with matching `source_suspect_id` while a job is pending.

### b) `src/features/project/HintsSection.tsx`
- Same replacement, scoped per stage's `hint_sheet`.
- History from `media_assets.source_hint_sheet_id`.
- `FinalAssetPicker` writes to `hint_sheets.active_version` + `uploaded_image_url`.

### c) `src/features/project/ProjectOverview.tsx` and `src/features/project/marketing/CoverAndVisuals.tsx`
- Replace cover `PromptPanel` with the new stack.
- History from `media_assets.source_project_cover = true AND project_id = …`.
- `FinalAssetPicker` writes to `projects.cover_active_version` + `uploaded_cover_url`.
- Keep the existing "Output type" PDF/image toggle in CoverAndVisuals unchanged.

### d) `src/features/project/MediaSection.tsx` and marketing extras in `CoverAndVisuals.tsx`
- For each generated media slot: same Prompt Assistant + history strip per `category`.
- Final-asset selector applies only where the slot has both an uploaded and a generated asset; for ad-hoc gallery items (marketing extras), the selector is omitted because each item is its own asset.

---

## 7. Export priority

`src/lib/export.ts` already has `pickActiveAsset` for documents. Mirror the same priority logic for suspect portraits, hint sheets, and the project cover so exports honor the new `active_version` columns. (One small helper per surface, called from wherever the export currently picks the URL.)

---

## 8. Files touched

**New**
- `src/components/ImagePromptAssistant.tsx`
- `src/components/ImageHistoryStrip.tsx`
- `src/components/FinalAssetPicker.tsx`
- `supabase/migrations/<timestamp>_image_assistant_rollout.sql`

**Edited**
- `src/features/project/SuspectsSection.tsx`
- `src/features/project/HintsSection.tsx`
- `src/features/project/ProjectOverview.tsx`
- `src/features/project/marketing/CoverAndVisuals.tsx`
- `src/features/project/MediaSection.tsx`
- `src/lib/export.ts`
- `supabase/functions/generate-image/index.ts`
- `src/integrations/supabase/types.ts` *(auto-regenerated)*

**Untouched** (already on the new system)
- `src/features/project/DocumentsSection.tsx`
- `src/features/project/EnvelopesSection.tsx`

---

## What we are NOT doing
- Not removing `PromptPanel.tsx` yet — once the four surfaces are switched over and verified, we can delete it in a follow-up to keep this change focused.
- Not changing the assistant tweak / playbook plumbing — same `suggest-image-prompt` is reused.
- Not adding a "Generated document file" option to the Final-asset selector on image-only surfaces (you confirmed image vs. uploaded only).