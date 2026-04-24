ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS skill_source TEXT,
  ADD COLUMN IF NOT EXISTS skill_name TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'generated',
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS created_by_message_id UUID;

ALTER TABLE public.claude_skills
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS installed_by UUID,
  ADD COLUMN IF NOT EXISTS installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS install_status TEXT NOT NULL DEFAULT 'installed',
  ADD COLUMN IF NOT EXISTS install_error TEXT;

CREATE INDEX IF NOT EXISTS idx_media_assets_project_status ON public.media_assets (project_id, status);
CREATE INDEX IF NOT EXISTS idx_media_assets_source_document ON public.media_assets (source_document_id);
CREATE INDEX IF NOT EXISTS idx_claude_skills_enabled_scope ON public.claude_skills (enabled, skill_type);