CREATE OR REPLACE FUNCTION public.sweep_stale_assistant_runs(p_stale_minutes integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  UPDATE public.assistant_runs
     SET status = 'error',
         error = COALESCE(error, '') ||
                 CASE WHEN COALESCE(error,'') = '' THEN '' ELSE ' | ' END ||
                 'stale_recovered: server sweep (' || p_stale_minutes || ' min)',
         finished_at = now()
   WHERE status = 'running'
     AND started_at < now() - make_interval(mins => p_stale_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;