-- Trade Center: a local pickup trade holds our cards from approval until
-- it's finished.
--
-- Before: staff approved a local trade, the customer confirmed it, and only
-- then were our cards held, for local_meet_days; a hold that ran out expired
-- the trade and put the cards back on sale.
--
-- Now (handoff_method = 'local' only; shipped trades are unchanged):
--   pending_review → awaiting_shipment   Approving holds our cards at once,
--                                        all or none, with no deadline
--                                        (ship_by stays null). The customer
--                                        doesn't confirm.
--   awaiting_shipment → completed        Staff finish it at the meetup
--                                        (trade_complete_local), as before.
-- Until then the hold only ends when the trade is canceled (by the customer
-- or the store); trade_expire_due never expires a local trade's hold.
-- Staff can still take cards off (trade_set_wanted): each goes straight back
-- on sale. A local trade staff released early and then reinstate comes back
-- held the same way, with no deadline (trade_reinstate).
--
-- Local trades approved before this update and still waiting for the
-- customer's confirmation keep working as before (trade_confirm is
-- unchanged); once confirmed, their hold doesn't run out either.
--
-- Run after 20261027230000_trade_local_pickup.sql. Safe to run more than once.

-- 1. Approving a local trade holds our cards ---------------------------------------
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
  if not exists (select 1 from public.trade_request_items where trade_request_id = p_trade_id and status = 'requested') then
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


-- 2. A local trade's hold never runs out --------------------------------------------
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
     -- A local pickup trade's hold never runs out: it ends when staff finish or cancel it.
     or (t.status = 'awaiting_shipment' and t.handoff_method <> 'local' and t.ship_by < now())
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


-- 3. Reinstating a local trade holds our cards again, with no deadline ---------------
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
  -- A local pickup trade comes back held until it's finished: no deadline.
  if p_mode = 'awaiting_shipment' and v_trade.handoff_method = 'local' and p_ship_by is not null then
    raise exception 'A local pickup trade is held until it''s finished: no deadline.' using errcode = 'GT010';
  end if;
  if p_mode = 'awaiting_shipment' and v_trade.handoff_method <> 'local'
     and (p_ship_by is null or p_ship_by <= now() or p_ship_by > now() + interval '60 days') then
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
    ship_by_original = case when p_mode = 'awaiting_shipment' and v_trade.handoff_method = 'local' then null else ship_by_original end,
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

-- 4. Only the server may call these -------------------------------------------------
revoke all on function public.trade_approve(uuid, timestamptz, integer, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.trade_approve(uuid, timestamptz, integer, text, text, uuid, text) to service_role;
revoke all on function public.trade_expire_due(integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.trade_expire_due(integer, integer, boolean) to service_role;
revoke all on function public.trade_reinstate(uuid, text, timestamptz, timestamptz, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.trade_reinstate(uuid, text, timestamptz, timestamptz, boolean, uuid, text) to service_role;
