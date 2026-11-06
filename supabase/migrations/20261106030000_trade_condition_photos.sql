-- Condition photos taken at inspection (Trades: final condition verification).
--
-- Staff photograph a customer's card when its condition, printing or
-- authenticity differs from what was listed; the customer sees the photos
-- beside the change on their final offer. Private, like the proof-of-
-- shipping files: no storage policies are added, so only the service role
-- (the API) can read or write. Staff upload through short-lived signed
-- upload URLs from /api/admin/trade-center, and both staff and the trade's
-- customer view through short-lived signed links the API creates after
-- checking who's asking. Files live at <trade id>/<offer card id>__<uuid>.<ext>
-- so one listing per trade finds every card's photos.
--
-- To undo: delete the bucket's objects, then the bucket
-- (delete from storage.buckets where id = 'trade-condition-photos').

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trade-condition-photos',
  'trade-condition-photos',
  false,
  10485760, -- 10 MB a photo
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
