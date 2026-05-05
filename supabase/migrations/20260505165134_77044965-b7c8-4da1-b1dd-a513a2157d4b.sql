ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS consistent_set_id uuid,
  ADD COLUMN IF NOT EXISTS consistent_set_anchor_url text;

CREATE INDEX IF NOT EXISTS idx_documents_consistent_set_id
  ON public.documents(consistent_set_id);