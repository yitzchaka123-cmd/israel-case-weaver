## Goal

Stop "Draft all" from appearing stuck forever when the bulk worker dies mid-run. Today, if the worker crashes, the `bulk_generation_jobs` row stays in `running` and the UI keeps acting as if work is happening — for hours.

## Plan

### 1. Auto-sweep on read (frontend)

`src/features/project/useActiveBulkJob.ts` already treats heartbeats older than 4 minutes as "not active" for the dot, but the DB row stays `running`. Update the hook so when it detects a stale row it also calls the `sweep_stale_bulk_jobs(p_project_id, 4)` RPC. This closes the row the moment any user opens the project.

### 2. Auto-sweep on write (backend)

`supabase/functions/bulk-generate-documents/index.ts` already pre-flights for an active job before starting a new one. Add the same sweep call at the top of that pre-flight so a user clicking "Draft all" again can't be blocked by a ghost row.

### 3. Scheduled maintenance (pg_cron)

Add a migration that:
- Enables `pg_cron` if not already enabled.
- Schedules `sweep_stale_bulk_jobs(NULL, 4)` to run every minute across all projects.

This guarantees ghost rows die within ~1 minute even if no one opens the project.

### 4. Surface failures as notifications

When the sweep closes a row (frontend path in step 1), insert a `project_notifications` row:
- kind: `bulk_job_stalled`
- title: `Drafting stopped at {completed}/{total}`
- body: `The worker stopped responding. {failed} failed, {completed} completed. You can resume drafting the remaining documents.`
- starter_prompt: `Resume drafting the remaining documents in this project.`

So the user sees in the bell that the job died, instead of silent.

### 5. One-time cleanup

Run the sweep once for the stuck 41-doc project (and any other current ghosts) so the user's other project unblocks immediately.

## Technical notes

- `sweep_stale_bulk_jobs` already exists (SECURITY DEFINER, sets `status='failed'`, appends "auto-closed: stale" to `error`, sets `finished_at = now()`). No DB function changes needed.
- The frontend RPC call from step 1: `supabase.rpc('sweep_stale_bulk_jobs', { p_project_id: projectId, p_stale_minutes: 4 })`. After it returns >0, fetch the just-failed row to read `completed/total/failed` for the notification body, then insert into `project_notifications`.
- Step 3 cron uses pg_cron directly (SQL-only, no edge function needed):
  ```sql
  select cron.schedule('sweep-stale-bulk-jobs', '* * * * *', $$select public.sweep_stale_bulk_jobs(null, 4);$$);
  ```
- Edge function to redeploy: `bulk-generate-documents`.
- No schema changes. No new tables.

## Out of scope

- Reworking the bulk worker to checkpoint/resume mid-document. (Separate task — for now "resume" just means re-clicking Draft all on remaining drafts.)
- Changing the 4-minute staleness threshold per project.
