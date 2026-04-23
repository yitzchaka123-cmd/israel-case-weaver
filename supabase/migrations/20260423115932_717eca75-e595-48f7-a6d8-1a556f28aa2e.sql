CREATE TABLE public.project_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'general',
  title text NOT NULL,
  body text,
  starter_prompt text,
  status text NOT NULL DEFAULT 'unread',
  created_by text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX idx_project_notifications_project ON public.project_notifications(project_id, created_at DESC);

ALTER TABLE public.project_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth all select project_notifications"
  ON public.project_notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth all insert project_notifications"
  ON public.project_notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth all update project_notifications"
  ON public.project_notifications FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth all delete project_notifications"
  ON public.project_notifications FOR DELETE TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.project_notifications;
ALTER TABLE public.project_notifications REPLICA IDENTITY FULL;