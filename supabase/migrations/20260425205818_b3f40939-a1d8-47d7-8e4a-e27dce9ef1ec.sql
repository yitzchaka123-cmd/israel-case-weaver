ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS ai_reasoning_effort text NOT NULL DEFAULT 'medium'
    CHECK (ai_reasoning_effort IN ('none','low','medium','high'));