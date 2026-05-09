
-- Multi-profile company branding + project link + reference cover selection.

create table if not exists public.company_profiles_v2 (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null default 'Default profile',
  language text not null default 'English',
  is_default boolean not null default false,
  -- mirrored fields from legacy company_profiles
  company_name text,
  tagline text,
  legal_text text,
  support_email text,
  website text,
  address text,
  country text,
  age_rating text,
  made_in text,
  logo_url text,
  phone text,
  vat_number text,
  manufactured_by text,
  distributed_by text,
  warning_text text,
  box_footer_line text,
  social jsonb not null default '{}'::jsonb,
  -- new fields
  reference_covers jsonb not null default '[]'::jsonb,
  cover_design_brief text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.company_profiles_v2 enable row level security;

create policy "Owners select own profiles_v2"
  on public.company_profiles_v2 for select
  to authenticated
  using (auth.uid() = owner_id);

create policy "Owners insert own profiles_v2"
  on public.company_profiles_v2 for insert
  to authenticated
  with check (auth.uid() = owner_id);

create policy "Owners update own profiles_v2"
  on public.company_profiles_v2 for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Owners delete own profiles_v2"
  on public.company_profiles_v2 for delete
  to authenticated
  using (auth.uid() = owner_id);

create trigger company_profiles_v2_updated_at
  before update on public.company_profiles_v2
  for each row execute function public.set_updated_at();

create index if not exists company_profiles_v2_owner_idx
  on public.company_profiles_v2(owner_id);

-- Backfill from legacy company_profiles into v2 (one default profile per owner)
insert into public.company_profiles_v2 (
  owner_id, name, language, is_default,
  company_name, tagline, legal_text, support_email, website, address,
  country, age_rating, made_in, logo_url, phone, vat_number,
  manufactured_by, distributed_by, warning_text, box_footer_line, social
)
select
  cp.owner_id,
  coalesce(nullif(cp.company_name, ''), 'Default profile'),
  'English',
  true,
  cp.company_name, cp.tagline, cp.legal_text, cp.support_email, cp.website, cp.address,
  cp.country, cp.age_rating, cp.made_in, cp.logo_url, cp.phone, cp.vat_number,
  cp.manufactured_by, cp.distributed_by, cp.warning_text, cp.box_footer_line, cp.social
from public.company_profiles cp
where not exists (
  select 1 from public.company_profiles_v2 v
  where v.owner_id = cp.owner_id
);

-- Project link + selected reference cover
alter table public.projects
  add column if not exists company_profile_id uuid,
  add column if not exists cover_reference_url text,
  add column if not exists cover_reference_notes text;

-- Backfill: link existing projects to their owner's default profile
update public.projects p
   set company_profile_id = v.id
  from public.company_profiles_v2 v
 where p.company_profile_id is null
   and v.owner_id = p.owner_id
   and v.is_default = true;
