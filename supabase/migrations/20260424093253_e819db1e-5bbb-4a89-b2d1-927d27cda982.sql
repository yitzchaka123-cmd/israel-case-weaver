ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS game_language TEXT NOT NULL DEFAULT 'Hebrew';