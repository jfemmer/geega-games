-- Trade Center: customers trade their Magic cards toward cards from our
-- inventory, online (storefront "Trade Cards", admin "Trades"), with staff
-- approval, a confirmation window, a refundable reservation deposit,
-- verified shipping and customer reliability.
--
-- This replaces the earlier draft (20261025120000_trade_center.sql), which
-- was never run on production. Run this one instead.
--
-- How a trade runs (trade_requests.status):
--   awaiting_trade_list     A draft: the customer picks our cards and lists
--                           theirs. Nothing is held: our cards stay on sale.
--                           A draft nobody sends lapses after draft_days.
--   pending_review          Sent for review. Still nothing held.
--   revision_requested      Staff asked for changes, or one of our cards sold
--                           before the customer confirmed. They update the
--                           trade and send it again within revision_hours.
--   awaiting_confirmation   Approved. The customer has confirmation_hours of
--                           qualifying time to confirm (confirm_by). Our
--                           cards are still on sale meanwhile.
--   awaiting_deposit        They agreed to the terms and are paying the
--                           refundable deposit (a Stripe PaymentIntent).
--   awaiting_shipment       Reserved: our cards are held (inventory_reservations)
--                           from the moment the deposit is paid, or they
--                           confirm when there's none. They ship within
--                           ship_days qualifying days (ship_by).
--   tracking_submitted      They sent a tracking number: waiting for the
--                           carrier's first acceptance scan. A label alone
--                           doesn't count.
--   in_transit              The carrier accepted the package by ship_by (or
--                           staff verified it): the deposit is refunded in
--                           full, and the hold is never released because a
--                           carrier is slow.
--   received                Delivered: waiting for inspection.
--   under_inspection
--   awaiting_final_approval The final offer, with each change and its reason.
--                           The customer accepts or declines; declining never
--                           costs the deposit.
--   awaiting_payment        Accepted: they pay the difference by card.
--   approved_for_fulfillment  Final trade approved: the credit was issued and
--                           spent on a paid order for our cards.
--   completed               That order shipped.
-- Closed early:
--   rejected                Staff turned it down before it was confirmed.
--   offer_expired           A draft, a revision or an approval wasn't answered
--                           in time. Nothing was held.
--   canceled                The customer canceled before shipping.
--   expired                 Reserved but not shipped by ship_by: the hold is
--                           released and a paid deposit goes to staff review.
--   canceled_after_shipment The customer withdrew after shipping: no penalty.
--   declined_after_inspection  They declined the final offer: no penalty.
--   canceled_by_store       We canceled: any deposit is refunded.
--
-- Qualifying time: Sundays (midnight to midnight, America/Chicago) and the
-- dates in trade_settings.excluded_dates don't count; Saturdays do. The
-- server works every deadline out once (src/store/lib/tradeDeadlines.ts)
-- and hands it in; these functions check it and store it, and the expiry
-- job, reminders and pages all read the stored deadline.
--
-- The deposit is tracked on its own (deposit_status): not_required,
-- payment_pending, paid, refund_pending, refunded, forfeiture_review,
-- forfeited, refund_failed, and canceled (required but never paid because
-- the trade closed first). It is never kept automatically: a customer who
-- cancels while reserved, or doesn't ship by the deadline, goes to
-- forfeiture_review, and only staff decide. Forfeiting also needs
-- trade_settings.allow_forfeiture, which is off until the store owner turns
-- it on.
--
-- Errors the functions raise for the API to pass on: GT001 trading closed or
-- paused, GT002 too many open trades, GT003 trading paused for this account,
-- GT004 a card isn't available, GT005/GT006 trade value under the minimum or
-- over the maximum, GT008 underpaid, GT009 not in a status that allows it,
-- GT010 bad input, GT011 no address for customers to ship to, GT012 a
-- deadline passed, GT404 no such trade (or not theirs).
--
-- Everything here is read and written by the server (service role) only:
-- RLS is on with no policies, and the functions refuse any other caller.

-- 0. An earlier draft of this update must not have been run ------------------
do $$
begin
  if to_regclass('public.trade_requests') is not null and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trade_requests' and column_name = 'deposit_status'
  ) then
    raise exception 'An earlier draft of the Trade Center update was run on this database. Stop here and ask for the matching upgrade.';
  end if;
end$$;

-- Imported trade-ins get their own reason in the inventory ledger.
alter type public.inventory_movement_reason add value if not exists 'trade_in';

-- 1. Settings (one row) ---------------------------------------------------------
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

  -- Deadlines. confirmation_hours and the ship days are qualifying time.
  draft_days integer not null default 14 check (draft_days between 1 and 90),
  revision_hours integer not null default 168 check (revision_hours between 1 and 720),
  confirmation_hours integer not null default 48 check (confirmation_hours between 1 and 336),
  -- Days to ship once reserved: new customers, then after loyalty_tier1_trades
  -- and loyalty_tier2_trades completed trades.
  ship_days_new integer not null default 3 check (ship_days_new between 1 and 30),
  ship_days_tier1 integer not null default 4 check (ship_days_tier1 between 1 and 30),
  ship_days_tier2 integer not null default 5 check (ship_days_tier2 between 1 and 30),
  loyalty_tier1_trades integer not null default 3 check (loyalty_tier1_trades between 1 and 1000),
  loyalty_tier2_trades integer not null default 10 check (loyalty_tier2_trades between 1 and 1000),
  -- A tracking number sent in time gets this long after the deadline for its
  -- first carrier scan to show up before the reservation can expire.
  scan_grace_hours integer not null default 24 check (scan_grace_hours between 0 and 168),
  -- Extra days that don't count (Sundays never do). No holidays by default.
  excluded_dates date[] not null default '{}',
  payment_due_days integer not null default 7 check (payment_due_days between 1 and 60),
  -- Staff alerts only (nothing is released): in transit too long, or no
  -- carrier update for too long.
  max_transit_days integer not null default 10 check (max_transit_days between 1 and 90),
  stall_alert_days integer not null default 4 check (stall_alert_days between 1 and 30),
  -- Reminder emails this many hours before a deadline (0: none).
  confirm_reminder_hours integer not null default 12 check (confirm_reminder_hours between 0 and 72),
  ship_reminder_hours integer not null default 24 check (ship_reminder_hours between 0 and 72),
  -- How long after an expiry a customer can still send proof they shipped.
  dispute_window_days integer not null default 14 check (dispute_window_days between 1 and 90),

  -- The refundable reservation deposit, by the value of our cards reserved.
  deposits_enabled boolean not null default true,
  -- Required from this value up (unless required by hand for a trade or customer).
  deposit_threshold_cents integer not null default 30000 check (deposit_threshold_cents between 0 and 100000000),
  -- Under band1_max: band1; under band2_max: band2; under band3_max: band3; else band4.
  deposit_band1_max_cents integer not null default 10000 check (deposit_band1_max_cents between 1 and 100000000),
  deposit_band2_max_cents integer not null default 30000 check (deposit_band2_max_cents between 1 and 100000000),
  deposit_band3_max_cents integer not null default 60000 check (deposit_band3_max_cents between 1 and 100000000),
  deposit_band1_cents integer not null default 500 check (deposit_band1_cents between 50 and 100000),
  deposit_band2_cents integer not null default 1000 check (deposit_band2_cents between 50 and 100000),
  deposit_band3_cents integer not null default 2000 check (deposit_band3_cents between 50 and 100000),
  deposit_band4_cents integer not null default 3000 check (deposit_band4_cents between 50 and 100000),
  -- Off: a deposit under review can only be refunded. The owner turns this on
  -- after checking the cancellation terms against consumer-protection law and
  -- Stripe's rules.
  allow_forfeiture boolean not null default false,
  -- What customers agree to before paying (their copy is kept with the
  -- trade, trade_consents). The version goes up whenever the text changes.
  deposit_terms text not null default
'To reserve your selected cards, a refundable deposit may be required.

Your deposit will be refunded in full once your trade-in shipment has been verified as accepted by the shipping carrier within your shipping deadline.

If you cancel your trade before shipping or fail to ship within the deadline, your deposit may be forfeited under our cancellation policy. We review every case before keeping a deposit.

If your cards arrive and we adjust the final offer based on condition, authenticity, card identification, or pricing, you are always free to decline without losing your deposit.

Your cards must be shipped within the displayed deadline. Sundays do not count toward your shipping window.'
    check (char_length(deposit_terms) between 1 and 6000),
  deposit_terms_version integer not null default 1 check (deposit_terms_version >= 1),

  -- Reliability: this many customer-caused abandonments (canceling while
  -- reserved, missing a shipping deadline) within abandon_window_days means
  -- a deposit on every trade, or no new trades until staff allow it.
  abandon_limit integer not null default 2 check (abandon_limit between 1 and 20),
  abandon_window_days integer not null default 365 check (abandon_window_days between 30 and 3650),
  abandon_policy text not null default 'deposit' check (abandon_policy in ('deposit', 'block')),

  max_active_trades integer not null default 2 check (max_active_trades between 1 and 20),
  max_wanted_lines integer not null default 40 check (max_wanted_lines between 1 and 200),
  max_offered_lines integer not null default 100 check (max_offered_lines between 1 and 500),
  min_trade_value_cents integer not null default 0 check (min_trade_value_cents between 0 and 100000000),
  max_trade_value_cents integer check (max_trade_value_cents is null or max_trade_value_cents between 1 and 100000000),
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
  updated_by uuid,

  constraint trade_settings_deposit_bands_order
    check (deposit_band1_max_cents < deposit_band2_max_cents and deposit_band2_max_cents < deposit_band3_max_cents),
  constraint trade_settings_loyalty_order check (loyalty_tier1_trades < loyalty_tier2_trades)
);

insert into public.trade_settings (id) values (true) on conflict (id) do nothing;

comment on table public.trade_settings is
  'Trade Center settings (one row): on/off and pause, credit rate and card minimum, condition values, deadlines (qualifying time), deposits, reliability, limits, cash payouts, eligibility, and the address and policies customers see.';

-- 2. Trades -----------------------------------------------------------------------
create table if not exists public.trade_requests (
  id uuid primary key default gen_random_uuid(),
  -- Shown as "TR-1001".
  trade_number bigint generated always as identity (start with 1001) not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  customer_name text check (customer_name is null or char_length(customer_name) <= 120),
  customer_email text check (customer_email is null or char_length(customer_email) <= 254),

  status text not null default 'awaiting_trade_list' check (status in (
    'awaiting_trade_list', 'pending_review', 'revision_requested',
    'awaiting_confirmation', 'awaiting_deposit',
    'awaiting_shipment', 'tracking_submitted', 'in_transit',
    'received', 'under_inspection', 'awaiting_final_approval', 'awaiting_payment',
    'approved_for_fulfillment', 'completed',
    'rejected', 'offer_expired', 'canceled', 'expired',
    'canceled_after_shipment', 'declined_after_inspection', 'canceled_by_store'
  )),

  -- The terms the trade started on; a later settings change doesn't move them.
  credit_rate_percent integer not null check (credit_rate_percent between 1 and 100),
  min_card_value_cents integer not null check (min_card_value_cents >= 0),
  condition_percents jsonb not null check (jsonb_typeof(condition_percents) = 'object'),
  processing_fee_cents integer not null default 0 check (processing_fee_cents >= 0),

  -- Our cards, at the prices fixed when they were added.
  wanted_total_cents integer not null default 0 check (wanted_total_cents >= 0),
  -- Their cards: estimated, approved before shipping, final after inspection.
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

  -- Deadlines, each worked out by the server in qualifying time.
  list_due_at timestamptz,          -- a draft or a revision lapses
  confirm_by timestamptz,           -- the approval lapses unless confirmed
  confirm_by_original timestamptz,
  ship_by timestamptz,              -- the carrier must accept the package by then
  ship_by_original timestamptz,
  ship_days integer check (ship_days is null or ship_days between 1 and 30),
  payment_due_at timestamptz,
  approval_conditions text check (approval_conditions is null or char_length(approval_conditions) <= 2000),
  confirmed_at timestamptz,
  reserved_at timestamptz,

  -- The refundable reservation deposit.
  deposit_cents integer not null default 0 check (deposit_cents between 0 and 100000),
  deposit_reason text check (deposit_reason is null or deposit_reason in ('threshold', 'trade', 'customer', 'reliability')),
  deposit_override text not null default 'auto' check (deposit_override in ('auto', 'required', 'waived')),
  deposit_status text not null default 'not_required' check (deposit_status in (
    'not_required', 'payment_pending', 'paid', 'refund_pending', 'refunded',
    'forfeiture_review', 'forfeited', 'refund_failed', 'canceled'
  )),
  deposit_payment_intent text check (deposit_payment_intent is null or deposit_payment_intent ~ '^pi_[A-Za-z0-9_]{1,250}$'),
  deposit_paid_cents integer check (deposit_paid_cents is null or deposit_paid_cents >= 0),
  deposit_paid_at timestamptz,
  -- Stripe's fee on the deposit (kept by Stripe; never taken from a refund).
  deposit_fee_cents integer check (deposit_fee_cents is null or deposit_fee_cents >= 0),
  deposit_refund_id text check (deposit_refund_id is null or char_length(deposit_refund_id) <= 255),
  -- Each new refund try gets its own idempotency key (…-<attempt>).
  deposit_refund_attempts integer not null default 0 check (deposit_refund_attempts >= 0),
  deposit_refund_requested_at timestamptz,
  deposit_refunded_at timestamptz,
  deposit_refund_failure text check (deposit_refund_failure is null or char_length(deposit_refund_failure) <= 500),
  deposit_decided_at timestamptz,
  deposit_decided_by text check (deposit_decided_by is null or char_length(deposit_decided_by) <= 200),
  deposit_decision_note text check (deposit_decision_note is null or char_length(deposit_decision_note) <= 2000),

  -- Their package.
  inbound_carrier text check (inbound_carrier is null or char_length(inbound_carrier) <= 40),
  inbound_tracking text check (inbound_tracking is null or char_length(inbound_tracking) <= 60),
  inbound_tracking_added_at timestamptz,
  inbound_tracker_id text check (inbound_tracker_id is null or char_length(inbound_tracker_id) <= 100),
  inbound_tracking_status text check (inbound_tracking_status is null or char_length(inbound_tracking_status) <= 40),
  -- The carrier's scans, oldest first: [{ status, detail, message, at, location }].
  inbound_tracking_events jsonb not null default '[]'::jsonb check (jsonb_typeof(inbound_tracking_events) = 'array'),
  inbound_tracking_checked_at timestamptz,
  inbound_last_event_at timestamptz,
  -- The first time the carrier had the package (or what staff verified).
  inbound_accepted_at timestamptz,
  inbound_acceptance_source text check (inbound_acceptance_source is null or inbound_acceptance_source in ('carrier', 'staff', 'received')),
  shipped_on_time boolean,
  inbound_delivered_at timestamptz,

  -- Something staff need to look at: a scan after the deadline (inside the
  -- grace window), a scan from before the trade was approved, a tracking
  -- number nothing can check automatically, or proof of shipping sent in.
  review_flag text check (review_flag is null or review_flag in ('late_acceptance', 'early_scan', 'tracking_check', 'dispute')),
  review_flag_at timestamptz,

  -- Customer-caused outcomes that count against reliability. Staff can clear one.
  customer_fault text check (customer_fault is null or customer_fault in ('canceled_while_reserved', 'missed_deadline', 'late_shipment')),
  fault_at timestamptz,
  fault_cleared_at timestamptz,
  fault_cleared_by text check (fault_cleared_by is null or char_length(fault_cleared_by) <= 200),
  -- Which deadline ran out, for offer_expired and expired.
  expired_stage text check (expired_stage is null or expired_stage in ('draft', 'revision', 'confirmation', 'deposit', 'shipping', 'scan')),

  -- Their cards going back to them.
  return_status text not null default 'none' check (return_status in ('none', 'pending', 'returned')),
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
  updated_at timestamptz not null default now(),

  -- Waiting on staff: the admin's "Needs you" list and the sidebar number.
  needs_staff boolean generated always as (
    status in ('pending_review', 'received', 'under_inspection')
    or return_status = 'pending'
    or deposit_status in ('forfeiture_review', 'refund_failed')
    or review_flag is not null
  ) stored
);

create index if not exists trade_requests_user_idx on public.trade_requests (user_id, created_at desc);
create index if not exists trade_requests_status_idx on public.trade_requests (status, updated_at desc);
create index if not exists trade_requests_confirm_idx on public.trade_requests (confirm_by)
  where status in ('awaiting_confirmation', 'awaiting_deposit');
create index if not exists trade_requests_ship_idx on public.trade_requests (ship_by)
  where status in ('awaiting_shipment', 'tracking_submitted');
create index if not exists trade_requests_list_due_idx on public.trade_requests (list_due_at)
  where status in ('awaiting_trade_list', 'revision_requested');
create index if not exists trade_requests_deposit_idx on public.trade_requests (deposit_status, updated_at desc)
  where deposit_status <> 'not_required';
create index if not exists trade_requests_needs_staff_idx on public.trade_requests (updated_at desc) where needs_staff;
create unique index if not exists trade_requests_deposit_pi_once on public.trade_requests (deposit_payment_intent)
  where deposit_payment_intent is not null;
create index if not exists trade_requests_tracking_idx on public.trade_requests (inbound_tracking)
  where inbound_tracking is not null;

comment on table public.trade_requests is
  'Online trades (Trade Center). Statuses, deadlines and the deposit are explained in migration 20261025200000_trade_center.sql.';

-- 3. Our cards on a trade ---------------------------------------------------------
-- requested: on the trade, not held (before it's reserved). reserved: held.
-- released: let go when the trade closed (staff can reinstate it).
-- removed: taken off after it was reserved. fulfilled: on the trade's order.
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
  status text not null default 'requested' check (status in ('requested', 'reserved', 'released', 'removed', 'fulfilled')),
  created_at timestamptz not null default now(),
  unique (trade_request_id, inventory_item_id)
);

create index if not exists trade_request_items_trade_idx on public.trade_request_items (trade_request_id);
create index if not exists trade_request_items_inventory_idx on public.trade_request_items (inventory_item_id)
  where status in ('requested', 'reserved');

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
-- trade_events is the audit log: every status change, reservation and
-- release, deposit payment, refund and decision, with who did it.
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
create index if not exists trade_events_event_idx on public.trade_events (event, created_at desc);

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

-- 6. Extensions, proof of shipping, consent, per-customer settings -----------------
create table if not exists public.trade_extensions (
  id uuid primary key default gen_random_uuid(),
  trade_request_id uuid not null references public.trade_requests(id) on delete cascade,
  kind text not null check (kind in ('list', 'confirmation', 'shipping', 'payment')),
  from_deadline timestamptz,
  to_deadline timestamptz not null,
  hours integer check (hours is null or hours between 1 and 2000),
  -- The customer asked for it (counts in their reliability, never against it).
  customer_requested boolean not null default false,
  reason text check (reason is null or char_length(reason) <= 1000),
  created_by uuid,
  created_by_label text check (created_by_label is null or char_length(created_by_label) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists trade_extensions_trade_idx on public.trade_extensions (trade_request_id, created_at);

create table if not exists public.trade_disputes (
  id uuid primary key default gen_random_uuid(),
  trade_request_id uuid not null references public.trade_requests(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  note text not null check (char_length(btrim(note)) between 1 and 4000),
  -- Files in the private trade-dispute-files bucket: [{ path, name, size, type }].
  files jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array'),
  staff_note text check (staff_note is null or char_length(staff_note) <= 2000),
  resolved_by uuid,
  resolved_by_label text check (resolved_by_label is null or char_length(resolved_by_label) <= 200),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trade_disputes_trade_idx on public.trade_disputes (trade_request_id, created_at);
create unique index if not exists trade_disputes_one_open on public.trade_disputes (trade_request_id) where status = 'open';

create table if not exists public.trade_consents (
  id uuid primary key default gen_random_uuid(),
  trade_request_id uuid not null references public.trade_requests(id) on delete cascade,
  user_id uuid not null,
  terms_version integer not null,
  terms_text text not null check (char_length(terms_text) between 1 and 6000),
  deposit_cents integer not null,
  ship_days integer,
  confirm_by timestamptz,
  ip text check (ip is null or char_length(ip) <= 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  created_at timestamptz not null default now()
);
create index if not exists trade_consents_trade_idx on public.trade_consents (trade_request_id, created_at);

create table if not exists public.trade_customer_flags (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- A deposit on every trade, whatever its value.
  deposit_required boolean not null default false,
  -- No new trades until staff allow it again.
  blocked boolean not null default false,
  note text check (note is null or char_length(note) <= 1000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- Proof-of-shipping files: private; uploads use signed URLs from the API,
-- and staff see them through short-lived signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trade-dispute-files',
  'trade-dispute-files',
  false,
  10485760, -- 10 MB a file
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 7. Links into existing tables -----------------------------------------------------
-- A trade's reservations are inventory_reservations rows like any other, so
-- the storefront, cart, checkout and pickups already count them as taken.
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

-- 8. Locked down: the server does everything ------------------------------------
alter table public.trade_settings enable row level security;
alter table public.trade_requests enable row level security;
alter table public.trade_request_items enable row level security;
alter table public.trade_offer_cards enable row level security;
alter table public.trade_events enable row level security;
alter table public.trade_messages enable row level security;
alter table public.trade_extensions enable row level security;
alter table public.trade_disputes enable row level security;
alter table public.trade_consents enable row level security;
alter table public.trade_customer_flags enable row level security;
revoke all on public.trade_settings, public.trade_requests, public.trade_request_items,
  public.trade_offer_cards, public.trade_events, public.trade_messages, public.trade_extensions,
  public.trade_disputes, public.trade_consents, public.trade_customer_flags from anon, authenticated;

-- updated_at bookkeeping, like the other tables.
drop trigger if exists set_updated_at on public.trade_requests;
create trigger set_updated_at before update on public.trade_requests
  for each row execute function public.tg_set_updated_at();
drop trigger if exists set_updated_at on public.trade_offer_cards;
create trigger set_updated_at before update on public.trade_offer_cards
  for each row execute function public.tg_set_updated_at();
drop trigger if exists set_updated_at on public.trade_disputes;
create trigger set_updated_at before update on public.trade_disputes
  for each row execute function public.tg_set_updated_at();

-- 9. Helpers ------------------------------------------------------------------------
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
  values (p_trade_id, p_actor_type, p_actor_id, left(p_actor_label, 200), p_event, p_from, p_to, coalesce(p_detail, '{}'::jsonb));
$$;

-- What a closing status does to the deposit. Never keeps it: a paid deposit
-- of a customer who canceled while reserved, or missed the deadline, goes to
-- staff review; every other way of closing refunds it.
create or replace function public.trade_deposit_after_close(p_deposit_status text, p_close_status text)
returns text
language sql
immutable
as $$
  select case
    when p_deposit_status = 'payment_pending' then 'canceled'
    when p_close_status in ('canceled', 'expired') and p_deposit_status = 'paid' then 'forfeiture_review'
    when p_close_status in ('canceled', 'expired') then p_deposit_status
    when p_deposit_status in ('paid', 'forfeiture_review') then 'refund_pending'
    else p_deposit_status
  end;
$$;

-- How many of an inventory line are free: on hand, less every active hold
-- except this trade's own. 0 for a card that isn't on sale.
create or replace function public.trade_available(p_inventory_item_id uuid, p_trade_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when i.id is null or i.status <> 'active'
      or coalesce(public.trade_regular_price(i.price_cents, i.original_price_cents, i.is_deal), 0) <= 0 then 0
    else greatest(i.quantity - coalesce((
      select sum(r.quantity) from public.inventory_reservations r
      where r.inventory_item_id = i.id and r.status = 'active'
        and r.trade_request_id is distinct from p_trade_id
    ), 0), 0)::int
  end
  from (select 1) one
  left join public.inventory_items i on i.id = p_inventory_item_id;
$$;

-- Our cards on a trade that can't be reserved now (sold, off sale, or fewer
-- free than asked for): [{ item_id, inventory_item_id, card_name, wanted, available }].
create or replace function public.trade_short_lines(p_trade_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', x.id, 'inventory_item_id', x.inventory_item_id, 'card_name', x.card_name,
    'wanted', x.quantity, 'available', x.available
  ) order by x.card_name), '[]'::jsonb)
  from (
    select i.id, i.inventory_item_id, i.card_name, i.quantity,
           public.trade_available(i.inventory_item_id, i.trade_request_id) as available
    from public.trade_request_items i
    where i.trade_request_id = p_trade_id and i.status = 'requested'
  ) x
  where x.available < x.quantity;
$$;

-- Adds one of our cards to a trade, or changes how many. With p_reserve
-- (the trade is already reserved) it also holds them. Raises GT004 when that
-- many aren't free. Caller holds the trade row lock; this takes the
-- inventory row lock.
create or replace function public.trade_put_line(
  p_trade_id uuid, p_trade_number bigint, p_inventory_item_id uuid, p_quantity integer, p_reserve boolean
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv public.inventory_items%rowtype;
  v_item public.trade_request_items%rowtype;
  v_free integer;
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

  v_free := public.trade_available(p_inventory_item_id, p_trade_id);
  if p_quantity > v_free then
    if v_free <= 0 then
      raise exception '% isn''t available right now.', v_inv.card_name using errcode = 'GT004';
    end if;
    raise exception 'Only % of % % available.', v_free, v_inv.card_name,
      case when v_free = 1 then 'is' else 'are' end
      using errcode = 'GT004';
  end if;

  if not coalesce(p_reserve, false) then
    if v_item.id is not null then
      -- The price stays the one the customer was first shown.
      update public.trade_request_items set quantity = p_quantity, status = 'requested', reservation_id = null
        where id = v_item.id;
      return v_item.unit_price_cents * p_quantity;
    end if;
    insert into public.trade_request_items (
      trade_request_id, inventory_item_id, quantity, unit_price_cents, status,
      card_name, set_code, set_name, collector_number, condition, finish, variant_type, image_url, scryfall_id
    ) values (
      p_trade_id, v_inv.id, p_quantity, v_price, 'requested',
      v_inv.card_name, v_inv.set_code, v_inv.set_name, v_inv.collector_number, v_inv.condition, v_inv.finish,
      nullif(v_inv.variant_type, ''), v_inv.image_url, v_inv.scryfall_id
    );
    return v_price * p_quantity;
  end if;

  if v_item.id is not null and v_item.status = 'reserved' then
    update public.inventory_reservations set quantity = p_quantity
      where id = v_item.reservation_id and status = 'active';
    if not found then
      raise exception 'The reservation on % was released. Remove it and add it again.', v_inv.card_name using errcode = 'GT004';
    end if;
    update public.trade_request_items set quantity = p_quantity where id = v_item.id;
    return v_item.unit_price_cents * p_quantity;
  end if;

  insert into public.inventory_reservations (inventory_item_id, customer_id, quantity, note, reserved_by, trade_request_id)
  values (p_inventory_item_id, null, p_quantity, 'Trade TR-' || p_trade_number, 'trade', p_trade_id)
  returning id into v_res_id;

  if v_item.id is not null then
    update public.trade_request_items
      set reservation_id = v_res_id, quantity = p_quantity, status = 'reserved'
      where id = v_item.id;
    return v_item.unit_price_cents * p_quantity;
  end if;
  insert into public.trade_request_items (
    trade_request_id, inventory_item_id, reservation_id, quantity, unit_price_cents, status,
    card_name, set_code, set_name, collector_number, condition, finish, variant_type, image_url, scryfall_id
  ) values (
    p_trade_id, v_inv.id, v_res_id, p_quantity, v_price, 'reserved',
    v_inv.card_name, v_inv.set_code, v_inv.set_name, v_inv.collector_number, v_inv.condition, v_inv.finish,
    nullif(v_inv.variant_type, ''), v_inv.image_url, v_inv.scryfall_id
  );
  return v_price * p_quantity;
end;
$$;

-- Lets go of one line's reservation (idempotent). p_status: released (the
-- trade closed) or removed (taken off the trade).
create or replace function public.trade_release_line(p_item_id uuid, p_by text, p_status text default 'released')
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item public.trade_request_items%rowtype;
begin
  if p_status not in ('released', 'removed') then
    raise exception 'Not a release status: %', p_status using errcode = '22023';
  end if;
  select * into v_item from public.trade_request_items where id = p_item_id for update;
  if not found or v_item.status <> 'reserved' then return; end if;
  update public.inventory_reservations
    set status = 'released', released_at = now(), released_by = left(coalesce(p_by, 'trade'), 200)
    where id = v_item.reservation_id and status = 'active';
  update public.trade_request_items set status = p_status where id = v_item.id;
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
      where i.trade_request_id = t.id and i.status <> 'removed'
    ), 0)
  where t.id = p_trade_id
  returning wanted_total_cents;
$$;

-- A customer's record, from their trades (for reliability and privileges).
-- recent_faults: customer-caused abandonments in the last p_window_days that
-- staff haven't cleared.
create or replace function public.trade_customer_stats(p_user_id uuid, p_window_days integer default 365)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
begin
  perform public.trade_require_service_role();
  select jsonb_build_object(
    'completed_trades', count(*) filter (where t.status in ('approved_for_fulfillment', 'completed')),
    'completed_value_cents', coalesce(sum(t.final_value_cents) filter (where t.status in ('approved_for_fulfillment', 'completed')), 0),
    'abandoned_reservations', count(*) filter (where t.customer_fault = 'canceled_while_reserved' and t.fault_cleared_at is null),
    'missed_deadlines', count(*) filter (where t.customer_fault in ('missed_deadline', 'late_shipment') and t.fault_cleared_at is null),
    'recent_faults', count(*) filter (where t.customer_fault is not null and t.fault_cleared_at is null
                                        and t.fault_at > now() - make_interval(days => greatest(coalesce(p_window_days, 365), 1))),
    'on_time_shipments', count(*) filter (where t.shipped_on_time is true),
    'late_shipments', count(*) filter (where t.shipped_on_time is false),
    'declined_after_inspection', count(*) filter (where t.status = 'declined_after_inspection'),
    'canceled_after_shipment', count(*) filter (where t.status = 'canceled_after_shipment'),
    'store_canceled', count(*) filter (where t.status = 'canceled_by_store'),
    'open_trades', count(*) filter (where t.status in (
      'awaiting_trade_list', 'pending_review', 'revision_requested', 'awaiting_confirmation', 'awaiting_deposit',
      'awaiting_shipment', 'tracking_submitted', 'in_transit', 'received', 'under_inspection',
      'awaiting_final_approval', 'awaiting_payment')),
    'total_trades', count(*)
  ) into v
  from public.trade_requests t
  where t.user_id = p_user_id;

  return v || jsonb_build_object(
    'extension_requests', (select count(*) from public.trade_extensions e
                           join public.trade_requests t on t.id = e.trade_request_id
                           where t.user_id = p_user_id and e.customer_requested),
    'deposit_required', coalesce((select f.deposit_required from public.trade_customer_flags f where f.user_id = p_user_id), false),
    'blocked', coalesce((select f.blocked from public.trade_customer_flags f where f.user_id = p_user_id), false),
    'flag_note', (select f.note from public.trade_customer_flags f where f.user_id = p_user_id)
  );
end;
$$;

-- Everyone who has traded, newest first, with their record (admin Customers).
create or replace function public.trade_customer_list(p_limit integer default 300)
returns table (customer_user_id uuid, customer_name text, customer_email text, last_trade_at timestamptz, stats jsonb)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_window integer;
begin
  perform public.trade_require_service_role();
  select abandon_window_days into v_window from public.trade_settings where id;
  return query
    select u.user_id, u.name, u.email, u.last_at, public.trade_customer_stats(u.user_id, coalesce(v_window, 365))
    from (
      select t.user_id,
             (array_agg(t.customer_name order by t.created_at desc))[1] as name,
             (array_agg(t.customer_email order by t.created_at desc))[1] as email,
             max(t.created_at) as last_at
      from public.trade_requests t
      group by t.user_id
    ) u
    order by u.last_at desc
    limit greatest(coalesce(p_limit, 300), 1);
end;
$$;

-- 10. Starting a trade (nothing is held) --------------------------------------------
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
  v_stats jsonb;
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
    where user_id = p_user_id and status in (
      'awaiting_trade_list', 'pending_review', 'revision_requested', 'awaiting_confirmation', 'awaiting_deposit',
      'awaiting_shipment', 'tracking_submitted', 'in_transit', 'received', 'under_inspection',
      'awaiting_final_approval', 'awaiting_payment');
  if v_active >= s.max_active_trades then
    raise exception 'You already have % open trade%. Finish or cancel one before starting another.',
      v_active, case when v_active = 1 then '' else 's' end using errcode = 'GT002';
  end if;
  v_stats := public.trade_customer_stats(p_user_id, s.abandon_window_days);
  if (v_stats->>'blocked')::boolean
     or (s.abandon_policy = 'block' and (v_stats->>'recent_faults')::int >= s.abandon_limit) then
    raise exception 'New trades are paused on your account for now. Contact us and we''ll sort it out.'
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
    list_due_at
  ) values (
    p_user_id, left(nullif(btrim(p_customer_name), ''), 120), left(nullif(btrim(p_customer_email), ''), 254), 'awaiting_trade_list',
    s.credit_rate_percent, s.min_card_value_cents,
    jsonb_build_object('NM', s.condition_nm_percent, 'LP', s.condition_lp_percent, 'MP', s.condition_mp_percent,
                       'HP', s.condition_hp_percent, 'DMG', s.condition_dmg_percent),
    s.processing_fee_cents,
    now() + make_interval(days => s.draft_days)
  ) returning * into v_trade;

  -- In inventory id order, like checkout; repeated ids are added together.
  for r in
    select (e->>'inventory_item_id')::uuid as inv_id, sum((e->>'quantity')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1
  loop
    perform public.trade_put_line(v_trade.id, v_trade.trade_number, r.inv_id, r.qty, false);
  end loop;

  v_total := public.trade_recount_wanted(v_trade.id);
  if v_total < s.min_trade_value_cents then
    raise exception 'Trades start at % of our cards.', to_char(s.min_trade_value_cents / 100.0, 'FM$999,999,990.00') using errcode = 'GT005';
  end if;
  if s.max_trade_value_cents is not null and v_total > s.max_trade_value_cents then
    raise exception 'A trade can include up to % of our cards.', to_char(s.max_trade_value_cents / 100.0, 'FM$999,999,990.00') using errcode = 'GT006';
  end if;

  perform public.trade_log(v_trade.id, 'customer', p_user_id, left(coalesce(p_customer_email, ''), 200), 'started', null, 'awaiting_trade_list',
    jsonb_build_object('wanted_total_cents', v_total, 'list_due_at', v_trade.list_due_at));
  return v_trade.id;
end;
$$;

-- 11. Changing which of our cards are on the trade --------------------------------
-- Replaces the list with p_items (same shape as trade_start). p_statuses:
-- the statuses the caller may do this in. Before the trade is reserved the
-- cards are only requested; once reserved, changes are held or released at
-- once. Prices of cards already on the trade don't change.
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
  v_reserve boolean;
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
  if v_trade.status in ('awaiting_trade_list', 'revision_requested') and v_trade.list_due_at is not null and v_trade.list_due_at < now() then
    raise exception 'The time to update this trade ran out.' using errcode = 'GT012';
  end if;
  v_reserve := v_trade.status in ('awaiting_shipment', 'tracking_submitted', 'in_transit', 'received', 'under_inspection');
  if not v_reserve and v_trade.status not in ('awaiting_trade_list', 'pending_review', 'revision_requested') then
    raise exception 'The cards on this trade can''t be changed now.' using errcode = 'GT009';
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
    select i.id, i.status from public.trade_request_items i
    where i.trade_request_id = p_trade_id and i.status in ('requested', 'reserved')
      and i.inventory_item_id not in (select (e->>'inventory_item_id')::uuid from jsonb_array_elements(p_items) e)
  loop
    if r.status = 'reserved' then
      perform public.trade_release_line(r.id, coalesce(p_actor_label, p_actor_type), 'removed');
    else
      delete from public.trade_request_items where id = r.id;
    end if;
  end loop;

  -- Lines kept, changed or added, in inventory id order.
  for r in
    select (e->>'inventory_item_id')::uuid as inv_id, sum((e->>'quantity')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1
  loop
    perform public.trade_put_line(v_trade.id, v_trade.trade_number, r.inv_id, r.qty, v_reserve);
  end loop;

  v_total := public.trade_recount_wanted(p_trade_id);
  if s.max_trade_value_cents is not null and v_total > s.max_trade_value_cents then
    raise exception 'A trade can include up to % of our cards.', to_char(s.max_trade_value_cents / 100.0, 'FM$999,999,990.00') using errcode = 'GT006';
  end if;
  perform public.trade_log(p_trade_id, p_actor_type, p_actor_id, p_actor_label, 'wanted_changed', v_trade.status, v_trade.status,
    jsonb_build_object('wanted_total_cents', v_total, 'reserved', v_reserve));
  return v_total;
end;
$$;

-- 12. Closing a trade ----------------------------------------------------------------
-- The shared part: releases every reservation, moves the trade to p_status,
-- settles what that means for the deposit (trade_deposit_after_close), notes
-- a customer-caused fault, and marks their cards for return when they're
-- with us or on the way. Returns the deposit status it left. The caller
-- holds the trade row lock and has checked the trade may close this way.
create or replace function public.trade_close_core(
  p_trade_id uuid, p_status text, p_reason text, p_fault text, p_stage text,
  p_actor_type text, p_actor_id uuid, p_actor_label text
) returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v public.trade_requests%rowtype;
  v_dep text;
  v_return text;
  r record;
begin
  if p_status not in ('rejected', 'offer_expired', 'canceled', 'expired',
                      'canceled_after_shipment', 'declined_after_inspection', 'canceled_by_store') then
    raise exception 'Not a closing status: %', p_status using errcode = '22023';
  end if;
  if p_fault is not null and p_fault not in ('canceled_while_reserved', 'missed_deadline', 'late_shipment') then
    raise exception 'Not a fault: %', p_fault using errcode = '22023';
  end if;
  select * into v from public.trade_requests where id = p_trade_id;

  for r in select id from public.trade_request_items
           where trade_request_id = p_trade_id and status = 'reserved' order by inventory_item_id loop
    perform public.trade_release_line(r.id, coalesce(p_actor_label, p_actor_type), 'released');
  end loop;

  v_dep := public.trade_deposit_after_close(v.deposit_status, p_status);
  v_return := case
    when p_status in ('expired', 'canceled_after_shipment', 'declined_after_inspection', 'canceled_by_store')
         and (v.inbound_accepted_at is not null
              or v.status in ('in_transit', 'received', 'under_inspection', 'awaiting_final_approval', 'awaiting_payment'))
    then 'pending'
    else v.return_status
  end;

  update public.trade_requests set
    status = p_status,
    close_reason = left(nullif(btrim(p_reason), ''), 2000),
    closed_at = now(),
    deposit_status = v_dep,
    deposit_refund_requested_at = case when v_dep = 'refund_pending' and v.deposit_status <> 'refund_pending'
                                       then now() else deposit_refund_requested_at end,
    customer_fault = coalesce(p_fault, customer_fault),
    fault_at = case when p_fault is not null then now() else fault_at end,
    expired_stage = coalesce(p_stage, expired_stage),
    return_status = v_return,
    review_flag = null,
    review_flag_at = null
  where id = p_trade_id;

  perform public.trade_log(p_trade_id, p_actor_type, p_actor_id, p_actor_label, p_status, v.status, p_status,
    jsonb_build_object('reason', p_reason, 'fault', p_fault, 'stage', p_stage,
                       'deposit_from', v.deposit_status, 'deposit_to', v_dep, 'return_status', v_return));
  if v_dep is distinct from v.deposit_status then
    perform public.trade_log(p_trade_id, p_actor_type, p_actor_id, p_actor_label, 'deposit_' || v_dep, p_status, p_status,
      jsonb_build_object('amount_cents', coalesce(v.deposit_paid_cents, v.deposit_cents), 'from', v.deposit_status));
  end if;
  return v_dep;
end;
$$;

-- Closes a trade if it's in one of p_from_statuses (closed = false, changing
-- nothing, otherwise). deposit_after: what the deposit is now; refund_pending
-- means the server refunds it next. p_stage: for offer_expired and expired,
-- which deadline ran out.
create or replace function public.trade_close(
  p_trade_id uuid, p_status text, p_from_statuses text[], p_reason text, p_fault text,
  p_actor_type text, p_actor_id uuid, p_actor_label text, p_stage text default null
) returns table (closed boolean, deposit_after text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
  v_dep text;
begin
  perform public.trade_require_service_role();
  select * into v_trade from public.trade_requests t where t.id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if not (v_trade.status = any (p_from_statuses)) then
    return query select false, v_trade.deposit_status;
    return;
  end if;
  if p_stage is not null and p_stage not in ('draft', 'revision', 'confirmation', 'deposit', 'shipping', 'scan') then
    raise exception 'Not a deadline: %', p_stage using errcode = '22023';
  end if;
  v_dep := public.trade_close_core(p_trade_id, p_status, p_reason, p_fault, p_stage, p_actor_type, p_actor_id, p_actor_label);
  return query select true, v_dep;
end;
$$;

-- 13. Deadlines that ran out (the worker, every 5 minutes) --------------------------
-- A draft or revision not sent, or an approval not confirmed: offer_expired
-- (nothing was held). Reserved but no tracking number by ship_by, or a
-- tracking number with no carrier scan by ship_by plus p_scan_grace_hours
-- (only when tracking is checked automatically, so never for "Other"
-- carriers): expired, the reservation released and a paid deposit sent to
-- staff review. Never while anything is flagged for staff: proof of
-- shipping, a late or early scan, a number to check by hand.
-- An extension moves the deadline itself, so it's simply not due yet.
-- awaiting_deposit is handled by the server (it checks the payment first).
-- Idempotent; rows another run is working on are skipped.
create or replace function public.trade_expire_due(
  p_limit integer default 50, p_scan_grace_hours integer default 24, p_auto_tracking boolean default true
) returns table (expired_trade_id uuid, expired_trade_number bigint, expired_from_status text, expired_stage text, expired_deposit_status text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_to text;
  v_stage text;
  v_fault text;
  v_reason text;
  v_dep text;
begin
  perform public.trade_require_service_role();
  for r in
    select t.id, t.trade_number, t.status from public.trade_requests t
    where (
        (t.status in ('awaiting_trade_list', 'revision_requested') and t.list_due_at < now())
     or (t.status = 'awaiting_confirmation' and t.confirm_by < now())
     or (t.status = 'awaiting_shipment' and t.ship_by < now())
     or (coalesce(p_auto_tracking, false) and t.status = 'tracking_submitted' and t.inbound_accepted_at is null
         and t.inbound_carrier is distinct from 'Other'
         and t.ship_by + make_interval(hours => greatest(coalesce(p_scan_grace_hours, 0), 0)) < now())
    )
      -- Anything flagged for staff (a late or early scan, a number to check by
      -- hand, proof of shipping) waits for them.
      and t.review_flag is null
      and not exists (select 1 from public.trade_disputes d where d.trade_request_id = t.id and d.status = 'open')
    order by coalesce(t.ship_by, t.confirm_by, t.list_due_at)
    limit greatest(coalesce(p_limit, 50), 1)
    for update of t skip locked
  loop
    case r.status
      when 'awaiting_trade_list' then
        v_to := 'offer_expired'; v_stage := 'draft'; v_fault := null; v_reason := 'The trade list wasn''t sent in time.';
      when 'revision_requested' then
        v_to := 'offer_expired'; v_stage := 'revision'; v_fault := null; v_reason := 'The changes weren''t sent in time.';
      when 'awaiting_confirmation' then
        v_to := 'offer_expired'; v_stage := 'confirmation'; v_fault := null; v_reason := 'The approved trade wasn''t confirmed in time.';
      when 'awaiting_shipment' then
        v_to := 'expired'; v_stage := 'shipping'; v_fault := 'missed_deadline'; v_reason := 'No tracking number by the shipping deadline.';
      else
        v_to := 'expired'; v_stage := 'scan'; v_fault := 'missed_deadline'; v_reason := 'The carrier never scanned the package.';
    end case;
    v_dep := public.trade_close_core(r.id, v_to, v_reason, v_fault, v_stage, 'system', null, 'expiry');
    expired_trade_id := r.id; expired_trade_number := r.trade_number; expired_from_status := r.status;
    expired_stage := v_stage; expired_deposit_status := v_dep;
    return next;
  end loop;
end;
$$;

-- 14. The customer's list: saving it and sending it -----------------------------------
-- Saved whole. The server prices it just before (api/_lib/tradeCenter.ts
-- reads each printing from Scryfall or the card_printings cache and works
-- out the estimate and eligibility).
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
  if v_trade.list_due_at is not null and v_trade.list_due_at < now() then
    raise exception 'The time to update this trade ran out.' using errcode = 'GT012';
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
-- can take (the rest come off first). Nothing of ours is held.
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
  if v_trade.list_due_at is not null and v_trade.list_due_at < now() then
    raise exception 'The time to update this trade ran out.' using errcode = 'GT012';
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
    where trade_request_id = p_trade_id and status = 'requested';
  if v_wanted = 0 then
    raise exception 'Add at least one of our cards first.' using errcode = 'GT010';
  end if;

  update public.trade_requests set
    status = 'pending_review',
    submitted_at = now(),
    list_due_at = null,
    customer_note = coalesce(left(nullif(btrim(p_note), ''), 2000), customer_note)
  where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'customer', p_user_id, v_trade.customer_email,
    case when v_trade.status = 'revision_requested' then 'resubmitted' else 'submitted' end,
    v_trade.status, 'pending_review',
    jsonb_build_object('cards', v_cards, 'estimated_value_cents', v_trade.estimated_value_cents));
end;
$$;

-- 15. Staff review ---------------------------------------------------------------------
-- Card by card: approve (how many, at what value each) or reject, with a
-- note for the customer and one for staff only.
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

-- Staff send the trade back with what to change (also after approval, while
-- it waits for the customer; the server first retires any deposit payment
-- that hasn't gone through). They have revision_hours to send it again.
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
  if v_trade.status not in ('pending_review', 'awaiting_confirmation', 'awaiting_deposit') then
    raise exception 'Changes can be asked for before the trade is confirmed.' using errcode = 'GT009';
  end if;
  if nullif(btrim(p_message), '') is null then
    raise exception 'Tell the customer what to change.' using errcode = 'GT010';
  end if;
  v_due := now() + make_interval(hours => s.revision_hours);
  update public.trade_requests set
    status = 'revision_requested',
    list_due_at = v_due,
    deposit_status = case when deposit_status = 'payment_pending' then 'not_required' else deposit_status end,
    deposit_payment_intent = case when deposit_status = 'payment_pending' then null else deposit_payment_intent end
  where id = p_trade_id;
  insert into public.trade_messages (trade_request_id, author_type, author_id, author_label, body, visible_to_customer)
  values (p_trade_id, 'staff', p_actor_id, left(p_actor_label, 200), left(btrim(p_message), 4000), true);
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'revision_requested', v_trade.status, 'revision_requested',
    jsonb_build_object('list_due_at', v_due));
  return v_due;
end;
$$;

-- Approval: every card decided, at least one approved, our cards all still
-- available, and the address customers mail their cards to set (never
-- assumed). Nothing is held yet: the customer has until p_confirm_by
-- (confirmation_hours of qualifying time, worked out by the server) to
-- confirm and pay p_deposit_cents (0: none; worked out by the server from
-- the settings, the customer and this trade).
create or replace function public.trade_approve(
  p_trade_id uuid, p_confirm_by timestamptz, p_deposit_cents integer, p_deposit_reason text,
  p_conditions text, p_actor_id uuid, p_actor_label text
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
  v_short jsonb;
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
  if v_trade.deposit_status in ('refund_pending', 'refund_failed', 'forfeiture_review') then
    raise exception 'The refund of this trade''s earlier deposit isn''t finished. Settle it first (Deposits).' using errcode = 'GT009';
  end if;
  if nullif(btrim(s.ship_to_line1), '') is null or nullif(btrim(s.ship_to_city), '') is null
     or nullif(btrim(s.ship_to_state), '') is null or nullif(btrim(s.ship_to_postal_code), '') is null then
    raise exception 'Add the address customers mail their cards to (Trades, Settings) before approving a trade.' using errcode = 'GT011';
  end if;
  if p_confirm_by is null or p_confirm_by <= now() or p_confirm_by > now() + interval '30 days' then
    raise exception 'The confirmation deadline has to be in the next 30 days.' using errcode = 'GT010';
  end if;
  if p_deposit_cents is null or p_deposit_cents < 0 or p_deposit_cents > 100000 or (p_deposit_cents > 0 and p_deposit_cents < 50) then
    raise exception 'A deposit is 50 cents to $1,000, or none.' using errcode = 'GT010';
  end if;
  if p_deposit_cents > 0 and (p_deposit_reason is null or p_deposit_reason not in ('threshold', 'trade', 'customer', 'reliability')) then
    raise exception 'Say why this trade needs a deposit.' using errcode = 'GT010';
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
  if not exists (select 1 from public.trade_request_items where trade_request_id = p_trade_id and status = 'requested') then
    raise exception 'None of our cards are on this trade any more.' using errcode = 'GT010';
  end if;
  v_short := public.trade_short_lines(p_trade_id);
  if jsonb_array_length(v_short) > 0 then
    raise exception '% isn''t available in that quantity any more. Change our cards on the trade, or ask the customer to.',
      v_short->0->>'card_name' using errcode = 'GT004';
  end if;

  update public.trade_requests set
    status = 'awaiting_confirmation',
    approved_value_cents = v_value::int,
    approved_at = now(),
    confirm_by = p_confirm_by,
    confirm_by_original = p_confirm_by,
    deposit_cents = p_deposit_cents,
    deposit_reason = case when p_deposit_cents > 0 then p_deposit_reason end,
    deposit_status = case when p_deposit_cents > 0 then 'payment_pending' else 'not_required' end,
    deposit_payment_intent = null,
    deposit_paid_cents = null,
    deposit_paid_at = null,
    deposit_fee_cents = null,
    deposit_refund_id = null,
    deposit_refund_requested_at = null,
    deposit_refunded_at = null,
    deposit_refund_failure = null,
    approval_conditions = left(nullif(btrim(p_conditions), ''), 2000)
  where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'approved', v_trade.status, 'awaiting_confirmation',
    jsonb_build_object('approved_value_cents', v_value, 'confirm_by', p_confirm_by, 'deposit_cents', p_deposit_cents,
                       'deposit_reason', p_deposit_reason, 'conditions', nullif(btrim(p_conditions), '')));
  return v_value::int;
end;
$$;

-- Staff change whether this trade needs a deposit, before one is paid.
-- p_override: auto (follow the settings), required or waived; p_deposit_cents
-- is what that comes to (worked out by the server). While the customer is
-- paying, the server first retires their payment and the trade goes back to
-- waiting for their confirmation.
create or replace function public.trade_set_deposit(
  p_trade_id uuid, p_override text, p_deposit_cents integer, p_reason text, p_actor_id uuid, p_actor_label text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
begin
  perform public.trade_require_service_role();
  if p_override not in ('auto', 'required', 'waived') then
    raise exception 'Unknown deposit setting: %', p_override using errcode = 'GT010';
  end if;
  if p_deposit_cents is null or p_deposit_cents < 0 or p_deposit_cents > 100000 or (p_deposit_cents > 0 and p_deposit_cents < 50) then
    raise exception 'A deposit is 50 cents to $1,000, or none.' using errcode = 'GT010';
  end if;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.status not in ('awaiting_trade_list', 'pending_review', 'revision_requested', 'awaiting_confirmation', 'awaiting_deposit') then
    raise exception 'The deposit can be changed until it''s paid.' using errcode = 'GT009';
  end if;
  if v_trade.deposit_status not in ('not_required', 'payment_pending', 'canceled', 'refunded') then
    raise exception 'The deposit can be changed until it''s paid.' using errcode = 'GT009';
  end if;

  if v_trade.status in ('awaiting_confirmation', 'awaiting_deposit') then
    update public.trade_requests set
      status = 'awaiting_confirmation',
      deposit_override = p_override,
      deposit_cents = p_deposit_cents,
      deposit_reason = case when p_deposit_cents > 0 then coalesce(p_reason, deposit_reason, 'trade') end,
      deposit_status = case when p_deposit_cents > 0 then 'payment_pending' else 'not_required' end,
      deposit_payment_intent = null
    where id = p_trade_id;
  else
    update public.trade_requests set deposit_override = p_override where id = p_trade_id;
  end if;
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'deposit_requirement_changed', v_trade.status,
    case when v_trade.status = 'awaiting_deposit' then 'awaiting_confirmation' else v_trade.status end,
    jsonb_build_object('override', p_override, 'deposit_cents', p_deposit_cents, 'was_cents', v_trade.deposit_cents));
end;
$$;

-- One of our cards sold (or went off sale) while an approved trade waited
-- for the customer: back to them to update their selection, then to staff.
-- Returns the cards that are short, or null when nothing changed.
create or replace function public.trade_mark_unavailable(p_trade_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_short jsonb;
  v_names text;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found or v_trade.status not in ('awaiting_confirmation', 'awaiting_deposit') then
    return null;
  end if;
  v_short := public.trade_short_lines(p_trade_id);
  if jsonb_array_length(v_short) = 0 then
    return null;
  end if;
  select string_agg(case when (x->>'available')::int > 0
                         then format('%s (%s left of the %s you picked)', x->>'card_name', x->>'available', x->>'wanted')
                         else x->>'card_name' end, ', ')
    into v_names from jsonb_array_elements(v_short) x;
  update public.trade_requests set
    status = 'revision_requested',
    list_due_at = now() + make_interval(hours => s.revision_hours),
    deposit_status = case when deposit_status = 'payment_pending' then 'not_required' else deposit_status end,
    deposit_payment_intent = case when deposit_status = 'payment_pending' then null else deposit_payment_intent end
  where id = p_trade_id;
  insert into public.trade_messages (trade_request_id, author_type, body, visible_to_customer)
  values (p_trade_id, 'system',
    left(format('Some of our cards on this trade sold before it was confirmed: %s. Update which of our cards you''d like and send the trade again, and we''ll review it right away. Nothing was charged.', v_names), 4000),
    true);
  perform public.trade_log(p_trade_id, 'system', null, null, 'cards_unavailable', v_trade.status, 'revision_requested',
    jsonb_build_object('short', v_short));
  return v_short;
end;
$$;

-- 16. Confirming and reserving ---------------------------------------------------------
-- Holds every requested line, or none: each inventory row is locked (in id
-- order, as checkout does) and checked before anything is held, so two
-- trades, or a trade and a checkout, can never take the same copy. Returns
-- the lines that are short (nothing held), or null when all are held. The
-- caller holds the trade row lock.
create or replace function public.trade_reserve_core(p_trade_id uuid, p_trade_number bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_inv public.inventory_items%rowtype;
  v_free integer;
  v_short jsonb := '[]'::jsonb;
  v_res_id uuid;
begin
  for r in
    select i.* from public.trade_request_items i
    where i.trade_request_id = p_trade_id and i.status = 'requested'
    order by i.inventory_item_id
  loop
    select * into v_inv from public.inventory_items where id = r.inventory_item_id for update;
    v_free := public.trade_available(r.inventory_item_id, p_trade_id);
    if v_free < r.quantity then
      v_short := v_short || jsonb_build_array(jsonb_build_object(
        'item_id', r.id, 'inventory_item_id', r.inventory_item_id, 'card_name', r.card_name,
        'wanted', r.quantity, 'available', v_free));
    end if;
  end loop;
  if jsonb_array_length(v_short) > 0 then
    return v_short;
  end if;
  if not exists (select 1 from public.trade_request_items where trade_request_id = p_trade_id and status = 'requested') then
    return jsonb_build_array(jsonb_build_object('card_name', 'our cards', 'wanted', 1, 'available', 0));
  end if;

  for r in
    select i.* from public.trade_request_items i
    where i.trade_request_id = p_trade_id and i.status = 'requested'
    order by i.inventory_item_id
  loop
    insert into public.inventory_reservations (inventory_item_id, customer_id, quantity, note, reserved_by, trade_request_id)
    values (r.inventory_item_id, null, r.quantity, 'Trade TR-' || p_trade_number, 'trade', p_trade_id)
    returning id into v_res_id;
    update public.trade_request_items set status = 'reserved', reservation_id = v_res_id where id = r.id;
  end loop;
  return null;
end;
$$;

-- The customer confirms an approved trade, agreeing to the terms (a copy is
-- kept in trade_consents). With no deposit, their cards are reserved at once
-- (result reserved; ship_by worked out by the server from p_ship_days).
-- With a deposit, the trade waits for p_payment_intent to succeed
-- (result awaiting_deposit): nothing is held before the deposit is paid.
-- result unavailable: one of our cards sold first; the trade went back to the
-- customer (short_lines says which).
create or replace function public.trade_confirm(
  p_trade_id uuid, p_user_id uuid, p_terms_version integer, p_terms_text text,
  p_ship_days integer, p_ship_by timestamptz, p_payment_intent text, p_ip text, p_user_agent text
) returns table (result text, short_lines jsonb)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_short jsonb;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found or v_trade.user_id is distinct from p_user_id then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.status not in ('awaiting_confirmation', 'awaiting_deposit') then
    raise exception 'This trade isn''t waiting for your confirmation.' using errcode = 'GT009';
  end if;
  -- Confirming at the deadline itself still counts.
  if v_trade.confirm_by is null or now() > v_trade.confirm_by then
    raise exception 'The time to confirm this trade ran out.' using errcode = 'GT012';
  end if;
  if p_terms_version is null or nullif(btrim(p_terms_text), '') is null then
    raise exception 'Agree to the deposit and cancellation terms first.' using errcode = 'GT010';
  end if;
  if p_ship_days is null or p_ship_days < 1 or p_ship_days > 30 then
    raise exception 'The shipping window didn''t come through.' using errcode = 'GT010';
  end if;

  v_short := public.trade_short_lines(p_trade_id);
  if jsonb_array_length(v_short) > 0 then
    perform public.trade_mark_unavailable(p_trade_id);
    return query select 'unavailable'::text, v_short;
    return;
  end if;

  insert into public.trade_consents (trade_request_id, user_id, terms_version, terms_text, deposit_cents, ship_days, confirm_by, ip, user_agent)
  values (p_trade_id, p_user_id, p_terms_version, left(p_terms_text, 6000), v_trade.deposit_cents, p_ship_days,
          v_trade.confirm_by, left(p_ip, 100), left(p_user_agent, 400));

  if v_trade.deposit_cents > 0 then
    if p_payment_intent is null or p_payment_intent !~ '^pi_[A-Za-z0-9_]{1,250}$' then
      raise exception 'The deposit payment didn''t start. Try again.' using errcode = 'GT010';
    end if;
    update public.trade_requests set
      status = 'awaiting_deposit',
      deposit_status = 'payment_pending',
      deposit_payment_intent = p_payment_intent,
      confirmed_at = now(),
      ship_days = p_ship_days
    where id = p_trade_id;
    perform public.trade_log(p_trade_id, 'customer', p_user_id, v_trade.customer_email, 'deposit_payment_started',
      v_trade.status, 'awaiting_deposit',
      jsonb_build_object('deposit_cents', v_trade.deposit_cents, 'payment_intent', p_payment_intent, 'terms_version', p_terms_version));
    return query select 'awaiting_deposit'::text, null::jsonb;
    return;
  end if;

  if p_ship_by is null or p_ship_by <= now() or p_ship_by > now() + interval '60 days' then
    raise exception 'The shipping deadline didn''t come through.' using errcode = 'GT010';
  end if;
  v_short := public.trade_reserve_core(p_trade_id, v_trade.trade_number);
  if v_short is not null then
    perform public.trade_mark_unavailable(p_trade_id);
    return query select 'unavailable'::text, v_short;
    return;
  end if;
  update public.trade_requests set
    status = 'awaiting_shipment',
    confirmed_at = now(),
    reserved_at = now(),
    ship_days = p_ship_days,
    ship_by = p_ship_by,
    ship_by_original = p_ship_by
  where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'customer', p_user_id, v_trade.customer_email, 'reserved', v_trade.status, 'awaiting_shipment',
    jsonb_build_object('ship_by', p_ship_by, 'ship_days', p_ship_days, 'deposit_cents', 0, 'terms_version', p_terms_version,
                       'lines', (select jsonb_agg(jsonb_build_object('card_name', i.card_name, 'quantity', i.quantity, 'reservation_id', i.reservation_id))
                                 from public.trade_request_items i where i.trade_request_id = p_trade_id and i.status = 'reserved')));
  return query select 'reserved'::text, null::jsonb;
end;
$$;

-- The deposit payment succeeded (the trade page or the Stripe webhook,
-- whichever is first; idempotent): reserve the cards, all or none.
-- result: reserved; already (this payment was handled); conflict (a card
-- sold first: nothing held, the trade went back to the customer, and the
-- deposit is to be refunded); refund (the trade no longer waits for this
-- deposit, or it's short: to be refunded); other_payment (not this trade's
-- current deposit payment: the server refunds that payment on its own).
create or replace function public.trade_reserve(
  p_trade_id uuid, p_payment_intent text, p_paid_cents integer, p_ship_days integer, p_ship_by timestamptz
) returns table (result text, short_lines jsonb)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_short jsonb;
  v_names text;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.deposit_payment_intent is distinct from p_payment_intent then
    return query select 'other_payment'::text, null::jsonb;
    return;
  end if;
  if v_trade.deposit_paid_at is not null then
    return query select 'already'::text, null::jsonb;
    return;
  end if;

  if v_trade.status <> 'awaiting_deposit' or coalesce(p_paid_cents, 0) < v_trade.deposit_cents then
    update public.trade_requests set
      deposit_status = 'refund_pending',
      deposit_paid_cents = coalesce(p_paid_cents, 0),
      deposit_paid_at = now(),
      deposit_refund_requested_at = now()
    where id = p_trade_id;
    perform public.trade_log(p_trade_id, 'system', null, null, 'deposit_paid_unusable', v_trade.status, v_trade.status,
      jsonb_build_object('amount_cents', p_paid_cents, 'payment_intent', p_payment_intent,
                         'why', case when v_trade.status <> 'awaiting_deposit' then 'not_waiting' else 'short' end));
    return query select 'refund'::text, null::jsonb;
    return;
  end if;
  if p_ship_days is null or p_ship_days < 1 or p_ship_days > 30
     or p_ship_by is null or p_ship_by <= now() or p_ship_by > now() + interval '60 days' then
    raise exception 'The shipping deadline didn''t come through.' using errcode = 'GT010';
  end if;

  v_short := public.trade_reserve_core(p_trade_id, v_trade.trade_number);
  if v_short is not null then
    select string_agg(x->>'card_name', ', ') into v_names from jsonb_array_elements(v_short) x;
    update public.trade_requests set
      status = 'revision_requested',
      list_due_at = now() + make_interval(hours => s.revision_hours),
      deposit_status = 'refund_pending',
      deposit_paid_cents = p_paid_cents,
      deposit_paid_at = now(),
      deposit_refund_requested_at = now()
    where id = p_trade_id;
    insert into public.trade_messages (trade_request_id, author_type, body, visible_to_customer)
    values (p_trade_id, 'system',
      left(format('Some of our cards sold just before your deposit went through: %s. Nothing was reserved, and your deposit is being refunded in full. Update which of our cards you''d like and send the trade again.', v_names), 4000),
      true);
    perform public.trade_log(p_trade_id, 'system', null, null, 'reservation_conflict', 'awaiting_deposit', 'revision_requested',
      jsonb_build_object('short', v_short, 'amount_cents', p_paid_cents, 'payment_intent', p_payment_intent));
    return query select 'conflict'::text, v_short;
    return;
  end if;

  update public.trade_requests set
    status = 'awaiting_shipment',
    reserved_at = now(),
    ship_days = p_ship_days,
    ship_by = p_ship_by,
    ship_by_original = p_ship_by,
    deposit_status = 'paid',
    deposit_paid_cents = p_paid_cents,
    deposit_paid_at = now()
  where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'customer', v_trade.user_id, v_trade.customer_email, 'deposit_paid', 'awaiting_deposit', 'awaiting_shipment',
    jsonb_build_object('amount_cents', p_paid_cents, 'payment_intent', p_payment_intent));
  perform public.trade_log(p_trade_id, 'system', null, null, 'reserved', 'awaiting_deposit', 'awaiting_shipment',
    jsonb_build_object('ship_by', p_ship_by, 'ship_days', p_ship_days, 'deposit_cents', p_paid_cents,
                       'lines', (select jsonb_agg(jsonb_build_object('card_name', i.card_name, 'quantity', i.quantity, 'reservation_id', i.reservation_id))
                                 from public.trade_request_items i where i.trade_request_id = p_trade_id and i.status = 'reserved')));
  return query select 'reserved'::text, null::jsonb;
end;
$$;

-- 17. Their package ----------------------------------------------------------------------
-- A tracking number (checked for its carrier's format by the server). It
-- doesn't count as shipped: only the carrier's acceptance scan does. The
-- same number on another customer's trade is refused.
-- result: added, changed (a different number: the scans start over), unchanged.
create or replace function public.trade_record_tracking(
  p_trade_id uuid, p_carrier text, p_tracking text, p_actor_type text, p_actor_id uuid, p_actor_label text
) returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
  v_result text;
begin
  perform public.trade_require_service_role();
  if p_carrier is null or p_carrier not in ('USPS', 'UPS', 'FedEx', 'Other') then
    raise exception 'Choose the carrier.' using errcode = 'GT010';
  end if;
  if p_tracking is null or p_tracking !~ '^[A-Z0-9]{8,40}$' then
    raise exception 'That tracking number doesn''t look right. Check it and try again.' using errcode = 'GT010';
  end if;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.status not in ('awaiting_shipment', 'tracking_submitted') then
    raise exception 'Add a tracking number once your cards are reserved, before the carrier scans them.' using errcode = 'GT009';
  end if;
  if v_trade.inbound_tracking = p_tracking and v_trade.inbound_carrier = p_carrier then
    return 'unchanged';
  end if;
  if exists (select 1 from public.trade_requests t
             where t.inbound_tracking = p_tracking and t.user_id <> v_trade.user_id) then
    raise exception 'That tracking number is already on another trade. Check the number, or message us.' using errcode = 'GT010';
  end if;
  v_result := case when v_trade.inbound_tracking is null then 'added' else 'changed' end;
  update public.trade_requests set
    status = 'tracking_submitted',
    inbound_carrier = p_carrier,
    inbound_tracking = p_tracking,
    inbound_tracking_added_at = now(),
    inbound_tracker_id = null,
    inbound_tracking_status = null,
    inbound_tracking_events = '[]'::jsonb,
    inbound_tracking_checked_at = null,
    inbound_last_event_at = null,
    inbound_accepted_at = null,
    inbound_acceptance_source = null,
    shipped_on_time = null,
    review_flag = case when review_flag in ('late_acceptance', 'early_scan', 'tracking_check') then null else review_flag end
  where id = p_trade_id;
  perform public.trade_log(p_trade_id, p_actor_type, p_actor_id, p_actor_label,
    case when v_result = 'added' then 'tracking_added' else 'tracking_changed' end,
    v_trade.status, 'tracking_submitted',
    jsonb_build_object('carrier', p_carrier, 'tracking', p_tracking, 'was', v_trade.inbound_tracking));
  return v_result;
end;
$$;

-- What the carrier says (the worker, from the tracking service). Keeps the
-- history; then:
--   * the first acceptance scan, by ship_by: shipped on time (in_transit),
--     and a paid deposit is to be refunded (refund_pending). result verified
--   * the first scan after ship_by (inside the grace window): staff decide
--     (review_flag late_acceptance), nothing released. result late
--   * a first scan from before the trade was approved (an old package?):
--     staff check it (review_flag early_scan). result early
--   * delivered, once in transit: received. result delivered
-- p_events: the full history, oldest first. p_accepted_at: the first scan
-- that means the carrier had the package (a label being made doesn't).
create or replace function public.trade_record_scan(
  p_trade_id uuid, p_tracking text, p_tracker_id text, p_status text, p_events jsonb,
  p_accepted_at timestamptz, p_delivered_at timestamptz, p_last_event_at timestamptz
) returns text
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
  if v_trade.inbound_tracking is distinct from p_tracking then
    return 'stale';
  end if;
  update public.trade_requests set
    inbound_tracker_id = coalesce(left(p_tracker_id, 100), inbound_tracker_id),
    inbound_tracking_status = left(p_status, 40),
    inbound_tracking_events = case when jsonb_typeof(p_events) = 'array' then p_events else inbound_tracking_events end,
    inbound_tracking_checked_at = now(),
    inbound_last_event_at = coalesce(p_last_event_at, inbound_last_event_at)
  where id = p_trade_id;

  if v_trade.status = 'tracking_submitted' and p_accepted_at is not null
     and v_trade.review_flag is distinct from 'late_acceptance' and v_trade.review_flag is distinct from 'early_scan' then
    if v_trade.approved_at is not null and p_accepted_at < v_trade.approved_at then
      update public.trade_requests set inbound_accepted_at = p_accepted_at, inbound_acceptance_source = 'carrier',
        review_flag = 'early_scan', review_flag_at = now()
      where id = p_trade_id;
      perform public.trade_log(p_trade_id, 'system', null, 'tracking', 'early_scan', v_trade.status, v_trade.status,
        jsonb_build_object('accepted_at', p_accepted_at, 'approved_at', v_trade.approved_at));
      return 'early';
    end if;
    if p_accepted_at <= v_trade.ship_by then
      update public.trade_requests set
        status = 'in_transit',
        inbound_accepted_at = p_accepted_at,
        inbound_acceptance_source = 'carrier',
        shipped_on_time = true,
        review_flag = case when review_flag = 'tracking_check' then null else review_flag end,
        deposit_status = case when deposit_status = 'paid' then 'refund_pending' else deposit_status end,
        deposit_refund_requested_at = case when deposit_status = 'paid' then now() else deposit_refund_requested_at end
      where id = p_trade_id;
      perform public.trade_log(p_trade_id, 'system', null, 'tracking', 'shipment_verified', v_trade.status, 'in_transit',
        jsonb_build_object('accepted_at', p_accepted_at, 'ship_by', v_trade.ship_by, 'source', 'carrier',
                           'deposit_refund', v_trade.deposit_status = 'paid'));
      return 'verified';
    end if;
    update public.trade_requests set
      inbound_accepted_at = p_accepted_at,
      inbound_acceptance_source = 'carrier',
      review_flag = 'late_acceptance',
      review_flag_at = now()
    where id = p_trade_id;
    perform public.trade_log(p_trade_id, 'system', null, 'tracking', 'late_acceptance', v_trade.status, v_trade.status,
      jsonb_build_object('accepted_at', p_accepted_at, 'ship_by', v_trade.ship_by));
    return 'late';
  end if;

  if v_trade.status = 'in_transit' and p_delivered_at is not null then
    update public.trade_requests set status = 'received', inbound_delivered_at = p_delivered_at,
      received_at = coalesce(received_at, now())
    where id = p_trade_id;
    perform public.trade_log(p_trade_id, 'system', null, 'tracking', 'delivered', v_trade.status, 'received',
      jsonb_build_object('delivered_at', p_delivered_at));
    return 'delivered';
  end if;
  if p_delivered_at is not null and v_trade.inbound_delivered_at is null then
    update public.trade_requests set inbound_delivered_at = p_delivered_at where id = p_trade_id;
  end if;
  return 'updated';
end;
$$;

-- Staff verify the shipment by hand (automation unavailable, a scan that
-- needs a decision, or proof of shipping): the package was accepted at
-- p_accepted_at. p_on_time: count it as shipped on time (refund the deposit).
-- Otherwise it's a late shipment: the trade carries on (their cards are
-- coming), and p_refund decides between refunding the deposit anyway and
-- sending it to review. Returns the deposit status it left.
create or replace function public.trade_verify_shipment(
  p_trade_id uuid, p_accepted_at timestamptz, p_on_time boolean, p_refund boolean, p_note text,
  p_actor_id uuid, p_actor_label text
) returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
  v_dep text;
begin
  perform public.trade_require_service_role();
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.status not in ('awaiting_shipment', 'tracking_submitted') then
    raise exception 'Verify a shipment while the trade waits for one.' using errcode = 'GT009';
  end if;
  if p_accepted_at is null or p_accepted_at > now() + interval '5 minutes' then
    raise exception 'When did the carrier accept it? That date can''t be in the future.' using errcode = 'GT010';
  end if;
  v_dep := case
    when v_trade.deposit_status <> 'paid' then v_trade.deposit_status
    when coalesce(p_on_time, false) or coalesce(p_refund, false) then 'refund_pending'
    else 'forfeiture_review'
  end;
  update public.trade_requests set
    status = 'in_transit',
    inbound_accepted_at = p_accepted_at,
    inbound_acceptance_source = 'staff',
    shipped_on_time = coalesce(p_on_time, false),
    customer_fault = case when coalesce(p_on_time, false) then customer_fault else 'late_shipment' end,
    fault_at = case when coalesce(p_on_time, false) then fault_at else now() end,
    review_flag = null,
    review_flag_at = null,
    deposit_status = v_dep,
    deposit_refund_requested_at = case when v_dep = 'refund_pending' and v_trade.deposit_status <> 'refund_pending' then now() else deposit_refund_requested_at end
  where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'shipment_verified', v_trade.status, 'in_transit',
    jsonb_build_object('accepted_at', p_accepted_at, 'ship_by', v_trade.ship_by, 'source', 'staff',
                       'on_time', coalesce(p_on_time, false), 'deposit_from', v_trade.deposit_status, 'deposit_to', v_dep,
                       'note', nullif(btrim(p_note), '')));
  return v_dep;
end;
$$;

-- Their package arrived. Before a verified scan that also proves they
-- shipped while the reservation stood, so the deposit is refunded. A first
-- scan after the deadline has to be decided first (trade_verify_shipment).
-- Returns the deposit status it left.
create or replace function public.trade_mark_received(p_trade_id uuid, p_actor_id uuid, p_actor_label text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
  v_verify boolean;
  v_dep text;
begin
  perform public.trade_require_service_role();
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.status not in ('awaiting_shipment', 'tracking_submitted', 'in_transit') then
    raise exception 'Only a trade waiting for its package can be marked received.' using errcode = 'GT009';
  end if;
  -- A first scan after the deadline is staff's call (on time or late, and
  -- the deposit with it): arriving doesn't settle it.
  if v_trade.status in ('awaiting_shipment', 'tracking_submitted') and v_trade.inbound_accepted_at is not null
     and v_trade.ship_by is not null and v_trade.inbound_accepted_at > v_trade.ship_by then
    raise exception 'The carrier''s first scan came after the shipping deadline. Verify the shipment (on time or late) first, then mark it received.'
      using errcode = 'GT009';
  end if;
  -- Otherwise, arriving proves it shipped while the reservation stood.
  v_verify := v_trade.status in ('awaiting_shipment', 'tracking_submitted');
  v_dep := case when v_verify and v_trade.deposit_status = 'paid' then 'refund_pending' else v_trade.deposit_status end;
  update public.trade_requests set
    status = 'received',
    received_at = now(),
    inbound_accepted_at = case when v_verify then coalesce(inbound_accepted_at, now()) else inbound_accepted_at end,
    inbound_acceptance_source = case when v_verify then coalesce(inbound_acceptance_source, 'received') else inbound_acceptance_source end,
    shipped_on_time = case when v_verify then coalesce(shipped_on_time, true) else shipped_on_time end,
    review_flag = case when review_flag in ('tracking_check', 'early_scan') then null else review_flag end,
    deposit_status = v_dep,
    deposit_refund_requested_at = case when v_dep = 'refund_pending' and v_trade.deposit_status <> 'refund_pending' then now() else deposit_refund_requested_at end
  where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'received', v_trade.status, 'received',
    jsonb_build_object('deposit_from', v_trade.deposit_status, 'deposit_to', v_dep, 'verified_by_arrival', v_verify));
  return v_dep;
end;
$$;

-- Staff give more time on the current deadline: p_kind list (a draft or
-- revision), confirmation, shipping or payment, to p_new_deadline (worked out
-- by the server in qualifying time). Recorded in trade_extensions.
create or replace function public.trade_extend(
  p_trade_id uuid, p_kind text, p_new_deadline timestamptz, p_hours integer, p_customer_requested boolean,
  p_reason text, p_actor_id uuid, p_actor_label text
) returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
  v_old timestamptz;
begin
  perform public.trade_require_service_role();
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if p_kind = 'list' and v_trade.status in ('awaiting_trade_list', 'revision_requested') then
    v_old := v_trade.list_due_at;
  elsif p_kind = 'confirmation' and v_trade.status in ('awaiting_confirmation', 'awaiting_deposit') then
    v_old := v_trade.confirm_by;
  elsif p_kind = 'shipping' and v_trade.status in ('awaiting_shipment', 'tracking_submitted') then
    v_old := v_trade.ship_by;
  elsif p_kind = 'payment' and v_trade.status = 'awaiting_payment' then
    v_old := v_trade.payment_due_at;
  else
    raise exception 'This trade has no % deadline to extend.', p_kind using errcode = 'GT009';
  end if;
  if p_new_deadline is null or p_new_deadline <= now() or (v_old is not null and p_new_deadline <= v_old)
     or p_new_deadline > now() + interval '60 days' then
    raise exception 'The new deadline has to be later than the current one, and within 60 days.' using errcode = 'GT010';
  end if;

  update public.trade_requests set
    list_due_at = case when p_kind = 'list' then p_new_deadline else list_due_at end,
    confirm_by = case when p_kind = 'confirmation' then p_new_deadline else confirm_by end,
    ship_by = case when p_kind = 'shipping' then p_new_deadline else ship_by end,
    payment_due_at = case when p_kind = 'payment' then p_new_deadline else payment_due_at end,
    review_flag = case when p_kind = 'shipping' and review_flag = 'tracking_check' then null else review_flag end
  where id = p_trade_id;
  insert into public.trade_extensions (trade_request_id, kind, from_deadline, to_deadline, hours, customer_requested, reason, created_by, created_by_label)
  values (p_trade_id, p_kind, v_old, p_new_deadline, p_hours, coalesce(p_customer_requested, false),
          left(nullif(btrim(p_reason), ''), 1000), p_actor_id, left(p_actor_label, 200));
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'deadline_extended', v_trade.status, v_trade.status,
    jsonb_build_object('kind', p_kind, 'from', v_old, 'to', p_new_deadline, 'hours', p_hours,
                       'customer_requested', coalesce(p_customer_requested, false), 'reason', nullif(btrim(p_reason), '')));
  return p_new_deadline;
end;
$$;

-- An expired reservation brought back (staff: proof of shipping, a late
-- scan they accept, a mistake). Every released line is held again, or none
-- (result unavailable). p_mode: awaiting_shipment (more time: p_ship_by),
-- in_transit (they did ship: accepted at p_accepted_at, deposit refunded),
-- or received (the package is here: deposit refunded).
create or replace function public.trade_reinstate(
  p_trade_id uuid, p_mode text, p_ship_by timestamptz, p_accepted_at timestamptz, p_clear_fault boolean,
  p_actor_id uuid, p_actor_label text
) returns table (result text, short_lines jsonb)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
  v_short jsonb := '[]'::jsonb;
  v_free integer;
  v_inv public.inventory_items%rowtype;
  v_res_id uuid;
  v_dep text;
  r record;
begin
  perform public.trade_require_service_role();
  if p_mode not in ('awaiting_shipment', 'in_transit', 'received') then
    raise exception 'Unknown way to reinstate: %', p_mode using errcode = 'GT010';
  end if;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.status <> 'expired' then
    raise exception 'Only an expired reservation can be reinstated.' using errcode = 'GT009';
  end if;
  if p_mode = 'awaiting_shipment' and (p_ship_by is null or p_ship_by <= now() or p_ship_by > now() + interval '60 days') then
    raise exception 'Give them a new shipping deadline in the next 60 days.' using errcode = 'GT010';
  end if;
  if p_mode = 'in_transit' and (p_accepted_at is null or p_accepted_at > now() + interval '5 minutes') then
    raise exception 'When did the carrier accept it?' using errcode = 'GT010';
  end if;

  for r in select i.* from public.trade_request_items i
           where i.trade_request_id = p_trade_id and i.status = 'released' order by i.inventory_item_id loop
    select * into v_inv from public.inventory_items where id = r.inventory_item_id for update;
    v_free := public.trade_available(r.inventory_item_id, p_trade_id);
    if v_free < r.quantity then
      v_short := v_short || jsonb_build_array(jsonb_build_object(
        'item_id', r.id, 'inventory_item_id', r.inventory_item_id, 'card_name', r.card_name,
        'wanted', r.quantity, 'available', v_free));
    end if;
  end loop;
  if jsonb_array_length(v_short) > 0 then
    return query select 'unavailable'::text, v_short;
    return;
  end if;
  for r in select i.* from public.trade_request_items i
           where i.trade_request_id = p_trade_id and i.status = 'released' order by i.inventory_item_id loop
    insert into public.inventory_reservations (inventory_item_id, customer_id, quantity, note, reserved_by, trade_request_id)
    values (r.inventory_item_id, null, r.quantity, 'Trade TR-' || v_trade.trade_number, 'trade', p_trade_id)
    returning id into v_res_id;
    update public.trade_request_items set status = 'reserved', reservation_id = v_res_id where id = r.id;
  end loop;

  v_dep := case
    when v_trade.deposit_status in ('forfeiture_review', 'paid') and p_mode = 'awaiting_shipment' then 'paid'
    when v_trade.deposit_status in ('forfeiture_review', 'paid') then 'refund_pending'
    else v_trade.deposit_status
  end;
  update public.trade_requests set
    status = p_mode,
    closed_at = null,
    close_reason = null,
    expired_stage = null,
    return_status = 'none',
    review_flag = null,
    review_flag_at = null,
    ship_by = case when p_mode = 'awaiting_shipment' then p_ship_by else ship_by end,
    inbound_accepted_at = case when p_mode = 'in_transit' then p_accepted_at
                               when p_mode = 'received' then coalesce(inbound_accepted_at, now())
                               else inbound_accepted_at end,
    inbound_acceptance_source = case when p_mode = 'in_transit' then 'staff'
                                     when p_mode = 'received' then coalesce(inbound_acceptance_source, 'received')
                                     else inbound_acceptance_source end,
    shipped_on_time = case when p_mode in ('in_transit', 'received') then true else shipped_on_time end,
    received_at = case when p_mode = 'received' then now() else received_at end,
    customer_fault = case when coalesce(p_clear_fault, false) then null else customer_fault end,
    fault_at = case when coalesce(p_clear_fault, false) then null else fault_at end,
    deposit_status = v_dep,
    deposit_refund_requested_at = case when v_dep = 'refund_pending' and v_trade.deposit_status <> 'refund_pending' then now() else deposit_refund_requested_at end
  where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'reinstated', 'expired', p_mode,
    jsonb_build_object('mode', p_mode, 'ship_by', p_ship_by, 'accepted_at', p_accepted_at,
                       'fault_cleared', coalesce(p_clear_fault, false), 'deposit_from', v_trade.deposit_status, 'deposit_to', v_dep));
  return query select 'reinstated'::text, null::jsonb;
end;
$$;

-- 18. Proof of shipping ------------------------------------------------------------------
-- The customer says they shipped in time but the carrier didn't scan it:
-- their note and files (already uploaded to trade-dispute-files). While it's
-- open, the reservation never expires. Allowed while waiting for a shipment,
-- or for dispute_window_days after one expired.
create or replace function public.trade_open_dispute(p_trade_id uuid, p_user_id uuid, p_note text, p_files jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_id uuid;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found or v_trade.user_id is distinct from p_user_id then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if not (v_trade.status in ('awaiting_shipment', 'tracking_submitted')
          or (v_trade.status = 'expired' and v_trade.closed_at > now() - make_interval(days => s.dispute_window_days))) then
    raise exception 'Proof of shipping can be sent while we wait for your package, or soon after a reservation expires.' using errcode = 'GT009';
  end if;
  if nullif(btrim(p_note), '') is null then
    raise exception 'Tell us when and where you shipped your cards.' using errcode = 'GT010';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) > 5 then
    raise exception 'Attach up to 5 files.' using errcode = 'GT010';
  end if;
  if exists (select 1 from public.trade_disputes where trade_request_id = p_trade_id and status = 'open') then
    raise exception 'We already have your proof of shipping and are looking at it.' using errcode = 'GT009';
  end if;
  insert into public.trade_disputes (trade_request_id, user_id, note, files)
  values (p_trade_id, p_user_id, left(btrim(p_note), 4000), p_files)
  returning id into v_id;
  update public.trade_requests set review_flag = 'dispute', review_flag_at = now() where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'customer', p_user_id, v_trade.customer_email, 'dispute_opened', v_trade.status, v_trade.status,
    jsonb_build_object('dispute_id', v_id, 'files', jsonb_array_length(p_files)));
  return v_id;
end;
$$;

-- Staff decide on proof of shipping: accepted (then extend, verify or
-- reinstate, as fits) or rejected (the deadline stands; an overdue
-- reservation expires on the worker's next run).
create or replace function public.trade_resolve_dispute(
  p_dispute_id uuid, p_outcome text, p_note text, p_actor_id uuid, p_actor_label text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_dispute public.trade_disputes%rowtype;
  v_trade public.trade_requests%rowtype;
begin
  perform public.trade_require_service_role();
  if p_outcome not in ('accepted', 'rejected') then
    raise exception 'Accept or reject it.' using errcode = 'GT010';
  end if;
  select * into v_dispute from public.trade_disputes where id = p_dispute_id;
  if not found then
    raise exception 'That proof of shipping isn''t there.' using errcode = 'GT404';
  end if;
  select * into v_trade from public.trade_requests where id = v_dispute.trade_request_id for update;
  select * into v_dispute from public.trade_disputes where id = p_dispute_id for update;
  if v_dispute.status <> 'open' then
    raise exception 'That proof of shipping was already decided.' using errcode = 'GT009';
  end if;
  update public.trade_disputes set status = p_outcome, staff_note = left(nullif(btrim(p_note), ''), 2000),
    resolved_by = p_actor_id, resolved_by_label = left(p_actor_label, 200), resolved_at = now()
  where id = p_dispute_id;
  -- The proof is decided; a carrier scan still waiting on a decision (an
  -- early or late first scan) keeps the trade with staff.
  update public.trade_requests set
    review_flag = case
      when review_flag is distinct from 'dispute' then review_flag
      when status = 'tracking_submitted' and inbound_accepted_at is not null and approved_at is not null
           and inbound_accepted_at < approved_at then 'early_scan'
      when status = 'tracking_submitted' and inbound_accepted_at is not null and ship_by is not null
           and inbound_accepted_at > ship_by then 'late_acceptance'
      else null end,
    review_flag_at = case
      when review_flag is distinct from 'dispute' then review_flag_at
      when status = 'tracking_submitted' and inbound_accepted_at is not null
           and ((approved_at is not null and inbound_accepted_at < approved_at) or (ship_by is not null and inbound_accepted_at > ship_by)) then now()
      else null end
  where id = v_trade.id;
  perform public.trade_log(v_trade.id, 'staff', p_actor_id, p_actor_label, 'dispute_' || p_outcome, v_trade.status, v_trade.status,
    jsonb_build_object('dispute_id', p_dispute_id, 'note', nullif(btrim(p_note), '')));
  return v_trade.id;
end;
$$;

-- 19. The deposit's life after it's paid --------------------------------------------------
-- Moves it on, and only along these paths (anything else is refused):
--   paid | forfeiture_review | refund_failed → refund_pending   a refund is due
--       (from refund_failed it's a new attempt: a new refund, a new key;
--       staff can also refund a deposit they kept: forfeited → refund_pending)
--   refund_pending → refund_pending   the refund was created (p_refund_id)
--   refund_pending → refunded | refund_failed   what the payment processor says
--   forfeiture_review → forfeited   staff, only with allow_forfeiture on
-- Returns false when the deposit was already there (a retried webhook).
create or replace function public.trade_deposit_update(
  p_trade_id uuid, p_to text, p_refund_id text, p_failure text, p_note text,
  p_actor_type text, p_actor_id uuid, p_actor_label text
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_from text;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  v_from := v_trade.deposit_status;

  if p_to = 'refund_pending' and v_from in ('paid', 'forfeiture_review', 'refund_failed')
     or (p_to = 'refund_pending' and v_from = 'forfeited' and p_actor_type = 'staff') then
    update public.trade_requests set
      deposit_status = 'refund_pending',
      deposit_refund_requested_at = now(),
      deposit_refund_failure = null,
      deposit_refund_id = null,
      deposit_refund_attempts = case when v_from = 'refund_failed' then deposit_refund_attempts + 1 else deposit_refund_attempts end,
      deposit_decided_at = case when p_actor_type = 'staff' then now() else deposit_decided_at end,
      deposit_decided_by = case when p_actor_type = 'staff' then left(p_actor_label, 200) else deposit_decided_by end,
      deposit_decision_note = case when p_actor_type = 'staff' then left(nullif(btrim(p_note), ''), 2000) else deposit_decision_note end
    where id = p_trade_id;
  elsif p_to = 'refund_pending' and v_from = 'refund_pending' then
    if p_refund_id is null or v_trade.deposit_refund_id is not distinct from p_refund_id then
      return false;
    end if;
    update public.trade_requests set deposit_refund_id = left(p_refund_id, 255) where id = p_trade_id;
  elsif p_to = 'refunded' and v_from = 'refund_pending' then
    update public.trade_requests set deposit_status = 'refunded', deposit_refunded_at = now(),
      deposit_refund_id = coalesce(left(p_refund_id, 255), deposit_refund_id), deposit_refund_failure = null
    where id = p_trade_id;
  elsif p_to = 'refund_failed' and v_from = 'refund_pending' then
    update public.trade_requests set deposit_status = 'refund_failed',
      deposit_refund_id = coalesce(left(p_refund_id, 255), deposit_refund_id),
      deposit_refund_failure = left(coalesce(nullif(btrim(p_failure), ''), 'unknown'), 500)
    where id = p_trade_id;
  elsif p_to = 'forfeited' and v_from = 'forfeiture_review' then
    if not s.allow_forfeiture then
      raise exception 'Keeping deposits is turned off (Trades, Settings). Refund this one, or turn it on after checking your cancellation terms.' using errcode = 'GT009';
    end if;
    if p_actor_type <> 'staff' then
      raise exception 'Only staff can keep a deposit.' using errcode = '42501';
    end if;
    update public.trade_requests set deposit_status = 'forfeited', deposit_decided_at = now(),
      deposit_decided_by = left(p_actor_label, 200), deposit_decision_note = left(nullif(btrim(p_note), ''), 2000)
    where id = p_trade_id;
  elsif p_to = v_from then
    return false;
  else
    raise exception 'The deposit can''t go from % to %.', v_from, p_to using errcode = 'GT009';
  end if;

  perform public.trade_log(p_trade_id, p_actor_type, p_actor_id, p_actor_label,
    case when p_to = 'refund_pending' and v_from = 'refund_pending' then 'deposit_refund_created' else 'deposit_' || p_to end,
    v_trade.status, v_trade.status,
    jsonb_build_object('from', v_from, 'to', p_to, 'amount_cents', coalesce(v_trade.deposit_paid_cents, v_trade.deposit_cents),
                       'refund_id', coalesce(p_refund_id, v_trade.deposit_refund_id), 'failure', p_failure,
                       'note', nullif(btrim(p_note), '')));
  return true;
end;
$$;

-- Staff clear a customer-caused fault (it no longer counts against them).
create or replace function public.trade_clear_fault(p_trade_id uuid, p_actor_id uuid, p_actor_label text)
returns void
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
  if v_trade.customer_fault is null or v_trade.fault_cleared_at is not null then
    raise exception 'Nothing on this trade counts against the customer.' using errcode = 'GT009';
  end if;
  update public.trade_requests set fault_cleared_at = now(), fault_cleared_by = left(p_actor_label, 200)
    where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'fault_cleared', v_trade.status, v_trade.status,
    jsonb_build_object('fault', v_trade.customer_fault));
end;
$$;

-- 20. Inspection and the final offer --------------------------------------------------
-- What arrived: how many, real or not, the condition we see, and what each
-- is worth now. Can be saved as often as needed.
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
-- credit beyond the order. Every card that changed from what was approved
-- needs its reason (a note, a flag or the condition seen), so the customer
-- sees why. Shipping on our cards mirrors checkout.
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
  v_unexplained text;
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
  select string_agg(card_name, ', ') into v_unexplained
    from public.trade_offer_cards
    where trade_request_id = p_trade_id and review_status = 'approved'
      and (coalesce(final_quantity, 0) <> coalesce(approved_quantity, 0)
           or (coalesce(final_quantity, 0) > 0 and final_unit_cents is distinct from approved_unit_cents))
      and inspection_note is null and cardinality(flags) = 0
      and verified_condition is not distinct from reported_condition
      and authenticity <> 'counterfeit';
  if v_unexplained is not null then
    raise exception 'Say why these changed from what was approved (a note for the customer, a flag or the condition): %', v_unexplained
      using errcode = 'GT010';
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
                       'shipping_cents', v_shipping, 'excess_cents', v_excess, 'cash_payout_cents', v_cash,
                       'approved_value_cents', v_trade.approved_value_cents));
  return v_credit;
end;
$$;

-- 21. Finishing a trade -----------------------------------------------------------
-- Issues the trade credit as store credit (once), creates the paid order for
-- our cards at their trade prices, spends the credit on it, records any card
-- payment for the rest, and hands the reserved cards over to that order.
-- Safe to call again: an already-finished trade just returns its order.
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
    -- A card payment (a Stripe PaymentIntent), or one staff recorded by hand.
    (case when v_due = 0 then 'store_credit'
          when left(coalesce(p_payment_reference, ''), 3) = 'pi_' then 'stripe'
          else 'manual' end)::public.payment_provider,
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
        raise exception 'The reservation on % was released. Staff will be in touch.', ri.card_name using errcode = 'GT004';
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
    -- Copies that arrived but weren't taken go back to the customer.
    return_status = case when exists (
        select 1 from public.trade_offer_cards c
        where c.trade_request_id = p_trade_id and c.inspected_at is not null
          and coalesce(c.received_quantity, 0) > coalesce(c.final_quantity, 0)
      ) then 'pending' else return_status end
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

-- 22. Adding accepted trade-ins to inventory (staff, after the trade is done) --
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

-- 23. A trade is complete when its order ships ------------------------------------
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

-- 24. Staff push notifications: a 'trade' kind, on for devices that already
-- have notifications turned on. Every kind that exists today stays.
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

-- 25. The admin sidebar's Trades number: trades waiting on staff
-- (needs_staff: a trade to review, a package to inspect, cards to mail back,
-- a deposit to decide or a refund that failed, a scan or proof of shipping to
-- check). Everything else is as it was (migration 20261017230000).
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
    'trades_waiting', (select count(*) from public.trade_requests where needs_staff),
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

-- 26. Only the server may call these -------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.trade_require_service_role()',
    'public.trade_log(uuid, text, uuid, text, text, text, text, jsonb)',
    'public.trade_deposit_after_close(text, text)',
    'public.trade_available(uuid, uuid)',
    'public.trade_short_lines(uuid)',
    'public.trade_put_line(uuid, bigint, uuid, integer, boolean)',
    'public.trade_release_line(uuid, text, text)',
    'public.trade_recount_wanted(uuid)',
    'public.trade_customer_stats(uuid, integer)',
    'public.trade_customer_list(integer)',
    'public.trade_start(uuid, jsonb, text, text)',
    'public.trade_set_wanted(uuid, jsonb, text[], text, uuid, text)',
    'public.trade_close_core(uuid, text, text, text, text, text, uuid, text)',
    'public.trade_close(uuid, text, text[], text, text, text, uuid, text, text)',
    'public.trade_expire_due(integer, integer, boolean)',
    'public.trade_save_offer(uuid, uuid, jsonb)',
    'public.trade_submit(uuid, uuid, text)',
    'public.trade_review_cards(uuid, jsonb, uuid, text)',
    'public.trade_request_revision(uuid, text, uuid, text)',
    'public.trade_approve(uuid, timestamptz, integer, text, text, uuid, text)',
    'public.trade_set_deposit(uuid, text, integer, text, uuid, text)',
    'public.trade_mark_unavailable(uuid)',
    'public.trade_reserve_core(uuid, bigint)',
    'public.trade_confirm(uuid, uuid, integer, text, integer, timestamptz, text, text, text)',
    'public.trade_reserve(uuid, text, integer, integer, timestamptz)',
    'public.trade_record_tracking(uuid, text, text, text, uuid, text)',
    'public.trade_record_scan(uuid, text, text, text, jsonb, timestamptz, timestamptz, timestamptz)',
    'public.trade_verify_shipment(uuid, timestamptz, boolean, boolean, text, uuid, text)',
    'public.trade_mark_received(uuid, uuid, text)',
    'public.trade_extend(uuid, text, timestamptz, integer, boolean, text, uuid, text)',
    'public.trade_reinstate(uuid, text, timestamptz, timestamptz, boolean, uuid, text)',
    'public.trade_open_dispute(uuid, uuid, text, jsonb)',
    'public.trade_resolve_dispute(uuid, text, text, uuid, text)',
    'public.trade_deposit_update(uuid, text, text, text, text, text, uuid, text)',
    'public.trade_clear_fault(uuid, uuid, text)',
    'public.trade_inspect_cards(uuid, jsonb, uuid, text)',
    'public.trade_send_final_offer(uuid, boolean, uuid, text)',
    'public.trade_finalize_core(uuid, integer, text)',
    'public.trade_accept_final(uuid, uuid, text, text, text, text, text, text)',
    'public.trade_record_payment(uuid, integer, text)',
    'public.trade_import_card(uuid, integer, text, text)',
    'public.tg_trade_order_shipped()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end$$;
