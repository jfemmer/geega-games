-- Trade Center: customers trade their Magic cards toward cards from our
-- inventory, online (storefront "Trade Cards", admin "Trades").
--
-- How a trade runs (statuses are trade_requests.status):
--   awaiting_trade_list   The customer picked cards from inventory and
--                         started a trade: those cards are held (an
--                         inventory_reservations row each) for
--                         reservation_hours while they list their cards.
--   pending_review        They sent their list. The hold stays until staff
--                         decide.
--   revision_requested    Staff asked for changes; the hold runs for
--                         revision_hours.
--   awaiting_shipment     Preliminarily approved: they have until ship_by
--                         (business days) plus ship_grace_hours to send a
--                         tracking number.
--   in_transit            Tracking sent. Never released automatically.
--   received / under_inspection
--   awaiting_final_approval  The final offer, after inspection. Waits for the
--                         customer: nothing is forfeited for not answering.
--   awaiting_payment      Accepted; their trade credit doesn't cover the
--                         cards, so they pay the rest by card.
--   approved_for_fulfillment  Done: the credit was issued as store credit,
--                         spent on a paid order for our cards, and the
--                         order ships through Orders as usual.
--   completed             That order shipped.
--   rejected / canceled / expired  Closed before anything was shipped to us;
--                         holds released.
--   return_pending / returned  Their cards are (being) mailed back.
--
-- Money: the customer's cards are valued at a reference price (Scryfall's,
-- from TCGplayer) adjusted for condition, then by staff; only cards worth at
-- least min_card_value_cents each are taken; the trade credit is
-- credit_rate_percent of the accepted value. Our cards are at their regular
-- price (a deal's price before the discount; no sale or member pricing),
-- fixed when the trade starts. Credit is issued only when the trade is
-- finalized (store_credit_transactions, type trade_in_payout, once per trade)
-- and is spent on the trade's own order at once; anything left over stays
-- as store credit.
--
-- Also here: a 'trade' kind of staff push notification, and the admin
-- sidebar's Trades number (admin_nav_badges).
--
-- Everything here is read and written by the server (service role) only:
-- RLS is on with no policies, and the functions refuse any other caller.
-- The API checks who the customer is and hands their user id in.

-- 0. Imported trade-ins get their own reason in the inventory ledger ---------
alter type public.inventory_movement_reason add value if not exists 'trade_in';

-- 1. Settings (one row) --------------------------------------------------------
create table if not exists public.trade_settings (
  id boolean primary key default true check (id),
  -- Off until staff set it up (address, policies) and switch it on.
  enabled boolean not null default false,
  -- Emergency stop for new trades; trades underway carry on.
  paused boolean not null default false,
  pause_message text not null default 'We''re not taking new trades right now. Trades already underway carry on as normal.'
    check (char_length(pause_message) <= 500),

  credit_rate_percent integer not null default 80 check (credit_rate_percent between 1 and 100),
  min_card_value_cents integer not null default 1500 check (min_card_value_cents between 0 and 10000000),
  -- Share of the reference price a card in each condition is valued at.
  condition_nm_percent integer not null default 100 check (condition_nm_percent between 0 and 100),
  condition_lp_percent integer not null default 90 check (condition_lp_percent between 0 and 100),
  condition_mp_percent integer not null default 75 check (condition_mp_percent between 0 and 100),
  condition_hp_percent integer not null default 60 check (condition_hp_percent between 0 and 100),
  condition_dmg_percent integer not null default 40 check (condition_dmg_percent between 0 and 100),

  reservation_hours integer not null default 24 check (reservation_hours between 1 and 168),
  revision_hours integer not null default 48 check (revision_hours between 1 and 336),
  ship_business_days integer not null default 5 check (ship_business_days between 1 and 30),
  ship_grace_hours integer not null default 24 check (ship_grace_hours between 0 and 336),
  -- In transit longer than this: flagged for staff (never released by itself).
  transit_alert_days integer not null default 10 check (transit_alert_days between 1 and 90),
  payment_due_days integer not null default 7 check (payment_due_days between 1 and 60),

  max_active_trades integer not null default 2 check (max_active_trades between 1 and 20),
  max_wanted_lines integer not null default 40 check (max_wanted_lines between 1 and 200),
  max_offered_lines integer not null default 100 check (max_offered_lines between 1 and 500),
  min_trade_value_cents integer not null default 0 check (min_trade_value_cents between 0 and 100000000),
  max_trade_value_cents integer check (max_trade_value_cents is null or max_trade_value_cents between 1 and 100000000),
  -- Holds left to expire this many times in 30 days: no new trades for a while.
  max_expired_trades_30d integer not null default 3 check (max_expired_trades_30d between 1 and 50),
  processing_fee_cents integer not null default 0 check (processing_fee_cents between 0 and 1000000),

  cash_payout_enabled boolean not null default false,
  cash_rate_percent integer not null default 50 check (cash_rate_percent between 1 and 100),

  -- 0: off. Otherwise a card we already have this many of can't be offered.
  overstock_threshold integer not null default 0 check (overstock_threshold between 0 and 1000),
  excluded_set_codes text[] not null default '{}',
  excluded_card_names text[] not null default '{}',

  notify_customer boolean not null default true,
  notify_staff boolean not null default true,

  -- Who pays to ship the customer's cards to us (wording only for now).
  shipping_paid_by text not null default 'customer' check (shipping_paid_by in ('customer', 'store')),
  -- Where customers mail their cards. Required before a trade can be approved.
  ship_to_name text check (ship_to_name is null or char_length(ship_to_name) <= 120),
  ship_to_line1 text check (ship_to_line1 is null or char_length(ship_to_line1) <= 200),
  ship_to_line2 text check (ship_to_line2 is null or char_length(ship_to_line2) <= 200),
  ship_to_city text check (ship_to_city is null or char_length(ship_to_city) <= 100),
  ship_to_state text check (ship_to_state is null or char_length(ship_to_state) <= 40),
  ship_to_postal_code text check (ship_to_postal_code is null or char_length(ship_to_postal_code) <= 20),
  packing_instructions text not null default 'Put each card in a penny sleeve and a toploader or card saver, keep them together in a team bag, and pack them snugly in a bubble mailer or small box so nothing moves. Write your trade ID on a slip of paper inside. Please use a tracked shipping service.'
    check (char_length(packing_instructions) <= 4000),
  return_policy text not null default 'If you decline the final offer, or we can''t accept a card, we''ll mail those cards back to you. We''ll confirm any return shipping cost with you before we send them. We never keep a card you haven''t agreed to trade.'
    check (char_length(return_policy) <= 4000),

  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.trade_settings (id) values (true) on conflict (id) do nothing;

comment on table public.trade_settings is
  'Trade Center settings (one row): on/off and pause, the trade credit rate and minimum card value, condition values, deadlines, limits, cash payouts, eligibility, and the shipping address and policies customers are shown.';

-- 2. Trades -----------------------------------------------------------------------
create table if not exists public.trade_requests (
  id uuid primary key default gen_random_uuid(),
  -- Shown as "TR-1001".
  trade_number bigint generated always as identity (start with 1001) not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  customer_name text check (customer_name is null or char_length(customer_name) <= 120),
  customer_email text check (customer_email is null or char_length(customer_email) <= 254),

  status text not null default 'awaiting_trade_list' check (status in (
    'awaiting_trade_list', 'pending_review', 'revision_requested', 'awaiting_shipment',
    'in_transit', 'received', 'under_inspection', 'awaiting_final_approval',
    'awaiting_payment', 'approved_for_fulfillment', 'completed',
    'rejected', 'canceled', 'expired', 'return_pending', 'returned'
  )),

  -- The terms the trade started on; a later settings change doesn't move them.
  credit_rate_percent integer not null check (credit_rate_percent between 1 and 100),
  min_card_value_cents integer not null check (min_card_value_cents >= 0),
  condition_percents jsonb not null check (jsonb_typeof(condition_percents) = 'object'),
  processing_fee_cents integer not null default 0 check (processing_fee_cents >= 0),

  -- Our cards, at the prices fixed when they were added.
  wanted_total_cents integer not null default 0 check (wanted_total_cents >= 0),
  -- Their cards: what the list was estimated at, what staff approved before
  -- shipping, and the final value after inspection.
  estimated_value_cents integer not null default 0 check (estimated_value_cents >= 0),
  approved_value_cents integer check (approved_value_cents is null or approved_value_cents >= 0),
  final_value_cents integer check (final_value_cents is null or final_value_cents >= 0),
  final_credit_cents integer check (final_credit_cents is null or final_credit_cents >= 0),
  -- Settled when the customer accepts the final offer.
  shipping_cents integer check (shipping_cents is null or shipping_cents >= 0),
  amount_due_cents integer check (amount_due_cents is null or amount_due_cents >= 0),
  excess_cents integer check (excess_cents is null or excess_cents >= 0),
  excess_handling text not null default 'store_credit' check (excess_handling in ('store_credit', 'cash')),
  cash_payout_cents integer check (cash_payout_cents is null or cash_payout_cents >= 0),
  cash_paid_at timestamptz,

  -- The deadline of the current hold: list due, revision due, or ship-by plus
  -- grace. Null while nothing should expire on its own.
  hold_expires_at timestamptz,
  ship_by timestamptz,
  payment_due_at timestamptz,
  approval_conditions text check (approval_conditions is null or char_length(approval_conditions) <= 2000),

  inbound_carrier text check (inbound_carrier is null or char_length(inbound_carrier) <= 40),
  inbound_tracking text check (inbound_tracking is null or char_length(inbound_tracking) <= 60),
  inbound_shipped_at timestamptz,
  return_carrier text check (return_carrier is null or char_length(return_carrier) <= 40),
  return_tracking text check (return_tracking is null or char_length(return_tracking) <= 60),
  returned_at timestamptz,

  -- Where our cards ship (taken when the final offer is accepted).
  ship_name text check (ship_name is null or char_length(ship_name) <= 120),
  ship_line1 text check (ship_line1 is null or char_length(ship_line1) <= 200),
  ship_line2 text check (ship_line2 is null or char_length(ship_line2) <= 200),
  ship_city text check (ship_city is null or char_length(ship_city) <= 100),
  ship_state text check (ship_state is null or char_length(ship_state) <= 40),
  ship_postal_code text check (ship_postal_code is null or char_length(ship_postal_code) <= 20),

  order_id uuid unique references public.orders(id) on delete set null,
  payment_reference text,
  credit_issued_cents integer check (credit_issued_cents is null or credit_issued_cents >= 0),

  customer_note text check (customer_note is null or char_length(customer_note) <= 2000),
  close_reason text check (close_reason is null or char_length(close_reason) <= 2000),

  submitted_at timestamptz,
  approved_at timestamptz,
  received_at timestamptz,
  final_offer_at timestamptz,
  accepted_at timestamptz,
  paid_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trade_requests_user_idx on public.trade_requests (user_id, created_at desc);
create index if not exists trade_requests_status_idx on public.trade_requests (status, updated_at desc);
create index if not exists trade_requests_hold_idx on public.trade_requests (hold_expires_at)
  where hold_expires_at is not null;

comment on table public.trade_requests is
  'Online trades (Trade Center): the customer''s cards toward cards from inventory. Statuses and money are explained in migration 20261025120000_trade_center.sql.';

-- 3. Our cards on a trade ---------------------------------------------------------
create table if not exists public.trade_request_items (
  id uuid primary key default gen_random_uuid(),
  trade_request_id uuid not null references public.trade_requests(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  reservation_id uuid references public.inventory_reservations(id) on delete set null,
  quantity integer not null check (quantity between 1 and 99),
  -- The regular price when it was added (a deal's price before the discount).
  unit_price_cents integer not null check (unit_price_cents > 0),
  card_name text not null,
  set_code text,
  set_name text,
  collector_number text,
  condition public.card_condition not null,
  finish public.card_finish not null,
  variant_type text,
  image_url text,
  scryfall_id uuid,
  status text not null default 'reserved' check (status in ('reserved', 'released', 'fulfilled')),
  created_at timestamptz not null default now(),
  unique (trade_request_id, inventory_item_id)
);

create index if not exists trade_request_items_trade_idx on public.trade_request_items (trade_request_id);

-- 4. Their cards on a trade -------------------------------------------------------
create table if not exists public.trade_offer_cards (
  id uuid primary key default gen_random_uuid(),
  trade_request_id uuid not null references public.trade_requests(id) on delete cascade,
  position integer not null default 0,

  scryfall_id uuid,
  card_name text not null check (char_length(card_name) between 1 and 200),
  set_code text check (set_code is null or char_length(set_code) <= 12),
  set_name text check (set_name is null or char_length(set_name) <= 120),
  collector_number text check (collector_number is null or char_length(collector_number) <= 16),
  finish public.card_finish not null default 'nonfoil',
  image_url text,
  quantity integer not null check (quantity between 1 and 99),
  reported_condition public.card_condition not null default 'NM',
  customer_estimate_cents integer check (customer_estimate_cents is null or customer_estimate_cents between 0 and 10000000),
  customer_note text check (customer_note is null or char_length(customer_note) <= 500),

  -- Worked out by the server when the list is saved.
  reference_price_cents integer check (reference_price_cents is null or reference_price_cents >= 0),
  reference_checked_at timestamptz,
  condition_percent integer not null default 100 check (condition_percent between 0 and 100),
  estimated_unit_cents integer check (estimated_unit_cents is null or estimated_unit_cents >= 0),
  eligibility text not null default 'needs_review' check (eligibility in (
    'eligible', 'needs_review', 'below_minimum', 'excluded_set', 'excluded_card', 'overstocked'
  )),
  stock_on_hand integer,

  -- Staff review of the list.
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  approved_quantity integer check (approved_quantity is null or approved_quantity between 0 and 99),
  approved_unit_cents integer check (approved_unit_cents is null or approved_unit_cents between 0 and 10000000),
  review_note text check (review_note is null or char_length(review_note) <= 1000),        -- the customer sees it
  internal_note text check (internal_note is null or char_length(internal_note) <= 2000),  -- staff only

  -- Inspection of what arrived.
  received_quantity integer check (received_quantity is null or received_quantity between 0 and 99),
  authenticity text not null default 'unchecked' check (authenticity in ('unchecked', 'authentic', 'counterfeit', 'unsure')),
  verified_condition public.card_condition,
  final_quantity integer check (final_quantity is null or final_quantity between 0 and 99),
  final_unit_cents integer check (final_unit_cents is null or final_unit_cents between 0 and 10000000),
  flags text[] not null default '{}'
    check (flags <@ array['damaged', 'counterfeit', 'incorrect', 'missing']::text[]),
  inspection_note text check (inspection_note is null or char_length(inspection_note) <= 1000),                    -- the customer sees it
  inspection_internal_note text check (inspection_internal_note is null or char_length(inspection_internal_note) <= 2000),
  inspected_at timestamptz,

  -- What happened to the physical card(s).
  disposition text not null default 'pending' check (disposition in ('pending', 'accepted', 'rejected', 'returned', 'imported')),
  imported_inventory_item_id uuid references public.inventory_items(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trade_offer_cards_trade_idx on public.trade_offer_cards (trade_request_id, position);

-- 5. History and messages -----------------------------------------------------------
create table if not exists public.trade_events (
  id uuid primary key default gen_random_uuid(),
  trade_request_id uuid not null references public.trade_requests(id) on delete cascade,
  actor_type text not null check (actor_type in ('customer', 'staff', 'system')),
  actor_id uuid,
  actor_label text check (actor_label is null or char_length(actor_label) <= 200),
  event text not null check (char_length(event) between 1 and 60),
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trade_events_trade_idx on public.trade_events (trade_request_id, created_at);

create table if not exists public.trade_messages (
  id uuid primary key default gen_random_uuid(),
  trade_request_id uuid not null references public.trade_requests(id) on delete cascade,
  author_type text not null check (author_type in ('customer', 'staff', 'system')),
  author_id uuid,
  author_label text check (author_label is null or char_length(author_label) <= 200),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  -- False: an internal note, never shown to the customer.
  visible_to_customer boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists trade_messages_trade_idx on public.trade_messages (trade_request_id, created_at);

-- 6. Links into existing tables -----------------------------------------------------
-- A trade's holds are inventory_reservations rows like any other, so the
-- storefront, cart, checkout and pickups already count them as taken.
-- (They have no customer_id, so admin Reservations, which lists customer
-- holds, doesn't show them and can't release them out from under a trade.)
alter table public.inventory_reservations
  add column if not exists trade_request_id uuid references public.trade_requests(id) on delete cascade;
create index if not exists inventory_reservations_trade_idx on public.inventory_reservations (trade_request_id)
  where trade_request_id is not null;
-- A hold belongs to exactly one holder: a customer, a pickup request, or now
-- a trade. Every existing row has exactly one of the first two, so it still
-- passes. (Before: exactly one of customer_id and pickup_request_id. To go
-- back, once no trade holds remain: drop this and add that check again.)
alter table public.inventory_reservations drop constraint if exists chk_reservation_holder;
alter table public.inventory_reservations add constraint chk_reservation_holder
  check (num_nonnulls(customer_id, pickup_request_id, trade_request_id) = 1);

alter table public.orders
  add column if not exists trade_request_id uuid references public.trade_requests(id) on delete set null;
create unique index if not exists orders_trade_request_once on public.orders (trade_request_id)
  where trade_request_id is not null;

-- A trade's credit is issued once, however often finalizing is retried.
create unique index if not exists store_credit_trade_payout_once on public.store_credit_transactions (reference_id)
  where reference_type = 'trade_request' and type = 'trade_in_payout';

-- 7. Locked down: the server does everything ------------------------------------
alter table public.trade_settings enable row level security;
alter table public.trade_requests enable row level security;
alter table public.trade_request_items enable row level security;
alter table public.trade_offer_cards enable row level security;
alter table public.trade_events enable row level security;
alter table public.trade_messages enable row level security;
revoke all on public.trade_settings, public.trade_requests, public.trade_request_items,
  public.trade_offer_cards, public.trade_events, public.trade_messages from anon, authenticated;

-- updated_at bookkeeping, like the other tables.
drop trigger if exists set_updated_at on public.trade_requests;
create trigger set_updated_at before update on public.trade_requests
  for each row execute function public.tg_set_updated_at();
drop trigger if exists set_updated_at on public.trade_offer_cards;
create trigger set_updated_at before update on public.trade_offer_cards
  for each row execute function public.tg_set_updated_at();

-- 8. Helpers ------------------------------------------------------------------------
-- A card's regular price: what it's listed at before any discount.
create or replace function public.trade_regular_price(p_price_cents integer, p_original_price_cents integer, p_is_deal boolean)
returns integer
language sql
immutable
as $$
  select case when coalesce(p_is_deal, false) and p_original_price_cents is not null
              then p_original_price_cents else p_price_cents end;
$$;

create or replace function public.trade_require_service_role()
returns void
language plpgsql
stable
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trades are handled by the server' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.trade_log(
  p_trade_id uuid, p_actor_type text, p_actor_id uuid, p_actor_label text,
  p_event text, p_from text, p_to text, p_detail jsonb default '{}'::jsonb
) returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.trade_events (trade_request_id, actor_type, actor_id, actor_label, event, from_status, to_status, detail)
  values (p_trade_id, p_actor_type, p_actor_id, p_actor_label, p_event, p_from, p_to, coalesce(p_detail, '{}'::jsonb));
$$;

-- Holds one inventory line for a trade, or changes how many. Raises GT004
-- when that many aren't free (on hand, less every other active hold).
-- Caller holds the trade row lock; this takes the inventory row lock.
create or replace function public.trade_hold_line(p_trade_id uuid, p_trade_number bigint, p_inventory_item_id uuid, p_quantity integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv public.inventory_items%rowtype;
  v_item public.trade_request_items%rowtype;
  v_others integer;
  v_price integer;
  v_res_id uuid;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'Choose 1 to 99 of a card.' using errcode = 'GT010';
  end if;

  select * into v_inv from public.inventory_items where id = p_inventory_item_id for update;
  if not found or v_inv.status <> 'active' then
    raise exception 'A card on this trade isn''t for sale any more.' using errcode = 'GT004';
  end if;
  v_price := public.trade_regular_price(v_inv.price_cents, v_inv.original_price_cents, v_inv.is_deal);
  if v_price is null or v_price <= 0 then
    raise exception '% isn''t for sale right now.', v_inv.card_name using errcode = 'GT004';
  end if;

  select * into v_item from public.trade_request_items
    where trade_request_id = p_trade_id and inventory_item_id = p_inventory_item_id;

  select coalesce(sum(r.quantity), 0)::int into v_others
  from public.inventory_reservations r
  where r.inventory_item_id = p_inventory_item_id and r.status = 'active'
    and r.trade_request_id is distinct from p_trade_id;

  if p_quantity > v_inv.quantity - v_others then
    if v_inv.quantity - v_others <= 0 then
      raise exception '% isn''t available right now.', v_inv.card_name using errcode = 'GT004';
    end if;
    raise exception 'Only % of % % available.', v_inv.quantity - v_others, v_inv.card_name,
      case when v_inv.quantity - v_others = 1 then 'is' else 'are' end
      using errcode = 'GT004';
  end if;

  if v_item.id is not null and v_item.status = 'reserved' then
    update public.inventory_reservations set quantity = p_quantity
      where id = v_item.reservation_id and status = 'active';
    if not found then
      raise exception 'The hold on % was released. Remove it and add it again.', v_inv.card_name using errcode = 'GT004';
    end if;
    update public.trade_request_items set quantity = p_quantity where id = v_item.id;
    -- The price stays the one the customer was first shown.
    return v_item.unit_price_cents * p_quantity;
  end if;

  insert into public.inventory_reservations (inventory_item_id, customer_id, quantity, note, reserved_by, trade_request_id)
  values (p_inventory_item_id, null, p_quantity, 'Trade TR-' || p_trade_number, 'trade', p_trade_id)
  returning id into v_res_id;

  if v_item.id is not null then
    update public.trade_request_items
      set reservation_id = v_res_id, quantity = p_quantity, status = 'reserved', unit_price_cents = v_price
      where id = v_item.id;
  else
    insert into public.trade_request_items (
      trade_request_id, inventory_item_id, reservation_id, quantity, unit_price_cents,
      card_name, set_code, set_name, collector_number, condition, finish, variant_type, image_url, scryfall_id
    ) values (
      p_trade_id, v_inv.id, v_res_id, p_quantity, v_price,
      v_inv.card_name, v_inv.set_code, v_inv.set_name, v_inv.collector_number, v_inv.condition, v_inv.finish,
      nullif(v_inv.variant_type, ''), v_inv.image_url, v_inv.scryfall_id
    );
  end if;
  return v_price * p_quantity;
end;
$$;

-- Lets go of one line's hold (idempotent).
create or replace function public.trade_release_line(p_item_id uuid, p_by text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item public.trade_request_items%rowtype;
begin
  select * into v_item from public.trade_request_items where id = p_item_id for update;
  if not found or v_item.status <> 'reserved' then return; end if;
  update public.inventory_reservations
    set status = 'released', released_at = now(), released_by = left(coalesce(p_by, 'trade'), 200)
    where id = v_item.reservation_id and status = 'active';
  update public.trade_request_items set status = 'released' where id = v_item.id;
end;
$$;

create or replace function public.trade_recount_wanted(p_trade_id uuid)
returns integer
language sql
security definer
set search_path to 'public'
as $$
  update public.trade_requests t
    set wanted_total_cents = coalesce((
      select sum(i.unit_price_cents * i.quantity) from public.trade_request_items i
      where i.trade_request_id = t.id and i.status in ('reserved', 'fulfilled')
    ), 0)
  where t.id = p_trade_id
  returning wanted_total_cents;
$$;

-- 9. Starting a trade: hold the cards they picked -----------------------------
-- p_items: [{ "inventory_item_id": uuid, "quantity": n }, …]
create or replace function public.trade_start(
  p_user_id uuid, p_items jsonb, p_customer_name text, p_customer_email text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_lines integer;
  v_active integer;
  v_expired integer;
  v_total integer;
  r record;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  if not found or not s.enabled then
    raise exception 'Trading isn''t open right now.' using errcode = 'GT001';
  end if;
  if s.paused then
    raise exception '%', s.pause_message using errcode = 'GT001';
  end if;
  if p_user_id is null then
    raise exception 'Sign in to start a trade.' using errcode = '42501';
  end if;

  -- One customer's trades start one at a time (no racing past the limits).
  perform pg_advisory_xact_lock(hashtextextended('trade_start:' || p_user_id::text, 0));

  select count(*) into v_active from public.trade_requests
    where user_id = p_user_id and status not in ('completed', 'rejected', 'canceled', 'expired', 'returned');
  if v_active >= s.max_active_trades then
    raise exception 'You already have % open trade%. Finish or cancel one before starting another.',
      v_active, case when v_active = 1 then '' else 's' end using errcode = 'GT002';
  end if;
  select count(*) into v_expired from public.trade_requests
    where user_id = p_user_id and status = 'expired' and closed_at > now() - interval '30 days';
  if v_expired >= s.max_expired_trades_30d then
    raise exception 'Several of your recent trades expired before they were finished, so new trades are paused on your account for now. Contact us and we''ll sort it out.'
      using errcode = 'GT003';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add the cards you want first.' using errcode = 'GT010';
  end if;
  select count(distinct e->>'inventory_item_id') into v_lines from jsonb_array_elements(p_items) e;
  if v_lines > s.max_wanted_lines then
    raise exception 'A trade can have up to % different cards.', s.max_wanted_lines using errcode = 'GT010';
  end if;

  insert into public.trade_requests (
    user_id, customer_name, customer_email, status,
    credit_rate_percent, min_card_value_cents, condition_percents, processing_fee_cents,
    hold_expires_at
  ) values (
    p_user_id, left(nullif(btrim(p_customer_name), ''), 120), left(nullif(btrim(p_customer_email), ''), 254), 'awaiting_trade_list',
    s.credit_rate_percent, s.min_card_value_cents,
    jsonb_build_object('NM', s.condition_nm_percent, 'LP', s.condition_lp_percent, 'MP', s.condition_mp_percent,
                       'HP', s.condition_hp_percent, 'DMG', s.condition_dmg_percent),
    s.processing_fee_cents,
    now() + make_interval(hours => s.reservation_hours)
  ) returning * into v_trade;

  -- Inventory rows are locked in id order, like checkout, so trades and
  -- checkouts can't deadlock; repeated ids are added together.
  for r in
    select (e->>'inventory_item_id')::uuid as inv_id, sum((e->>'quantity')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1
  loop
    perform public.trade_hold_line(v_trade.id, v_trade.trade_number, r.inv_id, r.qty);
  end loop;

  v_total := public.trade_recount_wanted(v_trade.id);
  if v_total < s.min_trade_value_cents then
    raise exception 'Trades start at % of our cards.', to_char(s.min_trade_value_cents / 100.0, 'FM$999,999,990.00') using errcode = 'GT005';
  end if;
  if s.max_trade_value_cents is not null and v_total > s.max_trade_value_cents then
    raise exception 'A trade can include up to % of our cards.', to_char(s.max_trade_value_cents / 100.0, 'FM$999,999,990.00') using errcode = 'GT006';
  end if;

  perform public.trade_log(v_trade.id, 'customer', p_user_id, left(coalesce(p_customer_email, ''), 200), 'started', null, 'awaiting_trade_list',
    jsonb_build_object('wanted_total_cents', v_total, 'hold_expires_at', v_trade.hold_expires_at));
  return v_trade.id;
end;
$$;

-- 10. Changing which of our cards are on the trade --------------------------------
-- Replaces the list with p_items (same shape as trade_start). p_statuses:
-- the statuses the caller may do this in (the API passes the customer's or
-- staff's). Prices of cards already on the trade don't change.
create or replace function public.trade_set_wanted(
  p_trade_id uuid, p_items jsonb, p_statuses text[], p_actor_type text, p_actor_id uuid, p_actor_label text
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_lines integer;
  v_total integer;
  r record;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if not (v_trade.status = any (p_statuses)) then
    raise exception 'The cards on this trade can''t be changed now.' using errcode = 'GT009';
  end if;
  -- Ran out, and the worker just hasn't got to it yet.
  if v_trade.hold_expires_at is not null and v_trade.hold_expires_at < now() then
    raise exception 'The hold on this trade ran out.' using errcode = 'GT012';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Your cards didn''t come through. Try again.' using errcode = 'GT010';
  end if;
  select count(distinct e->>'inventory_item_id') into v_lines from jsonb_array_elements(p_items) e;
  if v_lines = 0 then
    raise exception 'A trade needs at least one of our cards. Cancel the trade instead.' using errcode = 'GT010';
  end if;
  if v_lines > s.max_wanted_lines then
    raise exception 'A trade can have up to % different cards.', s.max_wanted_lines using errcode = 'GT010';
  end if;

  -- Lines no longer wanted.
  for r in
    select i.id from public.trade_request_items i
    where i.trade_request_id = p_trade_id and i.status = 'reserved'
      and i.inventory_item_id not in (select (e->>'inventory_item_id')::uuid from jsonb_array_elements(p_items) e)
  loop
    perform public.trade_release_line(r.id, coalesce(p_actor_label, p_actor_type));
  end loop;

  -- Lines kept, changed or added, in inventory id order.
  for r in
    select (e->>'inventory_item_id')::uuid as inv_id, sum((e->>'quantity')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1
  loop
    perform public.trade_hold_line(v_trade.id, v_trade.trade_number, r.inv_id, r.qty);
  end loop;

  v_total := public.trade_recount_wanted(p_trade_id);
  if s.max_trade_value_cents is not null and v_total > s.max_trade_value_cents then
    raise exception 'A trade can include up to % of our cards.', to_char(s.max_trade_value_cents / 100.0, 'FM$999,999,990.00') using errcode = 'GT006';
  end if;
  perform public.trade_log(p_trade_id, p_actor_type, p_actor_id, p_actor_label, 'wanted_changed', v_trade.status, v_trade.status,
    jsonb_build_object('wanted_total_cents', v_total));
  return v_total;
end;
$$;

-- 11. Closing a trade before it's finished ----------------------------------------
-- Releases every hold and moves the trade to p_status: rejected, canceled or
-- expired (closed), or return_pending (their cards are with us and go back).
-- Returns false, changing nothing, when the trade is already past that point.
create or replace function public.trade_close(
  p_trade_id uuid, p_status text, p_from_statuses text[], p_reason text,
  p_actor_type text, p_actor_id uuid, p_actor_label text
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
  r record;
begin
  perform public.trade_require_service_role();
  if p_status not in ('rejected', 'canceled', 'expired', 'return_pending') then
    raise exception 'Not a closing status: %', p_status using errcode = '22023';
  end if;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if not (v_trade.status = any (p_from_statuses)) then
    return false;
  end if;

  for r in select id from public.trade_request_items where trade_request_id = p_trade_id and status = 'reserved' loop
    perform public.trade_release_line(r.id, coalesce(p_actor_label, p_actor_type));
  end loop;

  update public.trade_requests set
    status = p_status,
    hold_expires_at = null,
    close_reason = left(nullif(btrim(p_reason), ''), 2000),
    closed_at = case when p_status = 'return_pending' then null else now() end
  where id = p_trade_id;

  perform public.trade_log(p_trade_id, p_actor_type, p_actor_id, p_actor_label, p_status, v_trade.status, p_status,
    jsonb_build_object('reason', p_reason));
  return true;
end;
$$;

-- 12. Expiring holds that ran out (the expire-holds worker, every 5 minutes) --
-- Only trades nothing has been shipped for: a list never sent, a revision
-- never made, or no tracking number by the ship-by date plus grace.
-- Idempotent; rows another run is working on are skipped.
create or replace function public.trade_expire_due(p_limit integer default 50)
returns table (expired_trade_id uuid, expired_trade_number bigint, expired_from_status text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  perform public.trade_require_service_role();
  for r in
    select t.id, t.trade_number, t.status from public.trade_requests t
    where t.status in ('awaiting_trade_list', 'revision_requested', 'awaiting_shipment')
      and t.hold_expires_at is not null and t.hold_expires_at < now()
      and (t.status <> 'awaiting_shipment' or t.inbound_tracking is null)
    order by t.hold_expires_at
    limit greatest(coalesce(p_limit, 50), 1)
    for update skip locked
  loop
    if public.trade_close(r.id, 'expired', array['awaiting_trade_list', 'revision_requested', 'awaiting_shipment'],
         case r.status
           when 'awaiting_trade_list' then 'The card list wasn''t sent in time.'
           when 'revision_requested' then 'The changes weren''t sent in time.'
           else 'No tracking number arrived by the shipping deadline.'
         end, 'system', null, 'expiry') then
      expired_trade_id := r.id; expired_trade_number := r.trade_number; expired_from_status := r.status;
      return next;
    end if;
  end loop;
end;
$$;

-- 13. Finishing a trade -----------------------------------------------------------
-- Issues the trade credit as store credit (once), creates the paid order for
-- our cards at their trade prices, spends the credit on it, records any card
-- payment for the rest, and hands the held cards over to that order. Safe to
-- call again: an already-finished trade just returns its order.
-- Shipping mirrors checkout: tracked, free from $75 of cards.
create or replace function public.trade_finalize_core(p_trade_id uuid, p_paid_cents integer, p_payment_reference text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
  v_order_id uuid;
  v_email text;
  v_total integer;
  v_credit integer;
  v_issue integer;
  v_spend integer;
  v_due integer;
  ri record;
begin
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.order_id is not null then
    return v_trade.order_id;
  end if;
  if v_trade.status not in ('awaiting_final_approval', 'awaiting_payment') then
    raise exception 'This trade can''t be finished from %.', v_trade.status using errcode = 'GT009';
  end if;
  if v_trade.final_credit_cents is null or v_trade.shipping_cents is null or v_trade.ship_line1 is null then
    raise exception 'This trade''s final offer isn''t complete.' using errcode = 'GT009';
  end if;
  -- Online orders need an email (orders.chk_online_requires_identity).
  v_email := coalesce(nullif(btrim(v_trade.customer_email), ''),
                      (select u.email::text from auth.users u where u.id = v_trade.user_id));
  if v_email is null then
    raise exception 'This trade has no email address to put on its order.' using errcode = 'GT009';
  end if;

  v_total := public.trade_recount_wanted(p_trade_id) + v_trade.shipping_cents;
  v_credit := v_trade.final_credit_cents;
  v_spend := least(v_credit, v_total);
  -- Cash for the excess (when staff offered it) is paid by hand, so only the
  -- credit the order uses is issued; otherwise all of it, the rest kept.
  v_issue := case when v_trade.excess_handling = 'cash' then v_spend else v_credit end;
  v_due := v_total - v_spend;
  if coalesce(p_paid_cents, 0) < v_due then
    raise exception 'The trade still needs % paid.', to_char(v_due / 100.0, 'FM$999,999,990.00') using errcode = 'GT008';
  end if;

  insert into public.orders (
    user_id, email, channel, shipping_method,
    subtotal_cents, shipping_cents, discount_cents, tax_cents,
    store_credit_used_cents, total_cents, amount_due_cents,
    ship_recipient, ship_line1, ship_line2, ship_city, ship_state, ship_postal_code, ship_country,
    payment_provider, payment_reference, payment_status, status, paid_at,
    trade_request_id, internal_notes
  ) values (
    v_trade.user_id, v_email, 'online', 'tracked',
    v_total - v_trade.shipping_cents, v_trade.shipping_cents, 0, 0,
    v_spend, v_total, v_due,
    v_trade.ship_name, v_trade.ship_line1, v_trade.ship_line2, v_trade.ship_city, v_trade.ship_state, v_trade.ship_postal_code, 'US',
    (case when v_due = 0 then 'store_credit' else 'stripe' end)::public.payment_provider,
    case when v_due = 0 then null else p_payment_reference end,
    'paid', 'paid', now(),
    p_trade_id, 'Trade TR-' || v_trade.trade_number
  ) returning id into v_order_id;

  for ri in
    select i.* from public.trade_request_items i
    where i.trade_request_id = p_trade_id and i.status = 'reserved'
    order by i.inventory_item_id
  loop
    declare
      v_inv public.inventory_items%rowtype;
    begin
      select * into v_inv from public.inventory_items where id = ri.inventory_item_id for update;
      if not found or v_inv.quantity < ri.quantity then
        raise exception 'We don''t have % of % on hand any more. Staff will be in touch.', ri.quantity, ri.card_name using errcode = 'GT004';
      end if;
      if not exists (select 1 from public.inventory_reservations where id = ri.reservation_id and status = 'active') then
        raise exception 'The hold on % was released. Staff will be in touch.', ri.card_name using errcode = 'GT004';
      end if;
      insert into public.order_items (
        order_id, inventory_item_id, scryfall_id, set_code, collector_number,
        card_name, set_name, condition, finish, variant_type, image_url,
        quantity, unit_price_cents, line_total_cents
      ) values (
        v_order_id, ri.inventory_item_id, ri.scryfall_id, ri.set_code, ri.collector_number,
        ri.card_name, ri.set_name, ri.condition, ri.finish, coalesce(ri.variant_type, ''), ri.image_url,
        ri.quantity, ri.unit_price_cents, ri.unit_price_cents * ri.quantity
      );
      update public.inventory_items set quantity = quantity - ri.quantity where id = ri.inventory_item_id;
      update public.inventory_reservations
        set status = 'fulfilled', released_at = now(), released_by = 'trade'
        where id = ri.reservation_id;
      update public.trade_request_items set status = 'fulfilled' where id = ri.id;
    end;
  end loop;

  if v_issue > 0 then
    insert into public.store_credit_transactions (user_id, amount_cents, type, reason, reference_type, reference_id)
    values (v_trade.user_id, v_issue, 'trade_in_payout', 'Trade TR-' || v_trade.trade_number, 'trade_request', p_trade_id);
  end if;
  if v_spend > 0 then
    insert into public.store_credit_transactions (user_id, amount_cents, type, reason, reference_type, reference_id)
    values (v_trade.user_id, -v_spend, 'order_spend', 'Trade TR-' || v_trade.trade_number, 'order', v_order_id);
  end if;

  update public.trade_offer_cards set disposition = 'accepted'
    where trade_request_id = p_trade_id and coalesce(final_quantity, 0) > 0 and disposition = 'pending';
  update public.trade_offer_cards set disposition = 'rejected'
    where trade_request_id = p_trade_id and coalesce(final_quantity, 0) = 0 and disposition = 'pending';

  update public.trade_requests set
    status = 'approved_for_fulfillment',
    order_id = v_order_id,
    amount_due_cents = v_due,
    excess_cents = greatest(v_credit - v_total, 0),
    credit_issued_cents = v_issue,
    payment_reference = case when v_due = 0 then payment_reference else p_payment_reference end,
    paid_at = now(),
    payment_due_at = null,
    hold_expires_at = null
  where id = p_trade_id;

  perform public.trade_log(p_trade_id, 'system', null, null, 'finalized', v_trade.status, 'approved_for_fulfillment',
    jsonb_build_object('order_id', v_order_id, 'credit_issued_cents', v_issue, 'credit_used_cents', v_spend,
                       'paid_cents', v_due, 'excess_cents', greatest(v_credit - v_total, 0)));
  return v_order_id;
end;
$$;

-- The customer accepts the final offer, with where to ship our cards. With
-- nothing left to pay the trade is finished at once; otherwise it waits for
-- their card payment (trade_record_payment).
create or replace function public.trade_accept_final(
  p_trade_id uuid, p_user_id uuid,
  p_ship_name text, p_ship_line1 text, p_ship_line2 text, p_ship_city text, p_ship_state text, p_ship_postal_code text
) returns table (new_status text, due_cents integer, new_order_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_state text;
  v_zip text;
  v_wanted integer;
  v_shipping integer;
  v_due integer;
  v_order uuid;
  c_tracked_cents constant integer := 550;           -- as checkout_place_order_core
  c_free_shipping_threshold constant integer := 7500;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found or v_trade.user_id is distinct from p_user_id then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.status <> 'awaiting_final_approval' then
    raise exception 'This offer can''t be accepted now.' using errcode = 'GT009';
  end if;
  if v_trade.final_credit_cents is null then
    raise exception 'The final offer isn''t ready yet.' using errcode = 'GT009';
  end if;
  if nullif(btrim(p_ship_line1), '') is null or nullif(btrim(p_ship_city), '') is null
     or nullif(btrim(p_ship_state), '') is null or nullif(btrim(p_ship_postal_code), '') is null then
    raise exception 'Add the address to ship your new cards to.' using errcode = 'GT010';
  end if;
  -- US addresses only, written the way orders store them (as checkout does).
  v_state := public.us_state_code(p_ship_state);
  v_zip := public.us_zip(p_ship_postal_code);
  if v_state is null then
    raise exception 'We ship within the US: enter a US state.' using errcode = 'GT010';
  end if;
  if v_zip is null then
    raise exception 'Enter a 5-digit ZIP code.' using errcode = 'GT010';
  end if;

  v_wanted := public.trade_recount_wanted(p_trade_id);
  v_shipping := case when v_wanted >= c_free_shipping_threshold then 0 else c_tracked_cents end;
  v_due := greatest(v_wanted + v_shipping - v_trade.final_credit_cents, 0);

  update public.trade_requests set
    ship_name = left(nullif(btrim(p_ship_name), ''), 120),
    ship_line1 = left(btrim(p_ship_line1), 200),
    ship_line2 = left(nullif(btrim(p_ship_line2), ''), 200),
    ship_city = left(btrim(p_ship_city), 100),
    ship_state = v_state,
    ship_postal_code = v_zip,
    shipping_cents = v_shipping,
    amount_due_cents = v_due,
    excess_cents = greatest(v_trade.final_credit_cents - (v_wanted + v_shipping), 0),
    accepted_at = now()
  where id = p_trade_id;

  perform public.trade_log(p_trade_id, 'customer', p_user_id, v_trade.customer_email, 'final_accepted', v_trade.status,
    case when v_due = 0 then 'approved_for_fulfillment' else 'awaiting_payment' end,
    jsonb_build_object('shipping_cents', v_shipping, 'amount_due_cents', v_due));

  if v_due = 0 then
    v_order := public.trade_finalize_core(p_trade_id, 0, null);
    return query select 'approved_for_fulfillment'::text, 0, v_order;
  else
    update public.trade_requests set
      status = 'awaiting_payment',
      payment_due_at = now() + make_interval(days => s.payment_due_days)
    where id = p_trade_id;
    return query select 'awaiting_payment'::text, v_due, null::uuid;
  end if;
end;
$$;

-- A card payment for the rest of a trade succeeded (the trade page or the
-- Stripe webhook, whichever is first): finish the trade. Idempotent.
create or replace function public.trade_record_payment(p_trade_id uuid, p_paid_cents integer, p_reference text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
begin
  perform public.trade_require_service_role();
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.order_id is not null then
    return v_trade.order_id;
  end if;
  if v_trade.status <> 'awaiting_payment' then
    raise exception 'This trade isn''t waiting for a payment.' using errcode = 'GT009';
  end if;
  return public.trade_finalize_core(p_trade_id, p_paid_cents, p_reference);
end;
$$;

-- 14. Adding accepted trade-ins to inventory (staff, after the trade is done) --
-- Goes through admin_upsert_inventory, so a copy we already stock is added
-- to that line rather than duplicated. Once per card.
create or replace function public.trade_import_card(
  p_offer_card_id uuid, p_price_cents integer, p_storage_location text, p_actor text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_card public.trade_offer_cards%rowtype;
  v_trade public.trade_requests%rowtype;
  v_inv public.inventory_items%rowtype;
  v_condition public.card_condition;
  v_unit_cost integer;
begin
  perform public.trade_require_service_role();
  select * into v_card from public.trade_offer_cards where id = p_offer_card_id for update;
  if not found then
    raise exception 'That card isn''t on a trade.' using errcode = 'GT404';
  end if;
  if v_card.disposition = 'imported' then
    return v_card.imported_inventory_item_id;
  end if;
  select * into v_trade from public.trade_requests where id = v_card.trade_request_id;
  if v_trade.status not in ('approved_for_fulfillment', 'completed') then
    raise exception 'Add trade-ins to inventory once the trade is finished.' using errcode = 'GT009';
  end if;
  if v_card.disposition <> 'accepted' or coalesce(v_card.final_quantity, 0) < 1 then
    raise exception 'Only accepted cards go into inventory.' using errcode = 'GT009';
  end if;
  if p_price_cents is null or p_price_cents < 1 then
    raise exception 'Set a selling price.' using errcode = 'GT010';
  end if;

  v_condition := coalesce(v_card.verified_condition, v_card.reported_condition);
  -- What the card cost us: its share of the trade credit.
  v_unit_cost := round(coalesce(v_card.final_unit_cents, 0) * v_trade.credit_rate_percent / 100.0)::int;

  v_inv := public.admin_upsert_inventory(
    v_card.scryfall_id, null, v_card.card_name, coalesce(v_card.set_code, ''), v_card.set_name,
    coalesce(v_card.collector_number, ''), null, null, v_card.image_url, v_condition, v_card.finish,
    v_card.final_quantity, p_price_cents, v_unit_cost, v_card.reference_price_cents,
    left(nullif(btrim(p_storage_location), ''), 120), null, 'Trade-in TR-' || v_trade.trade_number,
    '', 'en', '{}', '{}', left(coalesce(p_actor, 'trade'), 200), 'trade_in'
  );

  update public.trade_offer_cards set disposition = 'imported', imported_inventory_item_id = v_inv.id
    where id = p_offer_card_id;
  perform public.trade_log(v_trade.id, 'staff', null, p_actor, 'card_imported', v_trade.status, v_trade.status,
    jsonb_build_object('offer_card_id', p_offer_card_id, 'inventory_item_id', v_inv.id, 'quantity', v_card.final_quantity));
  return v_inv.id;
end;
$$;

-- 15. Their cards: the customer's list, staff review, approval, inspection --------
-- and the final offer. Each runs in one transaction under the trade's row
-- lock, so totals are always worked out from the cards as they stand.

-- The customer's list, saved whole. The server prices it just before
-- (api/_lib/tradeCenter.ts reads each printing from Scryfall or the
-- card_printings cache and works out the estimate and eligibility).
-- p_cards: [{ "id"?: a card already on the list, "scryfall_id", "card_name",
--   "set_code", "set_name", "collector_number", "finish", "image_url",
--   "quantity", "reported_condition", "customer_estimate_cents",
--   "customer_note", "reference_price_cents", "reference_checked_at",
--   "condition_percent", "estimated_unit_cents", "eligibility",
--   "stock_on_hand" }, …]
-- A card left as it was keeps staff's review; a changed one is reviewed again.
create or replace function public.trade_save_offer(p_trade_id uuid, p_user_id uuid, p_cards jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_old public.trade_offer_cards%rowtype;
  v_keep uuid[] := '{}';
  v_id uuid;
  v_pos integer := 0;
  v_same boolean;
  v_total bigint;
  e jsonb;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found or v_trade.user_id is distinct from p_user_id then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.status not in ('awaiting_trade_list', 'revision_requested') then
    raise exception 'Your cards can''t be changed now.' using errcode = 'GT009';
  end if;
  if v_trade.hold_expires_at is not null and v_trade.hold_expires_at < now() then
    raise exception 'The hold on this trade ran out.' using errcode = 'GT012';
  end if;
  if p_cards is null or jsonb_typeof(p_cards) <> 'array' then
    raise exception 'Your cards didn''t come through. Try again.' using errcode = 'GT010';
  end if;
  if jsonb_array_length(p_cards) > s.max_offered_lines then
    raise exception 'A trade can list up to % of your cards.', s.max_offered_lines using errcode = 'GT010';
  end if;

  for e in select value from jsonb_array_elements(p_cards) loop
    v_pos := v_pos + 1;
    v_old := null;
    if nullif(e->>'id', '') is not null then
      select * into v_old from public.trade_offer_cards
        where id = (e->>'id')::uuid and trade_request_id = p_trade_id;
    end if;
    if v_old.id is not null then
      v_same := v_old.scryfall_id is not distinct from (e->>'scryfall_id')::uuid
        and v_old.finish = (e->>'finish')::public.card_finish
        and v_old.reported_condition = (e->>'reported_condition')::public.card_condition
        and v_old.quantity = (e->>'quantity')::int;
      update public.trade_offer_cards set
        position = v_pos,
        scryfall_id = (e->>'scryfall_id')::uuid,
        card_name = e->>'card_name',
        set_code = nullif(e->>'set_code', ''),
        set_name = nullif(e->>'set_name', ''),
        collector_number = nullif(e->>'collector_number', ''),
        finish = (e->>'finish')::public.card_finish,
        image_url = nullif(e->>'image_url', ''),
        quantity = (e->>'quantity')::int,
        reported_condition = (e->>'reported_condition')::public.card_condition,
        customer_estimate_cents = (e->>'customer_estimate_cents')::int,
        customer_note = nullif(btrim(e->>'customer_note'), ''),
        reference_price_cents = (e->>'reference_price_cents')::int,
        reference_checked_at = (e->>'reference_checked_at')::timestamptz,
        condition_percent = (e->>'condition_percent')::int,
        estimated_unit_cents = (e->>'estimated_unit_cents')::int,
        eligibility = e->>'eligibility',
        stock_on_hand = (e->>'stock_on_hand')::int,
        review_status = case when v_same then review_status else 'pending' end,
        approved_quantity = case when v_same then approved_quantity else null end,
        approved_unit_cents = case when v_same then approved_unit_cents else null end,
        review_note = case when v_same then review_note else null end
      where id = v_old.id;
      v_keep := v_keep || v_old.id;
    else
      insert into public.trade_offer_cards (
        trade_request_id, position, scryfall_id, card_name, set_code, set_name, collector_number,
        finish, image_url, quantity, reported_condition, customer_estimate_cents, customer_note,
        reference_price_cents, reference_checked_at, condition_percent, estimated_unit_cents,
        eligibility, stock_on_hand
      ) values (
        p_trade_id, v_pos, (e->>'scryfall_id')::uuid, e->>'card_name', nullif(e->>'set_code', ''),
        nullif(e->>'set_name', ''), nullif(e->>'collector_number', ''),
        (e->>'finish')::public.card_finish, nullif(e->>'image_url', ''), (e->>'quantity')::int,
        (e->>'reported_condition')::public.card_condition, (e->>'customer_estimate_cents')::int,
        nullif(btrim(e->>'customer_note'), ''),
        (e->>'reference_price_cents')::int, (e->>'reference_checked_at')::timestamptz,
        (e->>'condition_percent')::int, (e->>'estimated_unit_cents')::int,
        e->>'eligibility', (e->>'stock_on_hand')::int
      ) returning id into v_id;
      v_keep := v_keep || v_id;
    end if;
  end loop;

  delete from public.trade_offer_cards where trade_request_id = p_trade_id and not (id = any (v_keep));

  -- Cards still to be valued by hand count for nothing until staff do.
  select coalesce(sum(estimated_unit_cents::bigint * quantity), 0) into v_total
    from public.trade_offer_cards where trade_request_id = p_trade_id and eligibility = 'eligible';
  if v_total > 100000000 then
    raise exception 'That''s more than we can take in one trade. Split it into smaller trades.' using errcode = 'GT006';
  end if;
  update public.trade_requests set estimated_value_cents = v_total::int where id = p_trade_id;
  return v_total::int;
end;
$$;

-- The customer sends their list for review. Their cards must all be ones we
-- can take (the rest come off first); our cards stay held until staff decide.
create or replace function public.trade_submit(p_trade_id uuid, p_user_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
  v_cards integer;
  v_blocked integer;
  v_wanted integer;
begin
  perform public.trade_require_service_role();
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found or v_trade.user_id is distinct from p_user_id then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.status not in ('awaiting_trade_list', 'revision_requested') then
    raise exception 'This trade has already been sent.' using errcode = 'GT009';
  end if;
  if v_trade.hold_expires_at is not null and v_trade.hold_expires_at < now() then
    raise exception 'The hold on this trade ran out.' using errcode = 'GT012';
  end if;
  select count(*)::int,
         (count(*) filter (where eligibility in ('below_minimum', 'excluded_set', 'excluded_card', 'overstocked')))::int
    into v_cards, v_blocked
    from public.trade_offer_cards where trade_request_id = p_trade_id;
  if v_cards = 0 then
    raise exception 'Add the cards you''re trading in first.' using errcode = 'GT010';
  end if;
  if v_blocked > 0 then
    raise exception 'Take off the cards we can''t accept first (they''re marked on your list).' using errcode = 'GT010';
  end if;
  select count(*)::int into v_wanted from public.trade_request_items
    where trade_request_id = p_trade_id and status = 'reserved';
  if v_wanted = 0 then
    raise exception 'Add at least one of our cards first.' using errcode = 'GT010';
  end if;

  update public.trade_requests set
    status = 'pending_review',
    submitted_at = now(),
    hold_expires_at = null,
    customer_note = coalesce(left(nullif(btrim(p_note), ''), 2000), customer_note)
  where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'customer', p_user_id, v_trade.customer_email,
    case when v_trade.status = 'revision_requested' then 'resubmitted' else 'submitted' end,
    v_trade.status, 'pending_review',
    jsonb_build_object('cards', v_cards, 'estimated_value_cents', v_trade.estimated_value_cents));
end;
$$;

-- Staff review of the list, card by card: approve (how many, at what value
-- each) or reject, with a note for the customer and one for staff only.
-- p_cards: [{ "id", "review_status": "pending" | "approved" | "rejected",
--   "approved_quantity", "approved_unit_cents", "review_note"?, "internal_note"? }]
create or replace function public.trade_review_cards(p_trade_id uuid, p_cards jsonb, p_actor_id uuid, p_actor_label text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
  v_card public.trade_offer_cards%rowtype;
  v_status text;
  v_qty integer;
  v_unit integer;
  v_n integer := 0;
  e jsonb;
begin
  perform public.trade_require_service_role();
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.status <> 'pending_review' then
    raise exception 'Cards are reviewed while the trade is pending review.' using errcode = 'GT009';
  end if;
  if p_cards is null or jsonb_typeof(p_cards) <> 'array' then
    raise exception 'The review didn''t come through. Try again.' using errcode = 'GT010';
  end if;

  for e in select value from jsonb_array_elements(p_cards) loop
    select * into v_card from public.trade_offer_cards
      where id = (e->>'id')::uuid and trade_request_id = p_trade_id for update;
    if not found then
      raise exception 'A card isn''t on this trade.' using errcode = 'GT404';
    end if;
    v_status := coalesce(nullif(e->>'review_status', ''), 'pending');
    if v_status not in ('pending', 'approved', 'rejected') then
      raise exception 'Unknown review: %', v_status using errcode = 'GT010';
    end if;
    v_qty := (e->>'approved_quantity')::int;
    v_unit := (e->>'approved_unit_cents')::int;
    if v_status = 'approved' then
      if v_qty is null or v_qty < 1 or v_qty > v_card.quantity then
        raise exception '%: approve 1 to % (as many as they listed).', v_card.card_name, v_card.quantity using errcode = 'GT010';
      end if;
      if v_unit is null or v_unit < 0 or v_unit > 10000000 then
        raise exception '%: set a value for each copy.', v_card.card_name using errcode = 'GT010';
      end if;
    end if;
    update public.trade_offer_cards set
      review_status = v_status,
      approved_quantity = case v_status when 'approved' then v_qty when 'rejected' then 0 else null end,
      approved_unit_cents = case when v_status = 'approved' then v_unit else null end,
      review_note = case when e ? 'review_note' then left(nullif(btrim(e->>'review_note'), ''), 1000) else review_note end,
      internal_note = case when e ? 'internal_note' then left(nullif(btrim(e->>'internal_note'), ''), 2000) else internal_note end
    where id = v_card.id;
    v_n := v_n + 1;
  end loop;

  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'cards_reviewed', v_trade.status, v_trade.status,
    jsonb_build_object('cards', v_n));
end;
$$;

-- Staff send the list back with what to change. Our cards stay held for
-- revision_hours while the customer makes the changes.
create or replace function public.trade_request_revision(p_trade_id uuid, p_message text, p_actor_id uuid, p_actor_label text)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_due timestamptz;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.status <> 'pending_review' then
    raise exception 'Changes can be asked for while the trade is pending review.' using errcode = 'GT009';
  end if;
  if nullif(btrim(p_message), '') is null then
    raise exception 'Tell the customer what to change.' using errcode = 'GT010';
  end if;
  v_due := now() + make_interval(hours => s.revision_hours);
  update public.trade_requests set status = 'revision_requested', hold_expires_at = v_due where id = p_trade_id;
  insert into public.trade_messages (trade_request_id, author_type, author_id, author_label, body, visible_to_customer)
  values (p_trade_id, 'staff', p_actor_id, left(p_actor_label, 200), left(btrim(p_message), 4000), true);
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'revision_requested', v_trade.status, 'revision_requested',
    jsonb_build_object('hold_expires_at', v_due));
  return v_due;
end;
$$;

-- Preliminary approval: every card decided, at least one approved, and the
-- address customers mail their cards to set (never assumed). The customer
-- then has until p_ship_by (worked out in business days by the API) plus
-- ship_grace_hours to send a tracking number.
create or replace function public.trade_approve(
  p_trade_id uuid, p_ship_by timestamptz, p_conditions text, p_actor_id uuid, p_actor_label text
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_value bigint;
  v_approved integer;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.status <> 'pending_review' then
    raise exception 'Only a trade pending review can be approved.' using errcode = 'GT009';
  end if;
  if nullif(btrim(s.ship_to_line1), '') is null or nullif(btrim(s.ship_to_city), '') is null
     or nullif(btrim(s.ship_to_state), '') is null or nullif(btrim(s.ship_to_postal_code), '') is null then
    raise exception 'Add the address customers mail their cards to (Trades, Settings) before approving a trade.' using errcode = 'GT011';
  end if;
  if p_ship_by is null or p_ship_by <= now() then
    raise exception 'The ship-by date has to be in the future.' using errcode = 'GT010';
  end if;
  if exists (select 1 from public.trade_offer_cards where trade_request_id = p_trade_id and review_status = 'pending') then
    raise exception 'Approve or reject every card first.' using errcode = 'GT010';
  end if;
  select coalesce(sum(approved_quantity::bigint * approved_unit_cents), 0), count(*)::int
    into v_value, v_approved
    from public.trade_offer_cards where trade_request_id = p_trade_id and review_status = 'approved';
  if v_approved = 0 then
    raise exception 'Approve at least one card, or reject the trade.' using errcode = 'GT010';
  end if;
  if v_value > 100000000 then
    raise exception 'That''s more than we can take in one trade.' using errcode = 'GT006';
  end if;
  if not exists (select 1 from public.trade_request_items where trade_request_id = p_trade_id and status = 'reserved') then
    raise exception 'None of our cards are on this trade any more.' using errcode = 'GT010';
  end if;

  update public.trade_requests set
    status = 'awaiting_shipment',
    approved_value_cents = v_value::int,
    approved_at = now(),
    ship_by = p_ship_by,
    hold_expires_at = p_ship_by + make_interval(hours => s.ship_grace_hours),
    approval_conditions = left(nullif(btrim(p_conditions), ''), 2000)
  where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'approved', v_trade.status, 'awaiting_shipment',
    jsonb_build_object('approved_value_cents', v_value, 'ship_by', p_ship_by, 'conditions', nullif(btrim(p_conditions), '')));
  return v_value::int;
end;
$$;

-- Inspection of what arrived: how many, real or not, the condition we see,
-- and what each is worth now. Can be saved as often as needed.
-- p_cards: [{ "id", "received_quantity", "authenticity", "verified_condition",
--   "final_quantity", "final_unit_cents", "flags": [...], "inspection_note"?,
--   "inspection_internal_note"? }]
create or replace function public.trade_inspect_cards(p_trade_id uuid, p_cards jsonb, p_actor_id uuid, p_actor_label text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
  v_card public.trade_offer_cards%rowtype;
  v_received integer;
  v_final integer;
  v_unit integer;
  v_auth text;
  v_n integer := 0;
  e jsonb;
begin
  perform public.trade_require_service_role();
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.status not in ('received', 'under_inspection') then
    raise exception 'Inspect cards once their package is marked received.' using errcode = 'GT009';
  end if;
  if p_cards is null or jsonb_typeof(p_cards) <> 'array' then
    raise exception 'The inspection didn''t come through. Try again.' using errcode = 'GT010';
  end if;

  for e in select value from jsonb_array_elements(p_cards) loop
    select * into v_card from public.trade_offer_cards
      where id = (e->>'id')::uuid and trade_request_id = p_trade_id for update;
    if not found then
      raise exception 'A card isn''t on this trade.' using errcode = 'GT404';
    end if;
    v_received := (e->>'received_quantity')::int;
    v_final := (e->>'final_quantity')::int;
    v_unit := (e->>'final_unit_cents')::int;
    v_auth := coalesce(nullif(e->>'authenticity', ''), 'unchecked');
    if v_received is null or v_received < 0 or v_received > 99 then
      raise exception '%: how many arrived?', v_card.card_name using errcode = 'GT010';
    end if;
    if v_final is null or v_final < 0 or v_final > v_received then
      raise exception '%: accept 0 to % (as many as arrived).', v_card.card_name, v_received using errcode = 'GT010';
    end if;
    if v_final > 0 and (v_unit is null or v_unit < 0 or v_unit > 10000000) then
      raise exception '%: set a value for each copy you''re accepting.', v_card.card_name using errcode = 'GT010';
    end if;
    if v_auth not in ('unchecked', 'authentic', 'counterfeit', 'unsure') then
      raise exception 'Unknown authenticity: %', v_auth using errcode = 'GT010';
    end if;
    if v_auth = 'counterfeit' and v_final > 0 then
      raise exception '%: a counterfeit card can''t be accepted.', v_card.card_name using errcode = 'GT010';
    end if;
    update public.trade_offer_cards set
      received_quantity = v_received,
      authenticity = v_auth,
      verified_condition = nullif(e->>'verified_condition', '')::public.card_condition,
      final_quantity = v_final,
      final_unit_cents = case when v_final > 0 then v_unit else coalesce(v_unit, 0) end,
      flags = coalesce(array(select jsonb_array_elements_text(coalesce(e->'flags', '[]'::jsonb))), '{}'),
      inspection_note = case when e ? 'inspection_note' then left(nullif(btrim(e->>'inspection_note'), ''), 1000) else inspection_note end,
      inspection_internal_note = case when e ? 'inspection_internal_note'
        then left(nullif(btrim(e->>'inspection_internal_note'), ''), 2000) else inspection_internal_note end,
      inspected_at = now()
    where id = v_card.id;
    v_n := v_n + 1;
  end loop;

  update public.trade_requests set status = 'under_inspection' where id = p_trade_id and status = 'received';
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'cards_inspected', v_trade.status, 'under_inspection',
    jsonb_build_object('cards', v_n));
end;
$$;

-- The final offer, once every approved card is inspected: the value of the
-- cards accepted, the credit at the trade's rate (less any fee), and, only
-- when cash payouts are on and staff choose it, cash at the cash rate for
-- credit beyond the order. Shipping on our cards mirrors checkout.
create or replace function public.trade_send_final_offer(
  p_trade_id uuid, p_cash_for_excess boolean, p_actor_id uuid, p_actor_label text
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_value bigint;
  v_credit integer;
  v_wanted integer;
  v_shipping integer;
  v_excess integer;
  v_cash integer;
  c_tracked_cents constant integer := 550;           -- as checkout_place_order_core
  c_free_shipping_threshold constant integer := 7500;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.status not in ('received', 'under_inspection') then
    raise exception 'Send the final offer once their cards are inspected.' using errcode = 'GT009';
  end if;
  if exists (select 1 from public.trade_offer_cards
             where trade_request_id = p_trade_id and review_status = 'approved' and inspected_at is null) then
    raise exception 'Inspect every approved card first, or confirm them as described.' using errcode = 'GT010';
  end if;
  if not exists (select 1 from public.trade_request_items where trade_request_id = p_trade_id and status = 'reserved') then
    raise exception 'None of our cards are on this trade any more.' using errcode = 'GT010';
  end if;

  select coalesce(sum(final_quantity::bigint * final_unit_cents), 0) into v_value
    from public.trade_offer_cards
    where trade_request_id = p_trade_id and inspected_at is not null and coalesce(final_quantity, 0) > 0;
  if v_value > 100000000 then
    raise exception 'That''s more than we can take in one trade.' using errcode = 'GT006';
  end if;
  v_credit := greatest(round(v_value * v_trade.credit_rate_percent / 100.0)::int - v_trade.processing_fee_cents, 0);
  v_wanted := public.trade_recount_wanted(p_trade_id);
  v_shipping := case when v_wanted >= c_free_shipping_threshold then 0 else c_tracked_cents end;
  v_excess := greatest(v_credit - (v_wanted + v_shipping), 0);

  if coalesce(p_cash_for_excess, false) then
    if not s.cash_payout_enabled then
      raise exception 'Cash payouts are turned off in Trades, Settings.' using errcode = 'GT010';
    end if;
    if v_excess = 0 then
      raise exception 'There''s no credit left over to pay in cash.' using errcode = 'GT010';
    end if;
    -- The same card value at the cash rate instead of the credit rate.
    v_cash := round(v_excess * s.cash_rate_percent / v_trade.credit_rate_percent::numeric)::int;
  end if;

  update public.trade_requests set
    status = 'awaiting_final_approval',
    final_value_cents = v_value::int,
    final_credit_cents = v_credit,
    final_offer_at = now(),
    excess_handling = case when coalesce(p_cash_for_excess, false) then 'cash' else 'store_credit' end,
    cash_payout_cents = v_cash
  where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'final_offer_sent', v_trade.status, 'awaiting_final_approval',
    jsonb_build_object('final_value_cents', v_value, 'final_credit_cents', v_credit, 'wanted_total_cents', v_wanted,
                       'shipping_cents', v_shipping, 'excess_cents', v_excess, 'cash_payout_cents', v_cash));
  return v_credit;
end;
$$;

-- 16. A trade is complete when its order ships ------------------------------------
create or replace function public.tg_trade_order_shipped()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.trade_request_id is not null and new.status in ('shipped', 'delivered')
     and old.status is distinct from new.status then
    update public.trade_requests set status = 'completed', completed_at = coalesce(completed_at, now()), closed_at = coalesce(closed_at, now())
      where id = new.trade_request_id and status = 'approved_for_fulfillment';
    if found then
      perform public.trade_log(new.trade_request_id, 'system', null, null, 'completed', 'approved_for_fulfillment', 'completed',
        jsonb_build_object('order_id', new.id, 'order_status', new.status));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trade_order_shipped on public.orders;
create trigger trade_order_shipped after update of status on public.orders
  for each row execute function public.tg_trade_order_shipped();

-- 17. Staff push notifications: a 'trade' kind (a trade sent for review,
-- a tracking number, a final offer answered, a payment), on for devices that
-- already have notifications turned on. Every kind that exists today stays.
alter table public.staff_push_subscriptions
  drop constraint if exists staff_push_subscriptions_kinds_check;
alter table public.staff_push_subscriptions
  add constraint staff_push_subscriptions_kinds_check
  check (kinds <@ array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup', 'photo_request', 'sorting_request', 'trade']::text[]);
alter table public.staff_push_subscriptions
  alter column kinds set default array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup', 'photo_request', 'sorting_request', 'trade']::text[];
update public.staff_push_subscriptions
  set kinds = array_append(kinds, 'trade'), updated_at = now()
  where not ('trade' = any (kinds));

do $$
begin
  if to_regclass('public.staff_apns_devices') is not null then
    alter table public.staff_apns_devices
      drop constraint if exists staff_apns_devices_kinds_check;
    alter table public.staff_apns_devices
      add constraint staff_apns_devices_kinds_check
      check (kinds <@ array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup', 'photo_request', 'sorting_request', 'trade']::text[]);
    alter table public.staff_apns_devices
      alter column kinds set default array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup', 'photo_request', 'sorting_request', 'trade']::text[];
    update public.staff_apns_devices
      set kinds = array_append(kinds, 'trade'), updated_at = now()
      where not ('trade' = any (kinds));
  end if;
end$$;

-- 18. The admin sidebar's Trades number: trades waiting on staff (a list to
-- review, a package to inspect, cards to mail back). Everything else is as
-- it was (migration 20261017230000).
create or replace function public.admin_nav_badges(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_user uuid;
  v_seen timestamptz;
begin
  if public.is_staff() then
    -- Staff only ever get their own "new users" count.
    v_user := auth.uid();
  elsif public.staff_or_service_role() then
    -- The server asking on a staff member's behalf (app icon badge in pushes).
    v_user := p_user_id;
  else
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_user is not null then
    select s.seen_at into v_seen
    from public.staff_section_seen s
    where s.user_id = v_user and s.section = 'users';
  end if;

  return jsonb_build_object(
    'needs_packing', (select count(*) from public.orders where status = 'paid'),
    'open_photo_requests', (select count(*) from public.photo_requests where status = 'new'),
    'waiting_pickups', (select count(*) from public.pickup_requests where status = 'waiting'),
    'new_leads', (select count(*) from public.sell_submissions where status = 'new'),
    'new_partner_leads', (select count(*) from public.referral_leads where status = 'new'),
    'new_partner_applications', (select count(*) from public.partners where status = 'applied'),
    'new_sorting_requests', (select count(*) from public.sorting_requests where status = 'new'),
    'trades_waiting', (select count(*) from public.trade_requests
                       where status in ('pending_review', 'received', 'under_inspection', 'return_pending')),
    'new_users', case when v_user is null then 0 else (
      select count(*) from public.customers c
      -- Sign-ups only; customers staff added or imported aren't news.
      where c.source in ('account_signup', 'checkout', 'newsletter')
        -- Never opened Users yet: the last week, not every customer ever.
        and c.created_at > coalesce(v_seen, now() - interval '7 days')
    ) end
  );
end;
$$;
revoke all on function public.admin_nav_badges(uuid) from public, anon;
grant execute on function public.admin_nav_badges(uuid) to authenticated, service_role;

-- 19. Only the server may call these -------------------------------------------
revoke all on function public.trade_require_service_role() from public, anon, authenticated;
revoke all on function public.trade_log(uuid, text, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.trade_hold_line(uuid, bigint, uuid, integer) from public, anon, authenticated;
revoke all on function public.trade_release_line(uuid, text) from public, anon, authenticated;
revoke all on function public.trade_recount_wanted(uuid) from public, anon, authenticated;
revoke all on function public.trade_start(uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.trade_set_wanted(uuid, jsonb, text[], text, uuid, text) from public, anon, authenticated;
revoke all on function public.trade_close(uuid, text, text[], text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.trade_expire_due(integer) from public, anon, authenticated;
revoke all on function public.trade_finalize_core(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.trade_accept_final(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.trade_record_payment(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.trade_import_card(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.trade_save_offer(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.trade_submit(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.trade_review_cards(uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.trade_request_revision(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.trade_approve(uuid, timestamptz, text, uuid, text) from public, anon, authenticated;
revoke all on function public.trade_inspect_cards(uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.trade_send_final_offer(uuid, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.tg_trade_order_shipped() from public, anon, authenticated;
grant execute on function public.trade_start(uuid, jsonb, text, text) to service_role;
grant execute on function public.trade_set_wanted(uuid, jsonb, text[], text, uuid, text) to service_role;
grant execute on function public.trade_close(uuid, text, text[], text, text, uuid, text) to service_role;
grant execute on function public.trade_expire_due(integer) to service_role;
grant execute on function public.trade_accept_final(uuid, uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.trade_record_payment(uuid, integer, text) to service_role;
grant execute on function public.trade_import_card(uuid, integer, text, text) to service_role;
grant execute on function public.trade_save_offer(uuid, uuid, jsonb) to service_role;
grant execute on function public.trade_submit(uuid, uuid, text) to service_role;
grant execute on function public.trade_review_cards(uuid, jsonb, uuid, text) to service_role;
grant execute on function public.trade_request_revision(uuid, text, uuid, text) to service_role;
grant execute on function public.trade_approve(uuid, timestamptz, text, uuid, text) to service_role;
grant execute on function public.trade_inspect_cards(uuid, jsonb, uuid, text) to service_role;
grant execute on function public.trade_send_final_offer(uuid, boolean, uuid, text) to service_role;
