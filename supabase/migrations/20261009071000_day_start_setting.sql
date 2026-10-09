-- One time divides the days, set on the Settings page: day_start, the hour a new
-- day begins (5am unless changed). The app runs each day from that hour to the
-- same hour the next morning (DAY_START in src/schedule.ts).
alter table public.cass_settings
  add column if not exists day_start smallint not null default 5
  check (day_start between 0 and 8);

-- logical_day was generated from a fixed 6am. A generated column can't read a
-- setting, so it becomes a plain column kept by a trigger that reads the owner's
-- day_start. The data and the (habit_id, logical_day) unique index stay as they are.
alter table public.cass_time_blocks alter column logical_day drop expression;

create or replace function public.cass_day_start(owner uuid)
returns smallint
language sql
stable
set search_path = ''
as $$
  select coalesce((select s.day_start from public.cass_settings s where s.user_id = owner), 5::smallint)
$$;

create or replace function public.cass_time_blocks_logical_day()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.logical_day := case
    when new.start_time < make_time(public.cass_day_start(new.user_id), 0, 0) then new.day - 1
    else new.day
  end;
  return new;
end
$$;

drop trigger if exists cass_time_blocks_logical_day on public.cass_time_blocks;
create trigger cass_time_blocks_logical_day
  before insert or update of day, start_time, user_id on public.cass_time_blocks
  for each row execute function public.cass_time_blocks_logical_day();

-- Changing the setting re-files that person's blocks under the new cutover
create or replace function public.cass_settings_day_start_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.cass_time_blocks b
  set logical_day = case when b.start_time < make_time(new.day_start, 0, 0) then b.day - 1 else b.day end
  where b.user_id = new.user_id
    and b.logical_day is distinct from (case when b.start_time < make_time(new.day_start, 0, 0) then b.day - 1 else b.day end);
  return new;
end
$$;

drop trigger if exists cass_settings_day_start_changed on public.cass_settings;
create trigger cass_settings_day_start_changed
  after insert or update of day_start on public.cass_settings
  for each row execute function public.cass_settings_day_start_changed();

-- Every existing block, filed by its owner's cutover (5am for everyone today)
update public.cass_time_blocks b
set logical_day = case when b.start_time < make_time(public.cass_day_start(b.user_id), 0, 0) then b.day - 1 else b.day end
where b.logical_day is distinct from (case when b.start_time < make_time(public.cass_day_start(b.user_id), 0, 0) then b.day - 1 else b.day end);
