ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_ai_reasoning_effort_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_ai_reasoning_effort_check
  CHECK (ai_reasoning_effort IS NULL OR ai_reasoning_effort IN ('none','low','medium','high','xhigh'));