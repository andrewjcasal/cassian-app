-- A time block can be marked done from the block's "..." menu, the same flag
-- cass_tasks already carries.
alter table public.cass_time_blocks
  add column if not exists done boolean not null default false;
