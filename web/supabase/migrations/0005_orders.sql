-- =============================================================================
-- 0005_orders.sql
-- orders + order_items. All money in CENTS. Payment is provider-agnostic
-- (stripe | paypal | store_credit). payment_status may only be moved to 'paid'
-- by a verified webhook/capture (enforced in server code + RPCs, never client).
-- order_items snapshot the printing identity and unit price at purchase time so
-- historical orders never depend on current inventory prices.
-- =============================================================================

create table if not exists public.orders (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete restrict,

  -- ---- Contact / shipping snapshot (captured at checkout) ----
  email                 text not null,
  ship_recipient        text,
  ship_line1            text,
  ship_line2            text,
  ship_city             text,
  ship_state            text,
  ship_postal_code      text,
  ship_country          text default 'US',

  -- ---- Money (CENTS) ----
  subtotal_cents        integer not null check (subtotal_cents >= 0),
  shipping_cents        integer not null default 0 check (shipping_cents >= 0),
  discount_cents        integer not null default 0 check (discount_cents >= 0),
  store_credit_used_cents integer not null default 0 check (store_credit_used_cents >= 0),
  total_cents           integer not null check (total_cents >= 0),
  amount_due_cents      integer not null check (amount_due_cents >= 0), -- total - store_credit

  -- ---- Shipping ----
  shipping_method       shipping_method not null,

  -- ---- Payment (provider-agnostic) ----
  payment_provider      payment_provider,
  payment_reference     text,   -- Stripe PaymentIntent id OR PayPal order id
  payment_status        payment_status not null default 'unpaid',
  paid_at               timestamptz,

  -- ---- Lifecycle ----
  status                order_status not null default 'pending_payment',
  packed_at             timestamptz,
  ready_at              timestamptz,
  shipped_at            timestamptz,
  delivered_at          timestamptz,
  cancelled_at          timestamptz,

  -- ---- Fulfillment ----
  tracking_number       text,
  tracking_carrier      text,

  -- ---- Meta ----
  legacy_mongo_id       text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Integrity: amount_due must equal total minus credit.
  constraint chk_amount_due check (amount_due_cents = total_cents - store_credit_used_cents)
);

-- One order per payment reference per provider (idempotency / reconciliation).
create unique index if not exists uq_orders_payment_ref
  on public.orders(payment_provider, payment_reference)
  where payment_reference is not null;

create index if not exists idx_orders_user on public.orders(user_id, created_at desc);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_payment_status on public.orders(payment_status);

create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.tg_set_updated_at();

-- ---- order_items ------------------------------------------------------------
create table if not exists public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  -- Reference kept for analytics, but nulled-safe: printing identity is snapshotted
  -- below so the historical record survives inventory deletion.
  inventory_item_id uuid references public.inventory_items(id) on delete set null,

  -- ---- Snapshot of identity + price at purchase ----
  scryfall_id       uuid,
  set_code          text,
  collector_number  text,
  card_name         text not null,
  set_name          text,
  condition         card_condition not null,
  finish            card_finish not null default 'nonfoil',
  variant_type      text not null default '',
  image_url         text,

  quantity          integer not null check (quantity > 0),
  unit_price_cents  integer not null check (unit_price_cents >= 0),
  line_total_cents  integer not null check (line_total_cents >= 0),

  created_at        timestamptz not null default now()
);

create index if not exists idx_order_items_order on public.order_items(order_id);

comment on table public.order_items is
  'Line items snapshot printing identity + unit price at purchase. Historical orders never read current inventory prices.';
