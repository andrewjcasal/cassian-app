-- A habit can start at a set time each day (Shut down at 11pm). Null means it's
-- placed in the first gap that fits, as before.
alter table public.cass_habits
  add column if not exists start_time time;
