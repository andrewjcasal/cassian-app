-- One row of app settings per user, from the Settings page (the gear).
-- auto_schedule: a todo moved to another day takes that day's first open time
-- from 8am (moveToDayStart) instead of keeping its clock time. On by default.
create table if not exists public.cass_settings (
  user_id uuid primary key default auth.uid() references auth.users(id),
  auto_schedule boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.cass_settings enable row level security;
revoke all on public.cass_settings from anon;
grant select, insert, update on public.cass_settings to authenticated;

drop policy if exists cass_settings_owner_all on public.cass_settings;
create policy cass_settings_owner_all on public.cass_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
