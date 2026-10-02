-- Days run 6am to 6am in the app, so a block starting before 6am belongs to the
-- night before. One block per habit per day has to count by that day, or a habit
-- pushed past midnight would take the next day's slot and the next day's copy
-- would be skipped. The database derives the day itself, so it stays right
-- whenever a block moves.
alter table public.cass_time_blocks
  add column if not exists logical_day date
  generated always as (case when start_time < time '06:00' then day - 1 else day end) stored;

drop index if exists public.cass_time_blocks_habit_day_key;
create unique index if not exists cass_time_blocks_habit_logical_day_key
  on public.cass_time_blocks (habit_id, logical_day);
