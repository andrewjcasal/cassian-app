-- Reopen the cass_* tables to their owner only (follows the 2026-08-13 lockdown,
-- ~/dev/cassian2/supabase/migrations/20260813204800_lock_down_cass_tables_from_anon.sql).
--
-- Every cass_* row belongs to andrewjcasal@gmail.com. Each table gets a user_id
-- (defaulting to the caller, so inserts from the app don't have to send it),
-- existing rows are backfilled to that account, and one ownership policy per
-- table lets a signed-in user reach only their own rows. anon stays revoked.

do $$
declare
  t text;
  owner uuid := (select id from auth.users where email = 'andrewjcasal@gmail.com');
begin
  if owner is null then
    raise exception 'andrewjcasal@gmail.com not found in auth.users';
  end if;

  foreach t in array array[
    'cass_behaviors', 'cass_days', 'cass_notes', 'cass_routine_logs',
    'cass_routines', 'cass_task_lists', 'cass_tasks', 'cass_time_blocks',
    'cass_workflows'
  ] loop
    execute format('alter table public.%I add column if not exists user_id uuid default auth.uid() references auth.users(id)', t);
    execute format('update public.%I set user_id = %L where user_id is null', t, owner);
    execute format('alter table public.%I alter column user_id set not null', t);
    execute format('create index if not exists %I on public.%I (user_id)', t || '_user_idx', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_owner_all', t
    );
  end loop;
end $$;
