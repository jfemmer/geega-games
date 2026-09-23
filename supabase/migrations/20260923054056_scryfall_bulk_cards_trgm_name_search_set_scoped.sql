-- Adds an optional set_code filter to search_scryfall_bulk_by_name_trgm,
-- for the "set-first" recognition pipeline: once the set-symbol hash has
-- identified a set independent of OCR, name search only needs to search
-- that set's ~100-400 cards, not all 118k+ printings. Narrower search is
-- both faster (smaller trigram scan) and more accurate (a same-named card
-- from the WRONG set can no longer rank ahead of the right one just
-- because of similarity-score noise).
--
-- p_set_code defaults to null, preserving the exact existing behavior
-- (search every printing) for every current caller.
create or replace function public.search_scryfall_bulk_by_name_trgm(
  p_name text,
  p_limit integer default 30,
  p_set_code text default null
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
    and (p_set_code is null or b.set_code = upper(trim(p_set_code)))
  order by similarity(b.card_name, trim(p_name)) desc
  limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;

comment on function public.search_scryfall_bulk_by_name_trgm(text, integer, text) is
  'Trigram-similarity candidate search for recognition (Part 6/7 name fallback) — tolerates OCR character-substitution noise, unlike a plain ILIKE substring match. Pass p_set_code once the set is known (from set-symbol hashing or a parsed collector line) to search only that set''s cards. Not for human-typing autocomplete (see search_deck_card_names for that).';

revoke all on function public.search_scryfall_bulk_by_name_trgm(text, integer, text) from public, anon;
grant execute on function public.search_scryfall_bulk_by_name_trgm(text, integer, text) to authenticated;
