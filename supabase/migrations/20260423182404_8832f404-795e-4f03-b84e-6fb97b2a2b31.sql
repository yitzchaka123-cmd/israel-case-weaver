CREATE TABLE public.assistant_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  user_id UUID,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  finished_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_assistant_runs_project_id ON public.assistant_runs(project_id);
CREATE INDEX idx_assistant_runs_status ON public.assistant_runs(status);

ALTER TABLE public.assistant_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth all select assistant_runs"
  ON public.assistant_runs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Auth all insert assistant_runs"
  ON public.assistant_runs FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Auth all update assistant_runs"
  ON public.assistant_runs FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Auth all delete assistant_runs"
  ON public.assistant_runs FOR DELETE TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.assistant_runs;
ALTER TABLE public.assistant_runs REPLICA IDENTITY FULL;