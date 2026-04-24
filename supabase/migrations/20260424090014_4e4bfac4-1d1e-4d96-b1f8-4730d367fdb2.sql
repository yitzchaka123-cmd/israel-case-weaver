ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON public.projects(deleted_at);

CREATE TABLE IF NOT EXISTS public.project_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  created_by uuid,
  label text,
  reason text NOT NULL DEFAULT 'manual',
  snapshot jsonb NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.project_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own project versions" ON public.project_versions;
DROP POLICY IF EXISTS "Users create own project versions" ON public.project_versions;
DROP POLICY IF EXISTS "Users delete own project versions" ON public.project_versions;
DROP POLICY IF EXISTS "Admins read all project versions" ON public.project_versions;
DROP POLICY IF EXISTS "Admins manage project versions" ON public.project_versions;

CREATE POLICY "Users read own project versions"
ON public.project_versions
FOR SELECT
TO authenticated
USING (auth.uid() = owner_id OR auth.uid() = created_by);

CREATE POLICY "Users create own project versions"
ON public.project_versions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = owner_id OR auth.uid() = created_by);

CREATE POLICY "Users delete own project versions"
ON public.project_versions
FOR DELETE
TO authenticated
USING (auth.uid() = owner_id OR auth.uid() = created_by);

CREATE POLICY "Admins read all project versions"
ON public.project_versions
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage project versions"
ON public.project_versions
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_project_versions_project_created ON public.project_versions(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_versions_owner ON public.project_versions(owner_id);