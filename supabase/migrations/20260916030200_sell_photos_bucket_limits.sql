-- Storage-enforced upload limits for the sell-photos bucket (not just
-- client-side validation, which a determined caller can bypass): Supabase
-- Storage rejects an upload server-side if its declared size exceeds
-- file_size_limit or its Content-Type isn't in allowed_mime_types.
update storage.buckets
set file_size_limit = 15728640, -- 15 MB per photo
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif']
where id = 'sell-photos';
