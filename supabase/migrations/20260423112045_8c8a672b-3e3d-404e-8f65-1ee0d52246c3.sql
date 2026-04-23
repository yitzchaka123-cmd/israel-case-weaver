ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS assistant_playbook jsonb NOT NULL DEFAULT '{}'::jsonb;