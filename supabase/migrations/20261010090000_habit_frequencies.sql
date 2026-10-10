-- More ways a habit can come back: every 2 or 3 weeks, monthly, every 2 or 3
-- months. All but daily land on the habit's weekday once due (nextDueWeek in
-- src/schedule.ts).
alter table public.cass_habits drop constraint if exists cass_habits_frequency_check;
alter table public.cass_habits add constraint cass_habits_frequency_check
  check (frequency in ('daily', 'weekly', 'every_2_weeks', 'every_3_weeks', 'monthly', 'every_2_months', 'every_3_months'));
