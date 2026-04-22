ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS image_prompt_assistant_instructions text;