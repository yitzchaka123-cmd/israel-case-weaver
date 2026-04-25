-- Add planning_depth column to projects + default_planning_depth to profiles
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS planning_depth text NOT NULL DEFAULT 'guided';

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_planning_depth_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_planning_depth_check
  CHECK (planning_depth IN ('express', 'guided', 'deep'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_planning_depth text NOT NULL DEFAULT 'guided';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_default_planning_depth_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_default_planning_depth_check
  CHECK (default_planning_depth IN ('express', 'guided', 'deep'));