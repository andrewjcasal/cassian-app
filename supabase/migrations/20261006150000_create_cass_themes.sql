-- Themes: the outcome a set of todos is for ("Cable organizing for the office").
-- A theme is never scheduled; its todos are, each pointing at it by theme_id.
-- Archived themes leave the Todos tab. Owner-only like the other cass_* tables.
create table if not exists public.cass_themes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  sort_order integer not null default 0,
  archived_at timestamptz,
  user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists cass_themes_user_idx on public.cass_themes (user_id, archived_at, sort_order);

alter table public.cass_themes enable row level security;
revoke all on public.cass_themes from anon;
grant select, insert, update, delete on public.cass_themes to authenticated;

drop policy if exists cass_themes_owner_all on public.cass_themes;
create policy cass_themes_owner_all on public.cass_themes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.cass_time_blocks
  add column if not exists theme_id uuid references public.cass_themes(id) on delete set null;
create index if not exists cass_time_blocks_theme_idx on public.cass_time_blocks (theme_id) where theme_id is not null;

-- The first theme: the cable todo becomes its first concrete step
with owner as (
  select user_id from public.cass_time_blocks where id = 'd7399fcb-5f4d-44f9-a0e7-d111216d4a44'
), theme as (
  insert into public.cass_themes (title, user_id)
  select 'Cable organizing for the office', user_id from owner
  where not exists (select 1 from public.cass_themes where title = 'Cable organizing for the office')
  returning id
)
update public.cass_time_blocks
set theme_id = (select id from theme), title = 'Measure lengths to see what cables to get'
where id = 'd7399fcb-5f4d-44f9-a0e7-d111216d4a44' and exists (select 1 from theme);
