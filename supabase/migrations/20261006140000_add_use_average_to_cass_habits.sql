-- A habit whose Duration is set to "avg" on Planning follows the average length
-- of its last 5 completed runs (averageMinutes) instead of a fixed one; new days
-- place it at that average. LinkedIn replies is the first (45 min on 2026-10-06).
alter table public.cass_habits add column if not exists use_average boolean not null default false;

update public.cass_habits set use_average = true, minutes = 45 where title = 'LinkedIn replies';
