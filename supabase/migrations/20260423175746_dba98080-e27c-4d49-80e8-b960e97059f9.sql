CREATE TABLE public.hint_sheets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL,
  stage integer NOT NULL,
  image_url text,
  prompt text,
  prompt_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_model text,
  fallback text,
  requested_model text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (project_id, stage)
);

ALTER TABLE public.hint_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth all select hint_sheets" ON public.hint_sheets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth all insert hint_sheets" ON public.hint_sheets
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth all update hint_sheets" ON public.hint_sheets
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth all delete hint_sheets" ON public.hint_sheets
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_hint_sheets_updated_at
  BEFORE UPDATE ON public.hint_sheets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();