-- Inline images table
CREATE TABLE public.document_inline_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  slot_label text NOT NULL DEFAULT 'Image',
  prompt text,
  url text,
  uploaded_url text,
  active_version text NOT NULL DEFAULT 'generated',
  prompt_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  url_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_anchor boolean NOT NULL DEFAULT false,
  anchor_image_id uuid REFERENCES public.document_inline_images(id) ON DELETE SET NULL,
  group_key text,
  provider text,
  model text,
  effective_model text,
  fallback text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_by_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_inline_images_document_id ON public.document_inline_images(document_id);
CREATE INDEX idx_document_inline_images_project_id ON public.document_inline_images(project_id);
CREATE INDEX idx_document_inline_images_group ON public.document_inline_images(document_id, group_key);

ALTER TABLE public.document_inline_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth all select document_inline_images"
  ON public.document_inline_images FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Auth all insert document_inline_images"
  ON public.document_inline_images FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Auth all update document_inline_images"
  ON public.document_inline_images FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Auth all delete document_inline_images"
  ON public.document_inline_images FOR DELETE
  TO authenticated USING (true);

CREATE TRIGGER trg_document_inline_images_updated_at
  BEFORE UPDATE ON public.document_inline_images
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.document_inline_images;
ALTER TABLE public.document_inline_images REPLICA IDENTITY FULL;

-- Documents additions
ALTER TABLE public.documents
  ADD COLUMN inline_images_layout text DEFAULT 'bottom-grid-2col',
  ADD COLUMN inline_images_caption text;