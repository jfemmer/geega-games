-- =============================================================================
-- 0003_inventory.sql
-- inventory_items: one row per stockable SKU = exact printing + condition + finish.
--
-- KEY CHANGE vs legacy: identity is anchored on stable Scryfall/Oracle IDs and
-- set_code + collector_number, NOT on human-readable string tuples. This kills
-- the fragile variantType fallbacks in the old code and makes reprints/variants
-- unambiguous. Prices are integer CENTS.
-- =============================================================================

create table if not exists public.inventory_items (
  id                uuid primary key default gen_random_uuid(),

  -- ---- Stable printing identity (preferred join key everywhere) ----
  scryfall_id       uuid,             -- exact printing (nullable for hand-entered legacy rows)
  oracle_id         uuid,             -- the card across printings
  set_code          text not null,
  collector_number  text not null,
  language          text not null default 'en',

  -- ---- Human-readable / display ----
  card_name         text not null,
  set_name          text,
  rarity            text,             -- common | uncommon | rare | mythic | special | bonus
  type_line         text,
  colors            text[] not null default '{}',
  creature_types    text[] not null default '{}',
  image_url         text,

  -- ---- SKU dimensions ----
  condition         card_condition not null,
  finish            card_finish    not null default 'nonfoil',
  -- foil kept as a generated mirror of finish for query ergonomics / legacy parity.
  foil              boolean generated always as (finish <> 'nonfoil') stored,
  variant_type      text not null default '',   -- normalized lowercase (e.g. 'borderless','showcase')

  -- ---- Stock & pricing (CENTS) ----
  quantity          integer not null default 0 check (quantity >= 0),
  price_cents       integer check (price_cents is null or price_cents >= 0),
  -- Acquisition cost for margin reporting (optional, admin-only via RLS).
  cost_cents        integer check (cost_cents is null or cost_cents >= 0),

  -- ---- Meta ----
  legacy_mongo_id   text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One SKU per exact printing + condition + finish + variant + language.
-- Uses coalesce on scryfall_id so hand-entered rows (null scryfall_id) still
-- dedupe on the readable tuple.
create unique index if not exists uq_inventory_sku
  on public.inventory_items (
    coalesce(scryfall_id::text, set_code || ':' || collector_number),
    condition,
    finish,
    variant_type,
    language
  );

-- Search / filter indexes.
create index if not exists idx_inventory_name_trgm
  on public.inventory_items using gin (card_name gin_trgm_ops);
create index if not exists idx_inventory_set on public.inventory_items(set_code);
create index if not exists idx_inventory_oracle on public.inventory_items(oracle_id);
create index if not exists idx_inventory_scryfall on public.inventory_items(scryfall_id);
create index if not exists idx_inventory_rarity on public.inventory_items(rarity);
create index if not exists idx_inventory_colors on public.inventory_items using gin (colors);
create index if not exists idx_inventory_ctypes on public.inventory_items using gin (creature_types);
-- Fast "in stock" browse (partial index).
create index if not exists idx_inventory_instock
  on public.inventory_items(card_name)
  where quantity > 0;

create trigger trg_inventory_updated_at
  before update on public.inventory_items
  for each row execute function public.tg_set_updated_at();

comment on table public.inventory_items is
  'One row per stockable SKU (exact printing + condition + finish + variant). Prices in cents.';
comment on column public.inventory_items.foil is
  'Generated mirror of finish for legacy parity; do not write directly.';
