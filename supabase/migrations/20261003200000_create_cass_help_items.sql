-- Help events and their sub-events (Theo: Open window, Puzzles; Cat Fight: Play),
-- moved out of the app's code so sub-events can be added from Planning. One row
-- per sub-event; group_name is the Help event it sits under. Owner-only like the
-- other cass_* tables.
create table if not exists public.cass_help_items (
  id uuid primary key default gen_random_uuid(),
  group_name text not null,
  name text not null,
  minutes integer not null default 5 check (minutes > 0),
  sort_order integer not null default 0,
  user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists cass_help_items_user_idx on public.cass_help_items (user_id, group_name, sort_order);

alter table public.cass_help_items enable row level security;
revoke all on public.cass_help_items from anon;
grant select, insert, update, delete on public.cass_help_items to authenticated;

drop policy if exists cass_help_items_owner_all on public.cass_help_items;
create policy cass_help_items_owner_all on public.cass_help_items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
