-- Habits listed on the Habits screen (hamburger panel), each with how long it takes.
-- Same ownership setup as the other cass_* tables: user_id defaults to the caller,
-- one owner-only policy, nothing for anon.

create table if not exists public.cass_habits (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  minutes integer not null default 15 check (minutes > 0),
  sort_order integer not null default 0,
  user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists cass_habits_user_idx on public.cass_habits (user_id, sort_order);

alter table public.cass_habits enable row level security;
revoke all on public.cass_habits from anon;
grant select, insert, update, delete on public.cass_habits to authenticated;

drop policy if exists cass_habits_owner_all on public.cass_habits;
create policy cass_habits_owner_all on public.cass_habits
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
