-- 1. Back cover prompt
ALTER TABLE public.project_marketing
  ADD COLUMN IF NOT EXISTS back_cover_prompt text;

-- 2. Expanded company profile fields
ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS manufactured_by text,
  ADD COLUMN IF NOT EXISTS distributed_by text,
  ADD COLUMN IF NOT EXISTS warning_text text,
  ADD COLUMN IF NOT EXISTS box_footer_line text;

-- 3. Multi-QR support
CREATE TABLE IF NOT EXISTS public.project_qr_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label text,
  target_url text NOT NULL,
  qr_image_url text,
  is_primary boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_qr_codes_project_id_idx
  ON public.project_qr_codes(project_id);

ALTER TABLE public.project_qr_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth all select project_qr_codes" ON public.project_qr_codes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth all insert project_qr_codes" ON public.project_qr_codes
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth all update project_qr_codes" ON public.project_qr_codes
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth all delete project_qr_codes" ON public.project_qr_codes
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER set_project_qr_codes_updated_at
  BEFORE UPDATE ON public.project_qr_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.project_qr_codes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;