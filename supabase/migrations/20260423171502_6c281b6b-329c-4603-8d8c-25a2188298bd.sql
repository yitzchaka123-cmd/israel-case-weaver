-- ============================================================
-- 1. ai_run_logs table
-- ============================================================
CREATE TABLE public.ai_run_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  project_id uuid,
  surface text NOT NULL,
  requested_model text,
  effective_model text,
  fallback text NOT NULL DEFAULT 'none',
  status text NOT NULL DEFAULT 'ok',
  latency_ms integer,
  error_message text,
  target_id uuid,
  prompt_excerpt text
);

CREATE INDEX idx_ai_run_logs_user_created ON public.ai_run_logs (user_id, created_at DESC);
CREATE INDEX idx_ai_run_logs_project_created ON public.ai_run_logs (project_id, created_at DESC);
CREATE INDEX idx_ai_run_logs_surface ON public.ai_run_logs (surface);
CREATE INDEX idx_ai_run_logs_fallback ON public.ai_run_logs (fallback);

ALTER TABLE public.ai_run_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own ai_run_logs"
  ON public.ai_run_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all ai_run_logs"
  ON public.ai_run_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- inserts only via service role (edge functions); no insert policy for authenticated.
-- service role bypasses RLS by default.

-- ============================================================
-- 2. media_assets columns
-- ============================================================
ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS effective_model text,
  ADD COLUMN IF NOT EXISTS fallback text,
  ADD COLUMN IF NOT EXISTS prompt_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================
-- 3. suspects columns
-- ============================================================
ALTER TABLE public.suspects
  ADD COLUMN IF NOT EXISTS thumbnail_prompt text,
  ADD COLUMN IF NOT EXISTS thumbnail_prompt_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS alt_thumbnail_prompt text,
  ADD COLUMN IF NOT EXISTS alt_thumbnail_prompt_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS thumbnail_effective_model text,
  ADD COLUMN IF NOT EXISTS thumbnail_fallback text,
  ADD COLUMN IF NOT EXISTS alt_thumbnail_effective_model text,
  ADD COLUMN IF NOT EXISTS alt_thumbnail_fallback text;

-- ============================================================
-- 4. projects columns
-- ============================================================
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS cover_prompt text,
  ADD COLUMN IF NOT EXISTS cover_prompt_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cover_effective_model text,
  ADD COLUMN IF NOT EXISTS cover_fallback text;

-- ============================================================
-- 5. envelopes columns
-- ============================================================
ALTER TABLE public.envelopes
  ADD COLUMN IF NOT EXISTS cover_prompt text,
  ADD COLUMN IF NOT EXISTS cover_prompt_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cover_effective_model text,
  ADD COLUMN IF NOT EXISTS cover_fallback text;

-- ============================================================
-- 6. project_storyboards columns
-- ============================================================
ALTER TABLE public.project_storyboards
  ADD COLUMN IF NOT EXISTS shot_prompts jsonb NOT NULL DEFAULT '{}'::jsonb;