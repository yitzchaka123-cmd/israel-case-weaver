CREATE TABLE public.bulk_generation_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL,
  scope text NOT NULL,
  mode text NOT NULL,
  document_format text,
  document_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  total integer NOT NULL DEFAULT 0,
  completed integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  current_doc_id uuid,
  current_doc_title text,
  status text NOT NULL DEFAULT 'running',
  error text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  created_by uuid
);

ALTER TABLE public.bulk_generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth all select bulk_generation_jobs"
  ON public.bulk_generation_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth all insert bulk_generation_jobs"
  ON public.bulk_generation_jobs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth all update bulk_generation_jobs"
  ON public.bulk_generation_jobs FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth all delete bulk_generation_jobs"
  ON public.bulk_generation_jobs FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_bulk_jobs_project ON public.bulk_generation_jobs (project_id, started_at DESC);

ALTER TABLE public.bulk_generation_jobs REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bulk_generation_jobs;