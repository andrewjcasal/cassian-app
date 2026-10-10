-- Where a todo read off a theme's photo sat on the paper (0 = first line), so the
-- theme page's Original view lists them in the paper's order. Null for steps
-- added by hand.
alter table public.cass_time_blocks add column if not exists theme_position smallint;
