-- Two card names in the curated synergy seed (previous migration) were
-- misremembered and failed to resolve against scryfall_bulk_cards:
-- "Tatyova, Benevolent Archmage" (real card: Tatyova, Steward of Tides)
-- and "Kraum, Ludevic's Opinion" (real card: Kraum, Ludevic's Opus).
-- Idempotent: safe to re-run against an already-corrected row (matches
-- 0 rows and no-ops).

update public.card_synergy_curated
set card_a_name = 'Tatyova, Steward of Tides'
where card_a_name = 'Tatyova, Benevolent Archmage';

update public.card_synergy_curated
set card_b_name = 'Kraum, Ludevic''s Opus'
where card_b_name = 'Kraum, Ludevic''s Opinion';

update public.card_synergy_curated csc
set card_a_oracle_id = (
  select b.oracle_id::uuid
  from public.scryfall_bulk_cards b
  where b.lang = 'en' and lower(b.card_name) = lower(trim(csc.card_a_name))
  order by (b.raw->'legalities'->>'commander' = 'legal') desc, b.released_at desc nulls last
  limit 1
)
where csc.card_a_oracle_id is null;

update public.card_synergy_curated csc
set card_b_oracle_id = (
  select b.oracle_id::uuid
  from public.scryfall_bulk_cards b
  where b.lang = 'en' and lower(b.card_name) = lower(trim(csc.card_b_name))
  order by (b.raw->'legalities'->>'commander' = 'legal') desc, b.released_at desc nulls last
  limit 1
)
where csc.card_b_oracle_id is null;
