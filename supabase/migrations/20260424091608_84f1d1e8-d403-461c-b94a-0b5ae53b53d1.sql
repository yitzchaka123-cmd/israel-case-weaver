ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS ui_background text NOT NULL DEFAULT 'bubblegum';