-- Company profiles (workspace-level, one per user)
CREATE TABLE public.company_profiles (
  owner_id uuid PRIMARY KEY,
  company_name text,
  tagline text,
  legal_text text,
  support_email text,
  website text,
  address text,
  country text,
  age_rating text,
  made_in text,
  logo_url text,
  social jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth all select company_profiles" ON public.company_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth all insert company_profiles" ON public.company_profiles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth all update company_profiles" ON public.company_profiles FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth all delete company_profiles" ON public.company_profiles FOR DELETE TO authenticated USING (true);

CREATE TRIGGER set_company_profiles_updated_at BEFORE UPDATE ON public.company_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Project marketing (per-project box copy)
CREATE TABLE public.project_marketing (
  project_id uuid PRIMARY KEY,
  front_subtext text,
  back_headline text,
  back_body text,
  tagline text,
  barcode_value text,
  barcode_url text,
  back_cover_url text,
  copy_origins jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_marketing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth all select project_marketing" ON public.project_marketing FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth all insert project_marketing" ON public.project_marketing FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth all update project_marketing" ON public.project_marketing FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth all delete project_marketing" ON public.project_marketing FOR DELETE TO authenticated USING (true);

CREATE TRIGGER set_project_marketing_updated_at BEFORE UPDATE ON public.project_marketing
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Project storyboards (per-project mini-movie)
CREATE TABLE public.project_storyboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  length_seconds int NOT NULL DEFAULT 60,
  script_instructions text,
  sora_instructions text,
  kling_instructions text,
  shots jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_storyboards_project ON public.project_storyboards(project_id, created_at DESC);

ALTER TABLE public.project_storyboards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth all select project_storyboards" ON public.project_storyboards FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth all insert project_storyboards" ON public.project_storyboards FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth all update project_storyboards" ON public.project_storyboards FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth all delete project_storyboards" ON public.project_storyboards FOR DELETE TO authenticated USING (true);

CREATE TRIGGER set_project_storyboards_updated_at BEFORE UPDATE ON public.project_storyboards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.company_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_marketing;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_storyboards;