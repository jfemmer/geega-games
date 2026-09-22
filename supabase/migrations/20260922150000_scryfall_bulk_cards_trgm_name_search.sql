-- candidatesByName() in api/_lib/recognition/scryfallBulkIndex.ts has always
-- claimed to do "fuzzy name search... via the card_name trigram index", but
-- the actual query was a plain `ilike '%text%'` substring match: a SINGLE
-- misread character anywhere in an OCR'd card name (e.g. Tesseract reading
-- "Lightning Bolt" as "Lightning 8olt", or "Sol Ring" as "S0l Ring" — both
-- extremely common 0/O and B/8 confusions) made the real card unfindable via
-- this fallback path, even though the trigram index already sitting on this
-- column supports genuine similarity search. This was the single biggest
-- reason the free/local OCR path underperformed a paid OCR API: not the raw
-- OCR text quality, but that candidate generation had zero tolerance for
-- OCR noise.
--
-- This function does what the docstring always claimed: real trigram
-- similarity search, index-accelerated via the % operator against the
-- existing scryfall_bulk_cards_name_idx GIN index (no new index needed).
-- Verified against live data before capturing this migration:
--   "Lightning 8olt" -> Lightning Bolt   (similarity 0.667)
--   "Ornithoptor"    -> Ornithopter      (similarity 0.6)
--   "S0l Ring"       -> Sol Ring         (similarity 0.5)
-- all comfortably above pg_trgm's stock 0.3 similarity_threshold, so the
-- function relies on that default rather than overriding it (an earlier,
-- since-replaced version of this migration tried lowering the threshold to
-- 0.2 via plpgsql + SET LOCAL for extra headroom on short names, but
-- Postgres rejects any SET statement inside a STABLE function at call time
-- — "SET is not allowed in a non-volatile function" — so this stays a
-- plain `language sql` function, matching every sibling function in this
-- codebase).
--
-- This only generates CANDIDATES for the pipeline's downstream visual
-- (perceptual-hash) and set-symbol verification to confirm or reject —
-- fuzzy recall here is the right trade under this pipeline's existing
-- precision-over-recall design (the FINAL auto-match decision, not
-- candidate generation, is where precision is enforced; see
-- api/_lib/recognition/config.ts's RECOGNITION_THRESHOLDS).
create or replace function public.search_scryfall_bulk_by_name_trgm(
  p_name text,
  p_limit integer default 30
)
returns setof public.scryfall_bulk_cards
language sql
stable
security invoker
set search_path = public
as $$
  select b.*
  from public.scryfall_bulk_cards b
  where b.card_name % trim(p_name)
  order by similarity(b.card_name, trim(p_name)) desc
  limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;

comment on function public.search_scryfall_bulk_by_name_trgm(text, integer) is
  'Trigram-similarity candidate search for recognition (Part 6/7 name fallback) — tolerates OCR character-substitution noise, unlike a plain ILIKE substring match. Not for human-typing autocomplete (see search_deck_card_names for that).';

-- Same posture as the underlying table's own grants (staff-only via RLS,
-- since this is security invoker; explicit anon/public revoke matches this
-- repo's established least-privilege convention for every sibling function).
revoke all on function public.search_scryfall_bulk_by_name_trgm(text, integer) from public, anon;
grant execute on function public.search_scryfall_bulk_by_name_trgm(text, integer) to authenticated;
