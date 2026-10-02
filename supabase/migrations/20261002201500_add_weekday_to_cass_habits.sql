-- A weekly habit lands on one day of the week (0 = Sunday ... 6 = Saturday, the
-- same numbering as JavaScript's getDay). Null until one is picked, and unused
-- for daily habits.
alter table public.cass_habits
  add column if not exists weekday smallint
  check (weekday between 0 and 6);
