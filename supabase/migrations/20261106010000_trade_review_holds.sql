-- Trade Center: hold the customer's chosen cards while a trade is reviewed.
--
-- Until now our cards on a trade were held only once the customer confirmed
-- an approved trade (and paid any deposit). They could sell while staff were
-- still reviewing, or in the hours between approval and confirmation.
--
-- Now a trade's cards are held in up to three stages, each handing off to the
-- next inside one transaction:
--
--   review        trade_submit holds them for review_hold_hours (default 12),
--                 all or none, if review holds are on, the trade is worth at
--                 most review_hold_max_cents (default $500) and the customer
--                 has fewer than review_holds_per_customer held trades.
--                 A card that already sold stops the submit with its name.
--   confirmation  trade_approve keeps them held until confirm_by (any value;
--                 whatever wasn't held yet is held now, all or none).
--   reserved      confirming (no deposit) or the deposit landing: the hold
--                 becomes the trade's reservation, exactly as before.
--
-- The holds are ordinary active inventory_reservations rows on the trade's
-- lines (trade_request_items.status = 'reserved'), so every function that
-- works out stock (shop search, cart, checkout, register, kiosk, yard sale,
-- trades) already counts them and nothing can be sold twice.
--
-- trade_requests.hold_stage / hold_expires_at record the temporary stages.
-- The trigger trade_hold_stage_guard clears them as soon as the trade leaves
-- those stages (reserved, closed), so a confirmed reservation can never be
-- let go by the hold expiry below. trade_release_expired_holds (run by the
-- 5-minute worker, api/_lib/tradeExpiry.ts) lets an expired review hold go;
-- a confirmation hold ends with the confirmation deadline as before
-- (trade_expire_due, and the worker's unpaid-deposit step).
--
-- With review_holds_enabled off, everything works exactly as before.

-- ---------------------------------------------------------------------------
-- Settings and columns (additive)

alter table public.trade_settings
  add column if not exists review_holds_enabled boolean not null default true,
  add column if not exists review_hold_hours integer not null default 12,
  add column if not exists review_hold_max_cents integer not null default 50000,
  add column if not exists review_holds_per_customer integer not null default 1;

alter table public.trade_settings
  drop constraint if exists trade_settings_review_hold_hours_check,
  add constraint trade_settings_review_hold_hours_check check (review_hold_hours between 1 and 72),
  drop constraint if exists trade_settings_review_hold_max_cents_check,
  add constraint trade_settings_review_hold_max_cents_check check (review_hold_max_cents between 0 and 100000000),
  drop constraint if exists trade_settings_review_holds_per_customer_check,
  add constraint trade_settings_review_holds_per_customer_check check (review_holds_per_customer between 1 and 20);

comment on column public.trade_settings.review_holds_enabled is
  'Hold the customer''s chosen cards from submission (review hold) and through the confirmation window. Off = cards are held only once the trade is confirmed, as before.';
comment on column public.trade_settings.review_hold_hours is 'How long a review hold lasts (plain hours).';
comment on column public.trade_settings.review_hold_max_cents is 'Largest value of our cards held during review; bigger trades are held only once approved.';
comment on column public.trade_settings.review_holds_per_customer is 'Trades one customer can have held at the same time (review or confirmation).';

alter table public.trade_requests
  add column if not exists hold_stage text,
  add column if not exists hold_expires_at timestamptz;

alter table public.trade_requests
  drop constraint if exists trade_requests_hold_stage_check,
  add constraint trade_requests_hold_stage_check check (hold_stage is null or hold_stage in ('review', 'confirmation')),
  drop constraint if exists trade_requests_hold_pair_check,
  add constraint trade_requests_hold_pair_check check ((hold_stage is null) = (hold_expires_at is null));

comment on column public.trade_requests.hold_stage is
  'Temporary hold on our cards: review (from submission) or confirmation (from approval). Null otherwise, including once reserved.';
comment on column public.trade_requests.hold_expires_at is 'When the temporary hold ends. Enforced by the server, never the browser.';

create index if not exists trade_requests_hold_expiry_idx
  on public.trade_requests (hold_expires_at) where hold_stage is not null;
create index if not exists trade_requests_user_hold_idx
  on public.trade_requests (user_id) where hold_stage is not null;

alter table public.trade_extensions drop constraint if exists trade_extensions_kind_check;
alter table public.trade_extensions add constraint trade_extensions_kind_check
  check (kind in ('list', 'confirmation', 'shipping', 'payment', 'hold'));

-- ---------------------------------------------------------------------------
-- The stage follows the trade: cleared as soon as the trade moves past it.

create or replace function public.tg_trade_hold_stage_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.hold_stage is null then
    new.hold_expires_at := null;
    return new;
  end if;
  -- Approval taken back for changes: the cards stay held until the time the
  -- confirmation hold would have ended, as a review hold.
  if new.hold_stage = 'confirmation' and new.status in ('pending_review', 'revision_requested') then
    new.hold_stage := 'review';
  end if;
  if not ((new.hold_stage = 'review' and new.status in ('pending_review', 'revision_requested'))
       or (new.hold_stage = 'confirmation' and new.status in ('awaiting_confirmation', 'awaiting_deposit'))) then
    -- Reserved (the hold became the reservation) or closed (its lines were
    -- released by trade_close_core).
    new.hold_stage := null;
    new.hold_expires_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trade_hold_stage_guard on public.trade_requests;
create trigger trade_hold_stage_guard
  before insert or update on public.trade_requests
  for each row execute function public.tg_trade_hold_stage_guard();

-- ---------------------------------------------------------------------------
-- Letting a hold go: lines go back to wanted-but-not-held.

-- Internal. The caller holds the trade's row lock.
create or replace function public.trade_hold_return_lines(p_trade_id uuid, p_by text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select i.id, i.reservation_id from public.trade_request_items i
    where i.trade_request_id = p_trade_id and i.status = 'reserved'
    order by i.inventory_item_id
    for update
  loop
    update public.inventory_reservations
      set status = 'released', released_at = now(), released_by = left(coalesce(p_by, 'trade hold'), 200)
      where id = r.reservation_id and status = 'active';
    update public.trade_request_items set status = 'requested', reservation_id = null where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Run by the 5-minute worker: review holds whose time ran out.
create or replace function public.trade_release_expired_holds(p_limit integer default 50)
returns table (released_trade_id uuid, released_trade_number bigint, released_lines integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  n integer;
begin
  perform public.trade_require_service_role();
  for r in
    select t.id, t.trade_number, t.status, t.hold_expires_at from public.trade_requests t
    where t.hold_stage = 'review' and t.hold_expires_at < now()
      and t.status in ('pending_review', 'revision_requested')
    order by t.hold_expires_at
    limit greatest(coalesce(p_limit, 50), 1)
    -- A trade someone is acting on right now is left for the next run.
    for update of t skip locked
  loop
    n := public.trade_hold_return_lines(r.id, 'hold expiry');
    update public.trade_requests set hold_stage = null, hold_expires_at = null where id = r.id;
    perform public.trade_log(r.id, 'system', null, 'expiry', 'hold_expired', r.status, r.status,
      jsonb_build_object('stage', 'review', 'until', r.hold_expires_at, 'lines', n));
    released_trade_id := r.id; released_trade_number := r.trade_number; released_lines := n;
    return next;
  end loop;
end;
$$;

-- Staff: let a review or confirmation hold go now.
create or replace function public.trade_hold_release(p_trade_id uuid, p_reason text, p_actor_id uuid, p_actor_label text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trade public.trade_requests%rowtype;
  n integer;
begin
  perform public.trade_require_service_role();
  select * into v_trade from public.trade_requests where id = p_trade_id for update;
  if not found then
    raise exception 'That trade isn''t there.' using errcode = 'GT404';
  end if;
  if v_trade.hold_stage is null then
    raise exception 'This trade''s cards aren''t on a review or confirmation hold.' using errcode = 'GT009';
  end if;
  n := public.trade_hold_return_lines(p_trade_id, coalesce(p_actor_label, 'staff'));
  update public.trade_requests set hold_stage = null, hold_expires_at = null where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'hold_released', v_trade.status, v_trade.status,
    jsonb_build_object('stage', v_trade.hold_stage, 'why', 'staff', 'lines', n,
                       'reason', left(nullif(btrim(p_reason), ''), 1000)));
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Existing functions, changed only where the holds need it.


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
    -- Everything is already held (a review or confirmation hold): nothing to do.
    if exists (select 1 from public.trade_request_items where trade_request_id = p_trade_id and status = 'reserved') then
      return null;
    end if;
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
  v_min integer;
  v_holding integer;
  v_short jsonb;
  v_names text;
  v_hold_from text;
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
    where trade_request_id = p_trade_id and status in ('requested', 'reserved');
  if v_wanted = 0 then
    raise exception 'Add at least one of our cards first.' using errcode = 'GT010';
  end if;
  -- Our cards can dip below the minimum while the customer edits; not to send.
  v_total := public.trade_recount_wanted(p_trade_id);
  v_min := case when v_trade.handoff_method = 'local' then s.local_min_trade_value_cents else s.min_trade_value_cents end;
  if v_total < v_min then
    raise exception 'Add % more in cards to reach the % minimum trade value.',
      to_char((v_min - v_total) / 100.0, 'FM$999,999,990.00'),
      to_char(v_min / 100.0, 'FM$999,999,990.00') using errcode = 'GT005';
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

  -- Review hold: while staff review the trade, our cards are held for
  -- review_hold_hours (all or none), so they can't sell in the meantime.
  -- A hold that is still running (the trade came back for changes) keeps
  -- its clock; one that ran out is let go and a fresh one is taken.
  if v_trade.hold_stage is not null and v_trade.hold_expires_at <= now() then
    perform public.trade_hold_return_lines(p_trade_id, 'hold expiry');
    update public.trade_requests set hold_stage = null, hold_expires_at = null where id = p_trade_id;
    v_trade.hold_stage := null;
  end if;
  if s.review_holds_enabled and v_total <= s.review_hold_max_cents then
    if v_trade.hold_stage is null then
      select count(*)::int into v_holding from public.trade_requests
        where user_id = p_user_id and id <> p_trade_id and hold_stage is not null;
      if v_holding < s.review_holds_per_customer then
        v_hold_from := 'placed';
      end if;
    else
      v_hold_from := 'kept';
    end if;
  end if;
  if v_hold_from is not null then
    v_short := public.trade_reserve_core(p_trade_id, v_trade.trade_number);
    if v_short is not null then
      select string_agg(case when (x->>'available')::int > 0
                             then format('%s (only %s left)', x->>'card_name', x->>'available')
                             else x->>'card_name' end, ', ')
        into v_names from jsonb_array_elements(v_short) x;
      raise exception 'Some of our cards sold before your trade went in: %. Change those on your trade and send it again.', v_names
        using errcode = 'GT004';
    end if;
    if v_hold_from = 'placed' then
      update public.trade_requests set
        hold_stage = 'review',
        hold_expires_at = now() + make_interval(hours => s.review_hold_hours)
      where id = p_trade_id;
    end if;
    perform public.trade_log(p_trade_id, 'system', null, null, 'hold_' || v_hold_from, 'pending_review', 'pending_review',
      jsonb_build_object('stage', 'review',
                         'until', (select hold_expires_at from public.trade_requests where id = p_trade_id),
                         'wanted_total_cents', v_total));
  end if;
end;
$$;

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
  v_hold boolean := false;
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
  -- A local trade isn't confirmed by the customer any more: no confirmation deadline.
  if not v_local and (p_confirm_by is null or p_confirm_by <= now() or p_confirm_by > now() + interval '30 days') then
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
  if not exists (select 1 from public.trade_request_items where trade_request_id = p_trade_id and status in ('requested', 'reserved')) then
    raise exception 'None of our cards are on this trade any more.' using errcode = 'GT010';
  end if;
  v_short := public.trade_short_lines(p_trade_id);
  if jsonb_array_length(v_short) > 0 then
    raise exception '% isn''t available in that quantity any more. Change our cards on the trade, or ask the customer to.',
      v_short->0->>'card_name' using errcode = 'GT004';
  end if;

  -- Local pickup: approving holds our cards at once, with no deadline, until
  -- staff finish the trade at the meetup (trade_complete_local) or it's
  -- canceled. All or none: if one sold in the meantime, nothing is held.
  if v_local then
    v_short := public.trade_reserve_core(p_trade_id, v_trade.trade_number);
    if v_short is not null then
      raise exception '% isn''t available in that quantity any more. Change our cards on the trade, or ask the customer to.',
        v_short->0->>'card_name' using errcode = 'GT004';
    end if;
    update public.trade_requests set
      status = 'awaiting_shipment',
      approved_value_cents = null,
      approved_at = now(),
      confirm_by = null,
      confirm_by_original = null,
      reserved_at = now(),
      ship_days = null,
      ship_by = null,
      ship_by_original = null,
      deposit_cents = 0,
      deposit_reason = null,
      deposit_status = 'not_required',
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
    perform public.trade_log(p_trade_id, 'staff', p_actor_id, p_actor_label, 'approved', v_trade.status, 'awaiting_shipment',
      jsonb_build_object('approved_value_cents', null, 'conditions', nullif(btrim(p_conditions), ''),
                         'handoff_method', v_trade.handoff_method, 'held_until', 'finished',
                         'lines', (select jsonb_agg(jsonb_build_object('card_name', i.card_name, 'quantity', i.quantity, 'reservation_id', i.reservation_id))
                                   from public.trade_request_items i where i.trade_request_id = p_trade_id and i.status = 'reserved')));
    return 0;
  end if;

  -- Review holds on: our cards stay held through the confirmation window,
  -- whatever their value, so approving never lets them go before the
  -- customer can confirm. Anything not held yet (no review hold, or it ran
  -- out) is held now, all or none.
  v_hold := s.review_holds_enabled;
  if v_hold then
    v_short := public.trade_reserve_core(p_trade_id, v_trade.trade_number);
    if v_short is not null then
      raise exception '% isn''t available in that quantity any more. Change our cards on the trade, or ask the customer to.',
        v_short->0->>'card_name' using errcode = 'GT004';
    end if;
  end if;

  update public.trade_requests set
    status = 'awaiting_confirmation',
    hold_stage = case when v_hold then 'confirmation' end,
    hold_expires_at = case when v_hold then p_confirm_by end,
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
                       'deposit_cents', p_deposit_cents, 'deposit_reason', p_deposit_reason, 'held', v_hold,
                       'conditions', nullif(btrim(p_conditions), ''), 'handoff_method', v_trade.handoff_method));
  return coalesce(v_value, 0)::int;
end;
$$;

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
  v_hold boolean;
  v_released integer;
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
  -- A trade under a review hold keeps its cards held while it's edited: a
  -- card added is held at once (or the change is refused), one taken off is
  -- let go.
  v_hold := v_trade.hold_stage = 'review' and v_trade.status in ('pending_review', 'revision_requested');
  v_reserve := v_trade.status in ('awaiting_shipment', 'tracking_submitted', 'in_transit', 'received', 'under_inspection')
               or v_hold;
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
    -- A card already held in this quantity is left as it is: re-checking it
    -- (still on sale, still in stock) would let one stale card block taking
    -- a different card off the trade.
    if v_reserve and exists (
      select 1 from public.trade_request_items i
      where i.trade_request_id = p_trade_id and i.inventory_item_id = r.inv_id and i.status = 'reserved' and i.quantity = r.qty
    ) then
      continue;
    end if;
    perform public.trade_put_line(v_trade.id, v_trade.trade_number, r.inv_id, r.qty, v_reserve);
  end loop;

  v_total := public.trade_recount_wanted(p_trade_id);
  if s.max_trade_value_cents is not null and v_total > s.max_trade_value_cents then
    raise exception 'A trade can include up to % of our cards.', to_char(s.max_trade_value_cents / 100.0, 'FM$999,999,990.00') using errcode = 'GT006';
  end if;
  -- Past the most we hold during review: the hold ends, the trade carries on.
  if v_hold and v_total > s.review_hold_max_cents then
    v_released := public.trade_hold_return_lines(p_trade_id, coalesce(p_actor_label, p_actor_type));
    update public.trade_requests set hold_stage = null, hold_expires_at = null where id = p_trade_id;
    perform public.trade_log(p_trade_id, 'system', null, null, 'hold_released', v_trade.status, v_trade.status,
      jsonb_build_object('stage', 'review', 'why', 'over_limit', 'lines', v_released,
                         'wanted_total_cents', v_total, 'limit_cents', s.review_hold_max_cents));
  end if;
  perform public.trade_log(p_trade_id, p_actor_type, p_actor_id, p_actor_label, 'wanted_changed', v_trade.status, v_trade.status,
    jsonb_build_object('wanted_total_cents', v_total, 'reserved', v_reserve));
  return v_total;
end;
$$;

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
  elsif p_kind = 'hold' and v_trade.hold_stage = 'review' and v_trade.status in ('pending_review', 'revision_requested') then
    v_old := v_trade.hold_expires_at;
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
    -- A review hold moves with its own extension; a confirmation hold always
    -- lasts exactly as long as the time to confirm.
    hold_expires_at = case when p_kind = 'hold' then p_new_deadline
                           when p_kind = 'confirmation' and hold_stage = 'confirmation' then p_new_deadline
                           else hold_expires_at end,
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

-- ---------------------------------------------------------------------------
-- Who can call what: the server only (as with every trade function).

revoke all on function public.tg_trade_hold_stage_guard() from public, anon, authenticated;
revoke all on function public.trade_hold_return_lines(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.trade_release_expired_holds(integer) from public, anon, authenticated;
grant execute on function public.trade_release_expired_holds(integer) to service_role;
revoke all on function public.trade_hold_release(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.trade_hold_release(uuid, text, uuid, text) to service_role;
revoke all on function public.trade_reserve_core(uuid, bigint) from public, anon, authenticated;
revoke all on function public.trade_submit(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.trade_submit(uuid, uuid, text) to service_role;
revoke all on function public.trade_approve(uuid, timestamptz, integer, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.trade_approve(uuid, timestamptz, integer, text, text, uuid, text) to service_role;
revoke all on function public.trade_set_wanted(uuid, jsonb, text[], text, uuid, text) from public, anon, authenticated;
grant execute on function public.trade_set_wanted(uuid, jsonb, text[], text, uuid, text) to service_role;
revoke all on function public.trade_extend(uuid, text, timestamptz, integer, boolean, text, uuid, text) from public, anon, authenticated;
grant execute on function public.trade_extend(uuid, text, timestamptz, integer, boolean, text, uuid, text) to service_role;
