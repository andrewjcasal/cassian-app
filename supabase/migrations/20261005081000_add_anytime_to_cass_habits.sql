-- "Anytime" habits can be placed from 8am instead of waiting for the 3pm fill
-- (placeHabits / anytimeSearchFrom). Skool replies and LinkedIn replies are the
-- first two.
alter table public.cass_habits add column if not exists anytime boolean not null default false;

update public.cass_habits set anytime = true where title in ('Skool replies', 'LinkedIn replies');

-- Their upcoming blocks were placed at 3pm under the old rule and haven't been
-- touched; removing them lets the app place them again from 8am.
delete from public.cass_time_blocks b
using public.cass_habits h
where b.habit_id = h.id
  and h.anytime
  and not b.done
  and b.logical_day >= date '2026-10-05'
  and b.start_time in (time '15:00', time '15:15');
