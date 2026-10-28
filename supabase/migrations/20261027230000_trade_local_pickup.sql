-- Trade Center: local pickup trades.
--
-- A customer near the store can trade in person instead of by mail. They
-- pick our cards as usual, choose "Local pickup" and send the trade for
-- review without listing their cards: we look at those when we meet.
--
-- How a local pickup trade runs (trade_requests.handoff_method = 'local'):
--   awaiting_trade_list / revision_requested   As before, but their cards
--                           aren't needed to send it.
--   pending_review          Staff approve it (no card-by-card review, no
--                           mailing address needed, never a deposit), and
--                           can write where and when to meet (meetup_details).
--   awaiting_confirmation   The customer confirms within confirmation_hours.
--   awaiting_shipment       Reserved: our cards are held until ship_by, which
--                           for a local trade is the meetup deadline
--                           (local_meet_days qualifying days). Staff arrange
--                           the meetup in the trade's messages. Not shipped,
--                           never tracked.
--   completed               At the meetup staff record the cards they took
--                           (each card, its condition and value), and any
--                           difference the customer paid in person
--                           (trade_complete_local). That issues the credit,
--                           hands our cards over on an in-person order
--                           (channel pos, delivered) and completes the trade
--                           in one step.
-- A hold that runs out closes as expired with no fault counted (the meetup
-- is arranged together; staff can count a no-show when they release it by
-- hand). Canceling before the meetup costs nothing either.
--
-- Shipped trades (handoff_method = 'ship', every trade before this update)
-- work exactly as before.
--
-- Run after 20261025200000_trade_center.sql and 20261026233000. Safe to run
-- more than once.

-- 1. Settings ------------------------------------------------------------------------
alter table public.trade_settings
  add column if not exists local_pickup_enabled boolean not null default true,
  add column if not exists local_pickup_area text not null default 'the St. Louis area',
  add column if not exists local_meet_days integer not null default 7,
  add column if not exists local_pickup_details text not null default
    'Once your trade is confirmed, we''ll message you here to set a time and a public place to meet. Bring the cards you''re trading in: we''ll look them over together and settle the trade on the spot.';

alter table public.trade_settings drop constraint if exists trade_settings_local_pickup_area_check;
alter table public.trade_settings add constraint trade_settings_local_pickup_area_check
  check (char_length(btrim(local_pickup_area)) between 1 and 120);
alter table public.trade_settings drop constraint if exists trade_settings_local_meet_days_check;
alter table public.trade_settings add constraint trade_settings_local_meet_days_check
  check (local_meet_days between 1 and 30);
alter table public.trade_settings drop constraint if exists trade_settings_local_pickup_details_check;
alter table public.trade_settings add constraint trade_settings_local_pickup_details_check
  check (char_length(local_pickup_details) <= 2000);

comment on column public.trade_settings.local_pickup_enabled is
  'Customers can choose local pickup (trade in person, no shipping) for new trades.';
comment on column public.trade_settings.local_pickup_area is
  'Where local pickup is offered, as customers read it ("the St. Louis area").';
comment on column public.trade_settings.local_meet_days is
  'Qualifying days a confirmed local pickup trade holds our cards for the meetup (Sundays and excluded days don''t count).';
comment on column public.trade_settings.local_pickup_details is
  'How meetups work, shown to customers who choose local pickup.';

-- 2. Trades ----------------------------------------------------------------------------
alter table public.trade_requests
  add column if not exists handoff_method text not null default 'ship',
  add column if not exists meetup_details text,
  add column if not exists met_at timestamptz,
  add column if not exists local_payment_method text,
  add column if not exists local_paid_cents integer;

alter table public.trade_requests drop constraint if exists trade_requests_handoff_method_check;
alter table public.trade_requests add constraint trade_requests_handoff_method_check
  check (handoff_method in ('ship', 'local'));
alter table public.trade_requests drop constraint if exists trade_requests_meetup_details_check;
alter table public.trade_requests add constraint trade_requests_meetup_details_check
  check (meetup_details is null or char_length(meetup_details) <= 2000);
alter table public.trade_requests drop constraint if exists trade_requests_local_payment_method_check;
alter table public.trade_requests add constraint trade_requests_local_payment_method_check
  check (local_payment_method is null or local_payment_method in ('none', 'cash', 'card', 'other'));
alter table public.trade_requests drop constraint if exists trade_requests_local_paid_cents_check;
alter table public.trade_requests add constraint trade_requests_local_paid_cents_check
  check (local_paid_cents is null or local_paid_cents >= 0);

comment on column public.trade_requests.handoff_method is
  'ship: the customer mails their cards and we ship ours. local: we meet in person (ship_by is then the meetup deadline).';
comment on column public.trade_requests.meetup_details is
  'Local pickup: where and when to meet, as staff wrote it for the customer.';
comment on column public.trade_requests.met_at is 'Local pickup: when staff finished the trade at the meetup.';
comment on column public.trade_requests.local_payment_method is
  'Local pickup: how the customer paid the difference in person (none when the credit covered everything).';
comment on column public.trade_requests.local_paid_cents is 'Local pickup: what the customer paid in person.';

-- A confirmed local trade waits on staff to meet the customer.
alter table public.trade_requests alter column needs_staff set expression as (
  status in ('pending_review', 'received', 'under_inspection')
  or (status = 'awaiting_shipment' and handoff_method = 'local')
  or return_status = 'pending'
  or deposit_status in ('forfeiture_review', 'refund_failed')
  or review_flag is not null
);

-- 3. Starting a trade: how they'll trade ----------------------------------------------
-- (The old four-argument version goes: callers that leave the method out
-- get a shipped trade, as before.)
drop function if exists public.trade_start(uuid, jsonb, text, text);
create or replace function public.trade_start(
  p_user_id uuid, p_items jsonb, p_customer_name text, p_customer_email text, p_handoff_method text default 'ship'
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
  v_method text := coalesce(nullif(btrim(p_handoff_method), ''), 'ship');
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
  if v_method not in ('ship', 'local') then
    raise exception 'Choose shipping or local pickup.' using errcode = 'GT010';
  end if;
  if v_method = 'local' and not s.local_pickup_enabled then
    raise exception 'Local pickup isn''t available right now. Choose shipping instead.' using errcode = 'GT010';
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
    user_id, customer_name, customer_email, status, handoff_method,
    credit_rate_percent, min_card_value_cents, condition_percents, processing_fee_cents,
    ship_fee_cents, free_ship_threshold_cents, free_ship_fee_cents,
    list_due_at
  ) values (
    p_user_id, left(nullif(btrim(p_customer_name), ''), 120), left(nullif(btrim(p_customer_email), ''), 254), 'awaiting_trade_list', v_method,
    s.credit_rate_percent, s.min_card_value_cents,
    jsonb_build_object('NM', s.condition_nm_percent, 'LP', s.condition_lp_percent, 'MP', s.condition_mp_percent,
                       'HP', s.condition_hp_percent, 'DMG', s.condition_dmg_percent),
    s.processing_fee_cents,
    s.ship_fee_cents, s.free_ship_threshold_cents, s.free_ship_fee_cents,
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
    raise exception 'Add % more in cards to reach the % minimum trade value.',
      to_char((s.min_trade_value_cents - v_total) / 100.0, 'FM$999,999,990.00'),
      to_char(s.min_trade_value_cents / 100.0, 'FM$999,999,990.00') using errcode = 'GT005';
  end if;
  if s.max_trade_value_cents is not null and v_total > s.max_trade_value_cents then
    raise exception 'A trade can include up to % of our cards.', to_char(s.max_trade_value_cents / 100.0, 'FM$999,999,990.00') using errcode = 'GT006';
  end if;

  perform public.trade_log(v_trade.id, 'customer', p_user_id, left(coalesce(p_customer_email, ''), 200), 'started', null, 'awaiting_trade_list',
    jsonb_build_object('wanted_total_cents', v_total, 'list_due_at', v_trade.list_due_at, 'handoff_method', v_method));
  return v_trade.id;
end;
$$;

-- The customer changes how they'll trade while they can still edit it.
-- Their card list (if any) stays saved either way; a local trade just
-- doesn't need it.
create or replace function public.trade_set_handoff(p_trade_id uuid, p_user_id uuid, p_handoff_method text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found or v_trade.user_id is distinct from p_user_id then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if p_handoff_method is null or p_handoff_method not in ('ship', 'local') then
    raise exception 'Choose shipping or local pickup.' using errcode = 'GT010';
  end if;
  if v_trade.status not in ('awaiting_trade_list', 'revision_requested') then
    raise exception 'How you''ll trade can be changed until you send your trade.' using errcode = 'GT009';
  end if;
  if v_trade.list_due_at is not null and v_trade.list_due_at < now() then
    raise exception 'The time to update this trade ran out.' using errcode = 'GT012';
  end if;
  if v_trade.handoff_method = p_handoff_method then
    return;
  end if;
  if p_handoff_method = 'local' and not s.local_pickup_enabled then
    raise exception 'Local pickup isn''t available right now.' using errcode = 'GT010';
  end if;
  update public.trade_requests set handoff_method = p_handoff_method where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'customer', p_user_id, v_trade.customer_email, 'handoff_changed', v_trade.status, v_trade.status,
    jsonb_build_object('from', v_trade.handoff_method, 'to', p_handoff_method));
end;
$$;

-- 4. Sending it: a local trade needs only our cards -----------------------------------
create or replace function public.trade_submit(p_trade_id uuid, p_user_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_cards integer;
  v_blocked integer;
  v_wanted integer;
  v_total integer;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
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
  if v_trade.handoff_method = 'local' and not s.local_pickup_enabled then
    raise exception 'Local pickup isn''t available right now. Switch this trade to shipping to send it.' using errcode = 'GT010';
  end if;
  select count(*)::int,
         (count(*) filter (where eligibility in ('below_minimum', 'excluded_set', 'excluded_card', 'overstocked')))::int
    into v_cards, v_blocked
    from public.trade_offer_cards where trade_request_id = p_trade_id;
  -- Local pickup: their cards are looked at when we meet.
  if v_trade.handoff_method = 'ship' then
    if v_cards = 0 then
      raise exception 'Add the cards you''re trading in first.' using errcode = 'GT010';
    end if;
    if v_blocked > 0 then
      raise exception 'Take off the cards we can''t accept first (they''re marked on your list).' using errcode = 'GT010';
    end if;
  end if;
  select count(*)::int into v_wanted from public.trade_request_items
    where trade_request_id = p_trade_id and status = 'requested';
  if v_wanted = 0 then
    raise exception 'Add at least one of our cards first.' using errcode = 'GT010';
  end if;
  -- Our cards can dip below the minimum while the customer edits; not to send.
  v_total := public.trade_recount_wanted(p_trade_id);
  if v_total < s.min_trade_value_cents then
    raise exception 'Add % more in cards to reach the % minimum trade value.',
      to_char((s.min_trade_value_cents - v_total) / 100.0, 'FM$999,999,990.00'),
      to_char(s.min_trade_value_cents / 100.0, 'FM$999,999,990.00') using errcode = 'GT005';
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
    jsonb_build_object('cards', v_cards, 'estimated_value_cents', v_trade.estimated_value_cents,
                       'handoff_method', v_trade.handoff_method));
end;
$$;

-- 5. Approving: a local trade has no card review, no mailing address and no deposit ---
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
  v_local boolean;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  v_local := v_trade.handoff_method = 'local';
  if v_trade.status <> 'pending_review' then
    raise exception 'Only a trade pending review can be approved.' using errcode = 'GT009';
  end if;
  if v_trade.deposit_status in ('refund_pending', 'refund_failed', 'forfeiture_review') then
    raise exception 'The refund of this trade''s earlier deposit isn''t finished. Settle it first (Deposits).' using errcode = 'GT009';
  end if;
  if not v_local and (nullif(btrim(s.ship_to_line1), '') is null or nullif(btrim(s.ship_to_city), '') is null
     or nullif(btrim(s.ship_to_state), '') is null or nullif(btrim(s.ship_to_postal_code), '') is null) then
    raise exception 'Add the address customers mail their cards to (Trades, Settings) before approving a trade.' using errcode = 'GT011';
  end if;
  if p_confirm_by is null or p_confirm_by <= now() or p_confirm_by > now() + interval '30 days' then
    raise exception 'The confirmation deadline has to be in the next 30 days.' using errcode = 'GT010';
  end if;
  if p_deposit_cents is null or p_deposit_cents < 0 or p_deposit_cents > 100000 or (p_deposit_cents > 0 and p_deposit_cents < 50) then
    raise exception 'A deposit is 50 cents to $1,000, or none.' using errcode = 'GT010';
  end if;
  if v_local and p_deposit_cents > 0 then
    raise exception 'Local pickup trades don''t take a deposit.' using errcode = 'GT010';
  end if;
  if p_deposit_cents > 0 and (p_deposit_reason is null or p_deposit_reason not in ('threshold', 'trade', 'customer', 'reliability')) then
    raise exception 'Say why this trade needs a deposit.' using errcode = 'GT010';
  end if;
  if not v_local then
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
    -- Local pickup: their cards are valued when we meet.
    approved_value_cents = case when v_local then null else v_value::int end,
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
    jsonb_build_object('approved_value_cents', case when v_local then null else v_value end, 'confirm_by', p_confirm_by,
                       'deposit_cents', p_deposit_cents, 'deposit_reason', p_deposit_reason,
                       'conditions', nullif(btrim(p_conditions), ''), 'handoff_method', v_trade.handoff_method));
  return coalesce(v_value, 0)::int;
end;
$$;

-- 6. Deposits: never on a local trade ---------------------------------------------------
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
  if v_trade.handoff_method = 'local' and p_deposit_cents > 0 then
    raise exception 'Local pickup trades don''t take a deposit.' using errcode = 'GT010';
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

-- 7. Where and when to meet (staff, while a local trade is open) -----------------------
create or replace function public.trade_set_meetup(p_trade_id uuid, p_details text, p_actor_id uuid, p_actor_label text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
  v_details text := left(nullif(btrim(p_details), ''), 2000);
begin
  perform public.trade_require_service_role();
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.handoff_method <> 'local' then
    raise exception 'Meetups are for local pickup trades.' using errcode = 'GT009';
  end if;
  if v_trade.status not in ('pending_review', 'awaiting_confirmation', 'awaiting_shipment') then
    raise exception 'The meetup can be set until the trade is finished.' using errcode = 'GT009';
  end if;
  if v_details is not distinct from v_trade.meetup_details then
    return;
  end if;
  update public.trade_requests set meetup_details = v_details where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'meetup_set', v_trade.status, v_trade.status,
    jsonb_build_object('details', v_details));
end;
$$;

-- 8. Deadlines: a local hold that runs out counts against nobody -----------------------
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
    select t.id, t.trade_number, t.status, t.handoff_method from public.trade_requests t
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
        if r.handoff_method = 'local' then
          -- Meetups are arranged together: running out isn't the customer's fault on its own.
          v_to := 'expired'; v_stage := 'shipping'; v_fault := null; v_reason := 'We didn''t meet before the hold ended.';
        else
          v_to := 'expired'; v_stage := 'shipping'; v_fault := 'missed_deadline'; v_reason := 'No tracking number by the shipping deadline.';
        end if;
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

-- 9. Finishing: a local trade's order is handed over in person ------------------------
-- As before for a shipped trade. A local trade's order is an in-person one
-- (channel pos, no shipping, delivered on the spot), and the trade is
-- complete at once.
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
  v_wanted integer;
  v_total integer;
  v_credit integer;
  v_issue integer;
  v_spend integer;
  v_due integer;
  v_local boolean;
  ri record;
begin
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.order_id is not null then
    return v_trade.order_id;
  end if;
  v_local := v_trade.handoff_method = 'local';
  if v_trade.status not in ('awaiting_final_approval', 'awaiting_payment') then
    raise exception 'This trade can''t be finished from %.', v_trade.status using errcode = 'GT009';
  end if;
  if v_trade.final_credit_cents is null or v_trade.shipping_cents is null or (not v_local and v_trade.ship_line1 is null) then
    raise exception 'This trade''s final offer isn''t complete.' using errcode = 'GT009';
  end if;
  -- Online orders need an email (orders.chk_online_requires_identity); an
  -- in-person one keeps it for the customer's receipt.
  v_email := coalesce(nullif(btrim(v_trade.customer_email), ''),
                      (select u.email::text from auth.users u where u.id = v_trade.user_id));
  if v_email is null and not v_local then
    raise exception 'This trade has no email address to put on its order.' using errcode = 'GT009';
  end if;

  v_wanted := public.trade_recount_wanted(p_trade_id);
  v_total := v_wanted + v_trade.shipping_cents;
  v_credit := v_trade.final_credit_cents;
  -- The credit pays for our cards only; shipping is part of the card payment.
  v_spend := least(v_credit, v_wanted);
  -- Cash for the excess (when staff offered it) is paid by hand, so only the
  -- credit the order uses is issued; otherwise all of it, the rest kept.
  v_issue := case when v_trade.excess_handling = 'cash' then v_spend else v_credit end;
  v_due := v_total - v_spend;
  if coalesce(p_paid_cents, 0) < v_due then
    raise exception 'The trade still needs % paid.', to_char(v_due / 100.0, 'FM$999,999,990.00') using errcode = 'GT008';
  end if;

  if v_local then
    insert into public.orders (
      user_id, email, channel, shipping_method,
      subtotal_cents, shipping_cents, discount_cents, tax_cents,
      store_credit_used_cents, total_cents, amount_due_cents,
      ship_country,
      payment_provider, payment_reference, payment_status, status, paid_at, delivered_at,
      trade_request_id, internal_notes
    ) values (
      v_trade.user_id, v_email, 'pos', null,
      v_total, 0, 0, 0,
      v_spend, v_total, v_due,
      null,
      (case when v_due = 0 then 'store_credit' else 'manual' end)::public.payment_provider,
      case when v_due = 0 then null else p_payment_reference end,
      'paid', 'delivered', now(), now(),
      p_trade_id, 'Trade TR-' || v_trade.trade_number || ' (local pickup)'
    ) returning id into v_order_id;
  else
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
  end if;

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
    -- Local pickup: our cards were handed over at the meetup.
    status = case when v_local then 'completed' else 'approved_for_fulfillment' end,
    completed_at = case when v_local then now() else completed_at end,
    closed_at = case when v_local then now() else closed_at end,
    order_id = v_order_id,
    amount_due_cents = v_due,
    excess_cents = greatest(v_credit - v_wanted, 0),
    credit_issued_cents = v_issue,
    payment_reference = case when v_due = 0 then payment_reference else p_payment_reference end,
    paid_at = now(),
    payment_due_at = null,
    -- Copies that arrived but weren't taken go back to the customer (a local
    -- trade only records the cards taken: the rest stayed with them).
    return_status = case when not v_local and exists (
        select 1 from public.trade_offer_cards c
        where c.trade_request_id = p_trade_id and c.inspected_at is not null
          and coalesce(c.received_quantity, 0) > coalesce(c.final_quantity, 0)
      ) then 'pending' else return_status end
  where id = p_trade_id;

  perform public.trade_log(p_trade_id, 'system', null, null, 'finalized', v_trade.status,
    case when v_local then 'completed' else 'approved_for_fulfillment' end,
    jsonb_build_object('order_id', v_order_id, 'credit_issued_cents', v_issue, 'credit_used_cents', v_spend,
                       'paid_cents', v_due, 'shipping_cents', v_trade.shipping_cents,
                       'excess_cents', greatest(v_credit - v_wanted, 0), 'handoff_method', v_trade.handoff_method));
  if v_local then
    perform public.trade_log(p_trade_id, 'system', null, null, 'completed', 'completed', 'completed',
      jsonb_build_object('order_id', v_order_id, 'handed_over', true));
  end if;
  return v_order_id;
end;
$$;

-- 10. The meetup: staff record the cards they took and finish the trade ---------------
-- p_cards: [{ "scryfall_id"?, "card_name", "set_code"?, "set_name"?,
--   "collector_number"?, "finish", "image_url"?, "condition", "quantity",
--   "unit_cents" (what each copy is worth: its TCG low in that condition),
--   "reference_price_cents"?, "note"? (staff only) }, …]
-- Can be empty (they bought our cards outright). p_paid_cents: what they
-- paid in person, which must be exactly what the credit doesn't cover;
-- p_payment_method: cash, card or other (none when nothing was due).
-- Replaces any card list the customer saved, prices nothing on its own
-- (staff set every value), finishes the trade (trade_finalize_core) and
-- returns its order. Safe to call again: a finished trade returns its order.
create or replace function public.trade_complete_local(
  p_trade_id uuid, p_cards jsonb, p_paid_cents integer, p_payment_method text, p_payment_note text,
  p_cash_for_excess boolean, p_actor_id uuid, p_actor_label text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_percents jsonb;
  v_value bigint := 0;
  v_credit integer;
  v_wanted integer;
  v_excess integer;
  v_cash integer;
  v_due integer;
  v_method text;
  v_note text := left(nullif(btrim(p_payment_note), ''), 160);
  v_name text;
  v_qty integer;
  v_unit integer;
  v_condition public.card_condition;
  v_finish public.card_finish;
  v_scryfall uuid;
  v_ref integer;
  v_pos integer := 0;
  v_order uuid;
  e jsonb;
begin
  perform public.trade_require_service_role();
  select * into s from public.trade_settings where id;
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.order_id is not null then
    return v_trade.order_id;
  end if;
  if v_trade.handoff_method <> 'local' then
    raise exception 'Only a local pickup trade is finished at a meetup.' using errcode = 'GT009';
  end if;
  if v_trade.status <> 'awaiting_shipment' then
    raise exception 'Finish a local pickup trade once it''s confirmed and our cards are reserved.' using errcode = 'GT009';
  end if;
  if not exists (select 1 from public.trade_request_items where trade_request_id = p_trade_id and status = 'reserved') then
    raise exception 'None of our cards are on this trade any more.' using errcode = 'GT010';
  end if;
  if p_cards is null or jsonb_typeof(p_cards) <> 'array' then
    raise exception 'Their cards didn''t come through. Try again.' using errcode = 'GT010';
  end if;
  if jsonb_array_length(p_cards) > s.max_offered_lines then
    raise exception 'A trade can take up to % different cards.', s.max_offered_lines using errcode = 'GT010';
  end if;

  v_percents := v_trade.condition_percents;
  delete from public.trade_offer_cards where trade_request_id = p_trade_id;

  for e in select value from jsonb_array_elements(p_cards) loop
    v_pos := v_pos + 1;
    v_name := left(nullif(btrim(e->>'card_name'), ''), 200);
    if v_name is null then
      raise exception 'Card % has no name.', v_pos using errcode = 'GT010';
    end if;
    v_qty := (e->>'quantity')::int;
    v_unit := (e->>'unit_cents')::int;
    if v_qty is null or v_qty < 1 or v_qty > 99 then
      raise exception '%: take 1 to 99.', v_name using errcode = 'GT010';
    end if;
    if v_unit is null or v_unit < 0 or v_unit > 10000000 then
      raise exception '%: set what each copy is worth.', v_name using errcode = 'GT010';
    end if;
    if coalesce(e->>'condition', '') not in ('NM', 'LP', 'MP', 'HP', 'DMG') then
      raise exception '%: choose its condition.', v_name using errcode = 'GT010';
    end if;
    v_condition := (e->>'condition')::public.card_condition;
    if not exists (select 1 from pg_enum where enumtypid = 'public.card_finish'::regtype and enumlabel = coalesce(e->>'finish', '')) then
      raise exception '%: choose its finish.', v_name using errcode = 'GT010';
    end if;
    v_finish := (e->>'finish')::public.card_finish;
    v_scryfall := case when coalesce(e->>'scryfall_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then (e->>'scryfall_id')::uuid end;
    v_ref := case when coalesce(e->>'reference_price_cents', '') ~ '^[0-9]{1,8}$' then (e->>'reference_price_cents')::int end;
    v_value := v_value + v_qty::bigint * v_unit;

    insert into public.trade_offer_cards (
      trade_request_id, position, scryfall_id, card_name, set_code, set_name, collector_number, finish, image_url,
      quantity, reported_condition, reference_price_cents, reference_checked_at, condition_percent, estimated_unit_cents,
      eligibility, review_status, approved_quantity, approved_unit_cents,
      received_quantity, authenticity, verified_condition, final_quantity, final_unit_cents, inspection_internal_note, inspected_at
    ) values (
      p_trade_id, v_pos, v_scryfall, v_name,
      left(nullif(btrim(e->>'set_code'), ''), 12), left(nullif(btrim(e->>'set_name'), ''), 120),
      left(nullif(btrim(e->>'collector_number'), ''), 16), v_finish,
      case when coalesce(e->>'image_url', '') ~ '^https://' then left(e->>'image_url', 1000) end,
      v_qty, v_condition, v_ref, case when v_ref is not null then now() end,
      coalesce(case when (v_percents->>(e->>'condition')) ~ '^[0-9]{1,3}$' then (v_percents->>(e->>'condition'))::int end, 100),
      v_unit, 'eligible', 'approved', v_qty, v_unit,
      v_qty, 'authentic', v_condition, v_qty, v_unit, left(nullif(btrim(e->>'note'), ''), 2000), now()
    );
  end loop;

  if v_value > 100000000 then
    raise exception 'That''s more than we can take in one trade.' using errcode = 'GT006';
  end if;
  v_credit := greatest(round(v_value * v_trade.credit_rate_percent / 100.0)::int - v_trade.processing_fee_cents, 0);
  v_wanted := public.trade_recount_wanted(p_trade_id);
  v_excess := greatest(v_credit - v_wanted, 0);
  -- Nothing ships, so nothing is charged for shipping.
  v_due := greatest(v_wanted - v_credit, 0);

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

  -- The amount first: a page with stale totals should hear that, not "say how they paid".
  if coalesce(p_paid_cents, 0) <> v_due then
    raise exception 'With these cards they pay %, not %. Check the cards and the amount, then finish again.',
      to_char(v_due / 100.0, 'FM$999,999,990.00'), to_char(coalesce(p_paid_cents, 0) / 100.0, 'FM$999,999,990.00')
      using errcode = 'GT008';
  end if;
  v_method := case when v_due = 0 then 'none' else coalesce(nullif(btrim(p_payment_method), ''), 'none') end;
  if v_due > 0 and v_method not in ('cash', 'card', 'other') then
    raise exception 'Say how they paid the %.', to_char(v_due / 100.0, 'FM$999,999,990.00') using errcode = 'GT010';
  end if;

  update public.trade_requests set
    status = 'awaiting_final_approval',
    estimated_value_cents = least(v_value, 2147483647)::int,
    approved_value_cents = v_value::int,
    final_value_cents = v_value::int,
    final_credit_cents = v_credit,
    shipping_cents = 0,
    amount_due_cents = v_due,
    excess_cents = v_excess,
    excess_handling = case when coalesce(p_cash_for_excess, false) then 'cash' else 'store_credit' end,
    cash_payout_cents = v_cash,
    received_at = now(),
    final_offer_at = now(),
    accepted_at = now(),
    met_at = now(),
    local_payment_method = v_method,
    local_paid_cents = v_due
  where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'met_up', 'awaiting_shipment', 'completed',
    jsonb_build_object('cards', v_pos, 'final_value_cents', v_value, 'final_credit_cents', v_credit, 'wanted_total_cents', v_wanted,
                       'paid_cents', v_due, 'payment_method', v_method, 'payment_note', v_note,
                       'excess_cents', v_excess, 'cash_payout_cents', v_cash));

  v_order := public.trade_finalize_core(p_trade_id, v_due,
    case when v_due = 0 then null else left('local ' || v_method || coalesce(': ' || v_note, ''), 200) end);
  return v_order;
end;
$$;

-- 11. Only the server may call these --------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.trade_start(uuid, jsonb, text, text, text)',
    'public.trade_set_handoff(uuid, uuid, text)',
    'public.trade_submit(uuid, uuid, text)',
    'public.trade_approve(uuid, timestamptz, integer, text, text, uuid, text)',
    'public.trade_set_deposit(uuid, text, integer, text, uuid, text)',
    'public.trade_set_meetup(uuid, text, uuid, text)',
    'public.trade_expire_due(integer, integer, boolean)',
    'public.trade_finalize_core(uuid, integer, text)',
    'public.trade_complete_local(uuid, jsonb, integer, text, text, boolean, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end$$;
