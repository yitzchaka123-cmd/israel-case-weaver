
-- Profiles table (one per auth user)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  theme TEXT NOT NULL DEFAULT 'light',
  app_logo_url TEXT,
  ai_provider_planning TEXT NOT NULL DEFAULT 'lovable',
  ai_provider_documents TEXT NOT NULL DEFAULT 'lovable',
  ai_provider_images TEXT NOT NULL DEFAULT 'lovable',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Projects
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled Case',
  subtitle TEXT,
  cover_image_url TEXT,
  mystery_type TEXT,
  genre TEXT,
  year INTEGER,
  difficulty TEXT,
  player_role TEXT,
  case_goal TEXT,
  setting TEXT,
  selling_point TEXT,
  target_doc_count INTEGER DEFAULT 40,
  phase TEXT NOT NULL DEFAULT 'setup',
  ai_provider_planning TEXT,
  ai_provider_documents TEXT,
  ai_provider_images TEXT,
  envelope_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  hint_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  packaging_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.suspects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'New Suspect',
  thumbnail_url TEXT,
  alt_thumbnail_url TEXT,
  summary TEXT,
  role_in_case TEXT,
  motives TEXT,
  secrets TEXT,
  contradictions TEXT,
  is_red_herring BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  doc_number INTEGER,
  title TEXT NOT NULL DEFAULT 'Untitled Document',
  doc_type TEXT,
  print_size TEXT,
  design_instructions TEXT,
  hebrew_content TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  generated_asset_url TEXT,
  uploaded_asset_url TEXT,
  active_version TEXT NOT NULL DEFAULT 'generated',
  envelope_number INTEGER,
  linked_suspect_ids UUID[] DEFAULT '{}',
  linked_node_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.canvas_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL DEFAULT 'note',
  title TEXT NOT NULL DEFAULT '',
  description TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  position_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  position_y DOUBLE PRECISION NOT NULL DEFAULT 0,
  width DOUBLE PRECISION,
  height DOUBLE PRECISION,
  color TEXT,
  locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.canvas_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.canvas_nodes(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES public.canvas_nodes(id) ON DELETE CASCADE,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'external',
  title TEXT,
  url TEXT,
  mime_type TEXT,
  prompt TEXT,
  provider TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  target_id UUID,
  original_prompt TEXT,
  revised_prompt TEXT,
  final_prompt TEXT,
  provider TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.envelopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  label TEXT,
  task TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.hints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL,
  level INTEGER NOT NULL,
  text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_suspects_project ON public.suspects(project_id);
CREATE INDEX idx_documents_project ON public.documents(project_id);
CREATE INDEX idx_nodes_project ON public.canvas_nodes(project_id);
CREATE INDEX idx_edges_project ON public.canvas_edges(project_id);
CREATE INDEX idx_media_project ON public.media_assets(project_id);
CREATE INDEX idx_prompts_project ON public.prompts(project_id);
CREATE INDEX idx_envelopes_project ON public.envelopes(project_id);
CREATE INDEX idx_hints_project ON public.hints(project_id);
CREATE INDEX idx_chat_project ON public.chat_messages(project_id);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suspects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Shared workspace policies: any authenticated user can do anything
CREATE POLICY "Auth users view profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Generic shared policies for other tables
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['projects','suspects','documents','canvas_nodes','canvas_edges','media_assets','prompts','envelopes','hints','chat_messages']) LOOP
    EXECUTE format('CREATE POLICY "Auth all select %I" ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('CREATE POLICY "Auth all insert %I" ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', t, t);
    EXECUTE format('CREATE POLICY "Auth all update %I" ON public.%I FOR UPDATE TO authenticated USING (true)', t, t);
    EXECUTE format('CREATE POLICY "Auth all delete %I" ON public.%I FOR DELETE TO authenticated USING (true)', t, t);
  END LOOP;
END $$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['profiles','projects','suspects','documents','canvas_nodes','envelopes']) LOOP
    EXECUTE format('CREATE TRIGGER trg_updated_at_%I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t);
  END LOOP;
END $$;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Storage buckets for covers, suspects, media
INSERT INTO storage.buckets (id, name, public) VALUES ('covers','covers',true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('suspects','suspects',true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('media','media',true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('documents','documents',true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('logos','logos',true) ON CONFLICT DO NOTHING;

CREATE POLICY "Auth read buckets" ON storage.objects FOR SELECT TO authenticated USING (bucket_id IN ('covers','suspects','media','documents','logos'));
CREATE POLICY "Auth write buckets" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id IN ('covers','suspects','media','documents','logos'));
CREATE POLICY "Auth update buckets" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id IN ('covers','suspects','media','documents','logos'));
CREATE POLICY "Auth delete buckets" ON storage.objects FOR DELETE TO authenticated USING (bucket_id IN ('covers','suspects','media','documents','logos'));
CREATE POLICY "Public read media" ON storage.objects FOR SELECT TO anon USING (bucket_id IN ('covers','suspects','media','logos'));
