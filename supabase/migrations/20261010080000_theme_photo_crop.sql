-- The part of a theme's photo its thumbnail shows, as fractions of the photo
-- ({ x, y, w, h }, set with Reposition thumbnail). Null shows the whole photo.
alter table public.cass_themes add column if not exists photo_crop jsonb;
