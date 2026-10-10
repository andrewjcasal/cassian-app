-- A theme can carry one photo of a paper list (replacing Todo Lists). Reading it
-- makes each item a real todo under the theme; read_at is set once they're added,
-- and a theme with a photo can't take another.
alter table public.cass_themes
  add column if not exists photo_path text,
  add column if not exists photo_read_at timestamptz;
