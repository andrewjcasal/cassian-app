-- Todo lists captured from paper: a photo of the list, and the todos read off it
-- by the transcribe-todo-list function. Owner-only like the other cass_* tables.
create table if not exists public.cass_todo_lists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- Path in the todo-lists bucket, "<user id>/<list id>.jpg"
  photo_path text,
  transcribed_at timestamptz,
  user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.cass_todo_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.cass_todo_lists(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  sort_order integer not null default 0,
  user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists cass_todo_lists_user_idx on public.cass_todo_lists (user_id, created_at);
create index if not exists cass_todo_list_items_list_idx on public.cass_todo_list_items (list_id, sort_order);

alter table public.cass_todo_lists enable row level security;
alter table public.cass_todo_list_items enable row level security;
revoke all on public.cass_todo_lists from anon;
revoke all on public.cass_todo_list_items from anon;
grant select, insert, update, delete on public.cass_todo_lists to authenticated;
grant select, insert, update, delete on public.cass_todo_list_items to authenticated;

drop policy if exists cass_todo_lists_owner_all on public.cass_todo_lists;
create policy cass_todo_lists_owner_all on public.cass_todo_lists
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists cass_todo_list_items_owner_all on public.cass_todo_list_items;
create policy cass_todo_list_items_owner_all on public.cass_todo_list_items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Private bucket for the photos; each user reads and writes only their own folder
insert into storage.buckets (id, name, public)
values ('todo-lists', 'todo-lists', false)
on conflict (id) do nothing;

drop policy if exists todo_lists_owner_all on storage.objects;
create policy todo_lists_owner_all on storage.objects
  for all to authenticated
  using (bucket_id = 'todo-lists' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'todo-lists' and (storage.foldername(name))[1] = (select auth.uid())::text);
