alter table public.user_google_drive_connections
  add column if not exists auto_backup_enabled boolean not null default false,
  add column if not exists root_folder_id text,
  add column if not exists last_error text,
  add column if not exists last_synced_at timestamptz;

create table if not exists public.drive_backup_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  asset_kind text not null,
  asset_id text not null,
  drive_file_id text not null,
  uploaded_at timestamptz not null default now(),
  unique (user_id, project_id, asset_kind, asset_id)
);

create index if not exists idx_drive_backup_log_user_project on public.drive_backup_log(user_id, project_id);

alter table public.drive_backup_log enable row level security;

drop policy if exists "Users read own backup log" on public.drive_backup_log;
create policy "Users read own backup log" on public.drive_backup_log
  for select to authenticated using (auth.uid() = user_id);