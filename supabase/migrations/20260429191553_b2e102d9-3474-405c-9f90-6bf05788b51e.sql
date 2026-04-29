UPDATE public.assistant_runs
SET status = 'error',
    error = 'auto-closed: stale run (>15 min in running state)',
    finished_at = now()
WHERE status = 'running'
  AND started_at < now() - interval '15 minutes';