-- The previous migration added card_rec_name_trgm_idx on card_name, not
-- realizing a trigram index already existed live (card_recommendation_
-- catalog_name_trgm_idx, on lower(card_name) — itself untracked drift from
-- a manual dashboard change, discovered only after applying the duplicate).
-- lower(card_name) is also the correct index for how
-- search_deck_card_names actually queries the table, so drop the redundant
-- newly-added one rather than keep two trigram indexes doing the same job.

drop index if exists public.card_rec_name_trgm_idx;

-- Document the pre-existing index so it's no longer untracked drift.
create index if not exists card_recommendation_catalog_name_trgm_idx
  on public.card_recommendation_catalog using gin (lower(card_name) gin_trgm_ops);
