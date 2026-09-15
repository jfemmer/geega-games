-- Local, refreshable cache of Scryfall's bulk "default_cards" data — every
-- printing (all sets, promos, languages), not just what's in inventory.
-- Distinct from card_printings (which only caches printings we actually
-- stock, upserted on demand). This exists so the recognition pipeline can
-- generate candidate printings from OCR'd set code / collector number /
-- name WITHOUT a live Scryfall HTTP call per card — critical at "hundreds of
-- cards per batch" volume, where per-card live lookups would be slow and
-- burn through Scryfall's rate-limit guidance.
--
-- `raw` stores the complete Scryfall card object so candidates can be turned
-- into Geega's CardPrinting via the EXISTING normalizeScryfallCard() —
-- reusing that logic exactly, not a second parallel normalizer.
--
-- Populated by a standalone script (scripts/refreshScryfallBulkIndex.ts),
-- not a Vercel Function: the bulk-data download is 100+ MB / ~100k+ rows,
-- well beyond a serverless function's practical execution budget. Run it
-- locally or on a schedule via CI.

begin;

create table if not exists public.scryfall_bulk_cards (
  scryfall_id       uuid primary key,
  oracle_id         uuid,
  card_name         text not null,
  printed_name      text,
  set_code          text not null,
  set_name          text not null,
  collector_number  text not null,
  lang              text not null default 'en',
  layout            text,
  rarity            text,
  released_at       date,
  frame             text,
  frame_effects     text[] not null default '{}',
  border_color      text,
  full_art          boolean not null default false,
  textless          boolean not null default false,
  promo             boolean not null default false,
  promo_types       text[] not null default '{}',
  variation         boolean not null default false,
  finishes          text[] not null default '{}',
  -- Full raw Scryfall card object — the source of truth this row was built
  -- from, so normalizeScryfallCard(row.raw) reproduces the exact same
  -- CardPrinting the live API would have given.
  raw               jsonb not null,
  bulk_updated_at   timestamptz not null default now()
);

comment on table public.scryfall_bulk_cards is
  'Refreshable local cache of Scryfall bulk default_cards data, for offline candidate generation during recognition. Not the source of inventory truth — card_printings is.';

-- Exact set+collector+lang lookup (the strongest identity signal for modern
-- cards) and name search are the two hot paths.
create unique index if not exists scryfall_bulk_cards_set_cn_lang_key
  on public.scryfall_bulk_cards (set_code, collector_number, lang);
create index if not exists scryfall_bulk_cards_name_idx
  on public.scryfall_bulk_cards using gin (card_name gin_trgm_ops);
create index if not exists scryfall_bulk_cards_oracle_idx
  on public.scryfall_bulk_cards (oracle_id);
create index if not exists scryfall_bulk_cards_set_idx
  on public.scryfall_bulk_cards (set_code);

-- Staff-only reads (same posture as card_printings/inventory_items); all
-- writes are the refresh script, via service_role.
alter table public.scryfall_bulk_cards enable row level security;

drop policy if exists scryfall_bulk_cards_staff_select on public.scryfall_bulk_cards;
create policy scryfall_bulk_cards_staff_select
  on public.scryfall_bulk_cards for select to authenticated
  using (public.is_staff());

grant select on public.scryfall_bulk_cards to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.scryfall_bulk_cards
  from anon, authenticated;

commit;
