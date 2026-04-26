CREATE TABLE public.image_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  source_document_id UUID,
  source_envelope_id UUID,
  prompt TEXT,
  model TEXT,
  provider TEXT,
  quality TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  url TEXT,
  mime_type TEXT,
  error_message TEXT,
  effective_model TEXT,
  fallback TEXT,
  created_by_message_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_image_generations_document ON public.image_generations(source_document_id, created_at DESC);
CREATE INDEX idx_image_generations_envelope ON public.image_generations(source_envelope_id, created_at DESC);
CREATE INDEX idx_image_generations_project ON public.image_generations(project_id, created_at DESC);

ALTER TABLE public.image_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth all select image_generations"
  ON public.image_generations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth all insert image_generations"
  ON public.image_generations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth all update image_generations"
  ON public.image_generations FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth all delete image_generations"
  ON public.image_generations FOR DELETE TO authenticated USING (true);

CREATE TRIGGER set_image_generations_updated_at
  BEFORE UPDATE ON public.image_generations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.image_generations;