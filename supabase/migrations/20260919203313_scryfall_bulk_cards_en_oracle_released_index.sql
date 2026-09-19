-- Supports rebuild_card_recommendation_catalog()'s two-phase dedup: lets
-- "distinct on (oracle_id) order by oracle_id, released_at desc" for
-- English cards run as an index scan instead of an external sort over the
-- full scryfall_bulk_cards table.
create index if not exists scryfall_bulk_cards_en_oracle_released_idx
  on public.scryfall_bulk_cards (oracle_id, released_at desc nulls last)
  where lang='en' and oracle_id is not null;
