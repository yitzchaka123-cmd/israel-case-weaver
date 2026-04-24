ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS document_format TEXT,
  ADD COLUMN IF NOT EXISTS skill_id TEXT,
  ADD COLUMN IF NOT EXISTS source_document_id UUID,
  ADD COLUMN IF NOT EXISTS preview_url TEXT,
  ADD COLUMN IF NOT EXISTS generation_mode TEXT;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS generated_document_url TEXT,
  ADD COLUMN IF NOT EXISTS generated_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS document_format TEXT,
  ADD COLUMN IF NOT EXISTS document_provider TEXT,
  ADD COLUMN IF NOT EXISTS document_model TEXT,
  ADD COLUMN IF NOT EXISTS document_skill_id TEXT,
  ADD COLUMN IF NOT EXISTS document_preview_url TEXT;

CREATE TABLE IF NOT EXISTS public.claude_skills (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  skill_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  skill_type TEXT NOT NULL DEFAULT 'custom',
  version TEXT NOT NULL DEFAULT 'latest',
  enabled BOOLEAN NOT NULL DEFAULT true,
  usage_scope TEXT[] NOT NULL DEFAULT ARRAY['chat'],
  install_source TEXT NOT NULL DEFAULT 'settings',
  uploaded_file_url TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.claude_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth all select claude_skills" ON public.claude_skills;
DROP POLICY IF EXISTS "Auth all insert claude_skills" ON public.claude_skills;
DROP POLICY IF EXISTS "Auth all update claude_skills" ON public.claude_skills;
DROP POLICY IF EXISTS "Auth all delete claude_skills" ON public.claude_skills;

CREATE POLICY "Auth all select claude_skills"
ON public.claude_skills
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Auth all insert claude_skills"
ON public.claude_skills
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Auth all update claude_skills"
ON public.claude_skills
FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Auth all delete claude_skills"
ON public.claude_skills
FOR DELETE
TO authenticated
USING (true);

CREATE TRIGGER set_claude_skills_updated_at
BEFORE UPDATE ON public.claude_skills
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.claude_skills (skill_id, name, skill_type, version, usage_scope, install_source, notes)
VALUES
  ('pdf', 'PDF', 'anthropic', 'latest', ARRAY['chat','documents'], 'built-in', 'Anthropic-managed PDF Skill'),
  ('docx', 'Word / DOCX', 'anthropic', 'latest', ARRAY['chat','documents'], 'built-in', 'Anthropic-managed DOCX Skill'),
  ('pptx', 'PowerPoint / PPTX', 'anthropic', 'latest', ARRAY['chat','documents'], 'built-in', 'Anthropic-managed PPTX Skill'),
  ('xlsx', 'Excel / XLSX', 'anthropic', 'latest', ARRAY['chat','documents'], 'built-in', 'Anthropic-managed XLSX Skill')
ON CONFLICT (skill_id) DO NOTHING;