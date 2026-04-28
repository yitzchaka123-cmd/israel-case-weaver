UPDATE public.assistant_runs
SET status = 'error',
    error  = COALESCE(error, 'stale_recovered: marked failed by recovery sweep'),
    finished_at = now()
WHERE status = 'running'
  AND started_at < now() - interval '15 minutes';