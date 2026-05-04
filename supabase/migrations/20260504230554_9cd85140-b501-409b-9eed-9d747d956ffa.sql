CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-stale-bulk-jobs') THEN
    PERFORM cron.unschedule('sweep-stale-bulk-jobs');
  END IF;
END $$;

SELECT cron.schedule(
  'sweep-stale-bulk-jobs',
  '* * * * *',
  $$ SELECT public.sweep_stale_bulk_jobs(NULL, 4); $$
);