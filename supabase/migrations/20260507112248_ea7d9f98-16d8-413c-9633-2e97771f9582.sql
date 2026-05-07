ALTER TABLE public.envelopes
  ADD COLUMN IF NOT EXISTS solution_video_url text,
  ADD COLUMN IF NOT EXISTS solution_text text,
  ADD COLUMN IF NOT EXISTS followup_clue_note text;