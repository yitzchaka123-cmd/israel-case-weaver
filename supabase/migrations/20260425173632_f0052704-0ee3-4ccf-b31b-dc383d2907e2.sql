ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS proposed_document_set jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS proposed_document_set_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS proposed_document_set_status text NOT NULL DEFAULT 'none';