-- Suspects: track active asset + uploaded thumbnail
ALTER TABLE public.suspects
  ADD COLUMN IF NOT EXISTS active_version text NOT NULL DEFAULT 'generated',
  ADD COLUMN IF NOT EXISTS uploaded_thumbnail_url text;

-- Hint sheets: track active asset + uploaded image
ALTER TABLE public.hint_sheets
  ADD COLUMN IF NOT EXISTS active_version text NOT NULL DEFAULT 'generated',
  ADD COLUMN IF NOT EXISTS uploaded_image_url text;

-- Projects: track active cover + uploaded cover
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS cover_active_version text NOT NULL DEFAULT 'generated',
  ADD COLUMN IF NOT EXISTS uploaded_cover_url text;

-- Media assets: per-surface history queries
ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS source_suspect_id uuid,
  ADD COLUMN IF NOT EXISTS source_hint_sheet_id uuid,
  ADD COLUMN IF NOT EXISTS source_project_cover boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS media_assets_source_suspect_id_idx
  ON public.media_assets (source_suspect_id);
CREATE INDEX IF NOT EXISTS media_assets_source_hint_sheet_id_idx
  ON public.media_assets (source_hint_sheet_id);
CREATE INDEX IF NOT EXISTS media_assets_source_project_cover_idx
  ON public.media_assets (project_id) WHERE source_project_cover = true;

-- Image generations (async jobs): match the same source linkage
ALTER TABLE public.image_generations
  ADD COLUMN IF NOT EXISTS source_suspect_id uuid,
  ADD COLUMN IF NOT EXISTS source_hint_sheet_id uuid,
  ADD COLUMN IF NOT EXISTS source_project_cover boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS image_generations_source_suspect_id_idx
  ON public.image_generations (source_suspect_id);
CREATE INDEX IF NOT EXISTS image_generations_source_hint_sheet_id_idx
  ON public.image_generations (source_hint_sheet_id);