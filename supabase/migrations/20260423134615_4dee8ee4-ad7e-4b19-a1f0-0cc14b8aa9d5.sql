ALTER TABLE public.envelopes
  ADD COLUMN IF NOT EXISTS design_instructions text,
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS linked_node_ids uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS linked_document_ids uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS created_by_message_id uuid;