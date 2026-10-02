-- A habit is daily or weekly. The Habits tab groups by it and the habit card
-- toggles it. Existing habits stay daily.
alter table public.cass_habits
  add column if not exists frequency text not null default 'daily'
  check (frequency in ('daily', 'weekly'));
