-- A Help sub-event can be tied to a habit (Theo: Open window -> Shut down), so the
-- habit's card can list those events. Clearing the habit leaves the sub-event.
alter table public.cass_help_items
  add column if not exists habit_id uuid references public.cass_habits(id) on delete set null;
