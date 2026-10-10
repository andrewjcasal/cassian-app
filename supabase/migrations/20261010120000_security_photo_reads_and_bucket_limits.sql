-- Security audit 2026-10-10.
-- 1. A ledger of photo reads so transcribe-theme-photo can cap Anthropic calls per
--    theme and per user per day. Users can read their own rows but not write them;
--    the edge function inserts with the service role.
create table if not exists public.cass_photo_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  theme_id uuid not null references public.cass_themes(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists cass_photo_reads_user_idx on public.cass_photo_reads (user_id, created_at);
create index if not exists cass_photo_reads_theme_idx on public.cass_photo_reads (theme_id);

alter table public.cass_photo_reads enable row level security;
revoke all on public.cass_photo_reads from anon, authenticated;
grant select on public.cass_photo_reads to authenticated;
drop policy if exists cass_photo_reads_owner_select on public.cass_photo_reads;
create policy cass_photo_reads_owner_select on public.cass_photo_reads
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 2. The todo-lists bucket had no size or type limit.
update storage.buckets
set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg']
where id = 'todo-lists';

-- 3. cass_touch_updated_at had a mutable search_path.
alter function public.cass_touch_updated_at() set search_path = '';
