-- Actually populate the widened catalog (card_recommendation_catalog was
-- last populated by the original commander-only migration; the column and
-- function changes above don't touch existing rows on their own). Safe to
-- re-run — rebuild_card_recommendation_catalog() truncates and rebuilds
-- from scryfall_bulk_cards every time.
select public.rebuild_card_recommendation_catalog();
