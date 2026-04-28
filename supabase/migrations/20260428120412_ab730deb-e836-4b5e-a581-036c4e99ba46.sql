ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS last_seen_planning_depth text;