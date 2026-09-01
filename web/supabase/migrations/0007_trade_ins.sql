-- =============================================================================
-- 0007_trade_ins.sql
-- Customer trade-in submissions ("incoming collections"). Owner reads own;
-- staff/admin read all. Estimated/offer values in CENTS.
-- =============================================================================

create table if not exists public.trade_ins (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete restrict,

  -- Contact snapshot at submission time.
  first_name       text,
  last_name        text,
  email            text,
  phone            text,

  status           trade_in_status not null default 'new',
  total_cards      integer not null default 0 check (total_cards >= 0),
  estimated_value_cents integer check (estimated_value_cents is null or estimated_value_cents >= 0),
  offer_value_cents     integer check (offer_value_cents is null or offer_value_cents >= 0),

  source           text default 'Website Trade-In',
  notes            text,            -- customer-visible
  internal_notes   text,            -- staff-only (protected by column-safe RLS/view usage)

  legacy_mongo_id  text unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_trade_ins_user on public.trade_ins(user_id, created_at desc);
create index if not exists idx_trade_ins_status on public.trade_ins(status);

create trigger trg_trade_ins_updated_at
  before update on public.trade_ins
  for each row execute function public.tg_set_updated_at();

create table if not exists public.trade_in_items (
  id            uuid primary key default gen_random_uuid(),
  trade_in_id   uuid not null references public.trade_ins(id) on delete cascade,
  scryfall_id   uuid,
  card_name     text not null,
  set_code      text,
  set_name      text,
  condition     card_condition,
  finish        card_finish not null default 'nonfoil',
  quantity      integer not null default 1 check (quantity > 0),
  image_url     text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_trade_in_items_ti on public.trade_in_items(trade_in_id);

comment on column public.trade_ins.internal_notes is
  'Staff-only field. Client-facing reads must exclude this (use a view or select explicit columns).';
