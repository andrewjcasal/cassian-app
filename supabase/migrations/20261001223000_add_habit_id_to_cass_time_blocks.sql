-- A habit is placed on today's calendar as an ordinary time block, linked back to
-- its habit. One block per habit per day, so two loads racing can't double-place it
-- (NULL habit_ids are distinct, so ordinary blocks are unaffected).
alter table public.cass_time_blocks
  add column if not exists habit_id uuid references public.cass_habits(id) on delete set null;

create unique index if not exists cass_time_blocks_habit_day_key
  on public.cass_time_blocks (habit_id, day);
