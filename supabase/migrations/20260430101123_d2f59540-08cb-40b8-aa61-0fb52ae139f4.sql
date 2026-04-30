
ALTER TABLE public.bulk_generation_jobs
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS last_generation_error text;

CREATE OR REPLACE FUNCTION public.increment_bulk_completed(p_job_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.bulk_generation_jobs
     SET completed = completed + 1,
         last_heartbeat_at = now()
   WHERE id = p_job_id;
$$;

CREATE OR REPLACE FUNCTION public.increment_bulk_failed(p_job_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.bulk_generation_jobs
     SET failed = failed + 1,
         last_heartbeat_at = now()
   WHERE id = p_job_id;
$$;

CREATE OR REPLACE FUNCTION public.sweep_stale_bulk_jobs(p_project_id uuid DEFAULT NULL, p_stale_minutes int DEFAULT 4)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.bulk_generation_jobs
     SET status = 'failed',
         finished_at = now(),
         error = COALESCE(error, '') ||
                 CASE WHEN COALESCE(error, '') = '' THEN '' ELSE ' | ' END ||
                 'auto-closed: stale (no heartbeat for ' || p_stale_minutes || ' min)'
   WHERE status = 'running'
     AND last_heartbeat_at < now() - make_interval(mins => p_stale_minutes)
     AND (p_project_id IS NULL OR project_id = p_project_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Sweep current ghosts immediately
SELECT public.sweep_stale_bulk_jobs(NULL, 4);
