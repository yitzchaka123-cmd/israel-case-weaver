-- One-shot recovery for the assistant turn that was killed by the over-eager
-- zombie sweep on 2026-05-05. The sweep marked the in-flight run as
-- auto_closed_zombie before the placeholder could fill, leaving the user's
-- "Draft all in one shot" turn stuck on "Starting…" forever in the UI.
UPDATE public.chat_messages
   SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{in_progress}', 'false'::jsonb)
 WHERE role = 'assistant'
   AND content = ''
   AND COALESCE(metadata->>'in_progress', 'false') = 'true'
   AND created_at < now() - interval '90 seconds';
