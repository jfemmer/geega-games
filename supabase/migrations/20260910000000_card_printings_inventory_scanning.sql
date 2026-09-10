-- 20260910000000_card_printings_inventory_scanning
--
-- Foundation for exact-printing inventory + the high-volume card scanning
-- pipeline. Purely ADDITIVE: the legacy flat `public.cards` catalog table is
-- left untouched so the current storefront keeps working. New inventory lives in
-- new tables keyed by the EXACT Scryfall printing (scryfall_id) plus condition
-- and finish — the real identity of a physical card — rather than by card name.
--
-- Migration strategy for legacy `cards`:
--   * `cards` remains the storefront's read source until a follow-up backfill.
--   * A future data migration can, per legacy row, resolve a scryfall_id (via
--     the Scryfall API by set + collector number), upsert a card_printings row,
--     and create an inventory_items row. That backfill is intentionally NOT part
--     of this schema migration so schema and data changes stay separable and
--     each is independently reviewable/reversible.
--
-- Conventions reused from the existing schema:
--   * uuid primary keys (gen_random_uuid)
--   * timestamptz columns + public.tg_set_updated_at() trigger for updated_at
--   * public.is_staff() gates staff reads
--   * RLS ON; browser roles get SELECT only where appropriate; ALL writes go
--     through the service_role key used exclusively by server-side Functions.

begin;

-- ---------------------------------------------------------------------------
-- Enums (reuse existing card_condition / card_finish if already present)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'card_condition') then
    create type public.card_condition as enum ('NM', 'LP', 'MP', 'HP', 'DMG');
  end if;

  if not exists (select 1 from pg_type where typname = 'card_finish') then
    create type public.card_finish as enum ('nonfoil', 'foil', 'etched', 'glossy');
  end if;

  if not exists (select 1 from pg_type where typname = 'inventory_status') then
    create type public.inventory_status as enum ('active', 'reserved', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'inventory_movement_reason') then
    create type public.inventory_movement_reason as enum (
      'manual_add',
      'manual_remove',
      'sale',
      'return',
      'correction',
      'scan_add',
      'batch_scan_add'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'scan_session_status') then
    create type public.scan_session_status as enum (
      'uploading',
      'processing',
      'pending_review',
      'reviewing',
      'completed',
      'partially_failed',
      'failed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'scan_source_type') then
    create type public.scan_source_type as enum (
      'scanner_export',
      'file_upload',
      'folder_drop',
      'scanner_bridge'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'scan_review_status') then
    create type public.scan_review_status as enum (
      'unreviewed',
      'pending_match',
      'matched',
      'needs_manual_match',
      'ready',
      'added',
      'rejected',
      'error'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'recognition_status') then
    create type public.recognition_status as enum (
      'none',
      'queued',
      'processing',
      'recognized',
      'low_confidence',
      'failed'
    );
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- card_printings — a cache of the EXACT Scryfall printings we actually stock.
-- We never bulk-import the whole catalog; rows are upserted on demand when a
-- printing is selected in the admin (add flow or scan match).
-- ---------------------------------------------------------------------------
create table if not exists public.card_printings (
  scryfall_id       uuid primary key,
  oracle_id         uuid,
  card_name         text not null,
  set_code          text not null,
  set_name          text not null,
  collector_number  text not null,
  rarity            text not null,
  card_type         text,
  layout            text,
  artist            text,
  released_at       date,
  language          text not null default 'en',
  frame             text,
  frame_effects     text[] not null default '{}',
  border_color      text,
  full_art          boolean not null default false,
  textless          boolean not null default false,
  promo             boolean not null default false,
  promo_types       text[] not null default '{}',
  treatments        text[] not null default '{}',
  available_finishes public.card_finish[] not null default '{nonfoil}',
  -- Normalized image URLs and per-face data as returned by our normalizer.
  images            jsonb not null default '{}'::jsonb,
  faces             jsonb not null default '[]'::jsonb,
  -- Reference prices in integer cents.
  price_usd_cents        integer,
  price_usd_foil_cents   integer,
  price_usd_etched_cents integer,
  prices_updated_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.card_printings is
  'On-demand cache of exact Scryfall printings we stock. Keyed by scryfall_id.';

create index if not exists card_printings_name_idx on public.card_printings (card_name);
create index if not exists card_printings_set_cn_idx on public.card_printings (set_code, collector_number);
create index if not exists card_printings_oracle_idx on public.card_printings (oracle_id);

create trigger set_updated_at
  before update on public.card_printings
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- inventory_items — one row per exact printing + condition + finish.
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_items (
  id                 uuid primary key default gen_random_uuid(),
  scryfall_id        uuid references public.card_printings (scryfall_id),
  -- Denormalized snapshot so legacy rows (scryfall_id null) still describe a card.
  card_name          text not null,
  set_code           text not null,
  set_name           text not null,
  collector_number   text not null,
  rarity             text not null,
  card_type          text,
  image_url          text,
  condition          public.card_condition not null,
  finish             public.card_finish not null,
  quantity           integer not null default 0 check (quantity >= 0),
  price_cents        integer not null check (price_cents >= 0),
  cost_cents         integer check (cost_cents >= 0),
  storage_location   text,
  sku                text,
  notes              text,
  status             public.inventory_status not null default 'active',
  scryfall_price_cents integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.inventory_items is
  'Sellable stock. Identity = scryfall_id + condition + finish (exact printing).';

-- The exact-printing uniqueness guarantee that makes commit-time dedupe safe.
-- Partial unique index so legacy rows with null scryfall_id are exempt.
create unique index if not exists inventory_items_exact_printing_key
  on public.inventory_items (scryfall_id, condition, finish)
  where scryfall_id is not null and status <> 'archived';

create index if not exists inventory_items_name_idx on public.inventory_items (card_name);
create index if not exists inventory_items_status_idx on public.inventory_items (status);
create index if not exists inventory_items_low_stock_idx on public.inventory_items (quantity);

create trigger set_updated_at
  before update on public.inventory_items
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- inventory_movements — append-only audit ledger of every quantity change.
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_movements (
  id                uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items (id) on delete cascade,
  delta             integer not null,
  reason            public.inventory_movement_reason not null,
  actor             text,
  note              text,
  created_at        timestamptz not null default now()
);

comment on table public.inventory_movements is
  'Append-only ledger. Every add/remove/sale/scan writes one row here.';

create index if not exists inventory_movements_item_idx
  on public.inventory_movements (inventory_item_id, created_at desc);

-- ---------------------------------------------------------------------------
-- scan_sessions — a persistent batch of scans from one import.
-- ---------------------------------------------------------------------------
create table if not exists public.scan_sessions (
  id              uuid primary key default gen_random_uuid(),
  label           text not null,
  created_by      text,
  scanner_name    text,
  source_type     public.scan_source_type not null default 'scanner_export',
  status          public.scan_session_status not null default 'uploading',
  total_files     integer not null default 0,
  total_cards     integer not null default 0,
  reviewed_cards  integer not null default 0,
  matched_cards   integer not null default 0,
  ready_cards     integer not null default 0,
  added_cards     integer not null default 0,
  rejected_cards  integer not null default 0,
  failed_cards    integer not null default 0,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz
);

comment on table public.scan_sessions is
  'A persistent batch scanning session (e.g. one Ricoh fi-8170 import run).';

create index if not exists scan_sessions_status_idx on public.scan_sessions (status);
create index if not exists scan_sessions_created_idx on public.scan_sessions (created_at desc);

create trigger set_updated_at
  before update on public.scan_sessions
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- card_scans — one row per scanned physical card (front + optional back).
-- ---------------------------------------------------------------------------
create table if not exists public.card_scans (
  id                uuid primary key default gen_random_uuid(),
  scan_session_id   uuid not null references public.scan_sessions (id) on delete cascade,
  sequence_number   integer not null,
  front_image_path  text,
  back_image_path   text,
  -- Chosen exact printing (nullable until matched).
  selected_scryfall_id uuid references public.card_printings (scryfall_id),
  recognition_status   public.recognition_status not null default 'none',
  recognition_confidence numeric(4,3),
  recognition_data     jsonb,
  suggested_condition  public.card_condition,
  suggested_condition_confidence numeric(4,3),
  confirmed_condition  public.card_condition,
  selected_finish      public.card_finish,
  quantity          integer not null default 1 check (quantity >= 1),
  price_cents       integer check (price_cents >= 0),
  cost_cents        integer check (cost_cents >= 0),
  storage_location  text,
  notes             text,
  review_status     public.scan_review_status not null default 'unreviewed',
  reviewed_by       text,
  reviewed_at       timestamptz,
  -- Set once committed; presence makes commit idempotent.
  inventory_item_id uuid references public.inventory_items (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint card_scans_session_sequence_key unique (scan_session_id, sequence_number)
);

comment on table public.card_scans is
  'One scanned physical card. inventory_item_id set at commit → idempotent.';

create index if not exists card_scans_session_idx
  on public.card_scans (scan_session_id, sequence_number);
create index if not exists card_scans_review_status_idx
  on public.card_scans (scan_session_id, review_status);

create trigger set_updated_at
  before update on public.card_scans
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Reads: staff only (is_staff()). None of these tables are public — the
-- storefront continues to read the legacy `cards` table. Writes: none for the
-- browser roles; the service_role bypasses RLS and is the only writer, used
-- exclusively by server-side Vercel Functions that re-check staff identity.
-- ---------------------------------------------------------------------------
alter table public.card_printings      enable row level security;
alter table public.inventory_items     enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.scan_sessions       enable row level security;
alter table public.card_scans          enable row level security;

create policy card_printings_staff_select
  on public.card_printings for select to authenticated
  using (public.is_staff());

create policy inventory_items_staff_select
  on public.inventory_items for select to authenticated
  using (public.is_staff());

create policy inventory_movements_staff_select
  on public.inventory_movements for select to authenticated
  using (public.is_staff());

create policy scan_sessions_staff_select
  on public.scan_sessions for select to authenticated
  using (public.is_staff());

create policy card_scans_staff_select
  on public.card_scans for select to authenticated
  using (public.is_staff());

-- Privilege layer: browser roles never write. SELECT is additionally gated by
-- the staff policies above. anon gets nothing.
grant select on public.card_printings      to authenticated;
grant select on public.inventory_items     to authenticated;
grant select on public.inventory_movements to authenticated;
grant select on public.scan_sessions       to authenticated;
grant select on public.card_scans          to authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.card_printings, public.inventory_items, public.inventory_movements,
     public.scan_sessions, public.card_scans
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket for physical scan images (private; served via signed URLs).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('card-scans', 'card-scans', false)
on conflict (id) do nothing;

-- Staff may read scan images; writes happen server-side via service_role.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'card_scans_staff_read'
  ) then
    create policy card_scans_staff_read
      on storage.objects for select to authenticated
      using (bucket_id = 'card-scans' and public.is_staff());
  end if;
end$$;

commit;
