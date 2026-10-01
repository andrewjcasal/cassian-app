-- When a block was marked done. A block marked done before its start time renders
-- dark gray (done ahead of schedule); otherwise done renders green.
alter table public.cass_time_blocks
  add column if not exists done_at timestamptz;
