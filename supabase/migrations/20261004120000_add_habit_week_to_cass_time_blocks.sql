-- Which week (its Sunday) a habit block was placed for. Moving the block to
-- another day keeps it, so last week's weekly habit done late on Sunday still
-- counts for last week, and this week's still lands on its weekday. Backfilled
-- from each habit block's own day (Sunday-start weeks: day minus day-of-week).
alter table public.cass_time_blocks
  add column if not exists habit_week date;

update public.cass_time_blocks
set habit_week = logical_day - extract(dow from logical_day)::int
where habit_id is not null and habit_week is null;
