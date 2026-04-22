ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS image_prompt_instructions text,
  ADD COLUMN IF NOT EXISTS video_prompt_instructions text;