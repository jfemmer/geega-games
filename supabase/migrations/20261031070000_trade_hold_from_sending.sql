-- Trade Center: our cards are held from the moment a trade is sent.
--
-- Before: a trade's cards (ours) stayed on sale while staff reviewed it, and
-- (shipped trades) until the customer confirmed and paid any deposit; a local
-- trade's were held from approval. A shopper could buy a card that was on a
-- trade waiting for review, and staff only found out when approving.
--
-- Now, for shipped and local trades alike:
--   awaiting_trade_list   A draft: nothing held (as before).
--   → pending_review      Sending it holds every one of our cards, all or
--                         none (trade_submit → trade_reserve_core). If one
--                         sold meanwhile, it isn't sent, and the customer is
--                         told which.
--   revision_requested,   Still held. Cards the customer or staff add are
--   awaiting_confirmation, held as they're added; cards taken off go back on
--   awaiting_deposit      sale (trade_set_wanted).
--   awaiting_shipment …   Held, as before. A shipped trade's deposit still
--                         guards the shipping window.
-- The hold ends whenever the trade closes (trade_close_core releases every
-- hold): rejected, canceled by the customer (free until a shipped trade is
-- reserved for shipping, as before) or the store, or out of time (changes
-- not sent, approval not confirmed, deposit not paid). A trade waiting for
-- review has no deadline: it stays held until staff review it.
--
-- Approving checks the held lines again (trade_held_problems): a held copy
-- archived, or its quantity cut below its holds, in Inventory since the
-- trade was sent is refused (GT004) so staff can take it off first.
--
-- Trades sent before this update with cards not held yet get them held when
-- approved (all or none). trade_confirm and trade_reserve work unchanged:
-- trade_reserve_core now has nothing to do when every line is already held.
--
-- Run after 20261031010000_trade_local_hold_until_finished.sql. Safe to run
-- more than once.

-- 1. Holding: lines already held need nothing more -----------------------------------
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
  -- Nothing on the trade at all is a short trade; lines already held (since
  -- the trade was sent) need nothing more.
  if not exists (select 1 from public.trade_request_items where trade_request_id = p_trade_id and status in ('requested', 'reserved')) then
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

-- 2. Sending a trade holds our cards ----------------------------------------------------
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
  v_short jsonb;
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
  -- Lines already held count too (sent again after changes were asked for).
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

  -- Sending the trade takes our cards off sale, all or none: from now on no
  -- one else can buy them, until the trade is finished, canceled, rejected
  -- or runs out of time.
  v_short := public.trade_reserve_core(p_trade_id, v_trade.trade_number);
  if v_short is not null then
    raise exception '% isn''t available in that quantity any more. Change our cards on your trade and send it again.',
      v_short->0->>'card_name' using errcode = 'GT004';
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
                       'handoff_method', v_trade.handoff_method, 'held', true,
                       'lines', (select jsonb_agg(jsonb_build_object('card_name', i.card_name, 'quantity', i.quantity, 'reservation_id', i.reservation_id))
                                 from public.trade_request_items i where i.trade_request_id = p_trade_id and i.status = 'reserved')));
end;
$$;

-- 3. Approving holds anything not held yet ---------------------------------------------
-- Lines held since the trade was sent are checked again when staff approve
-- it: the hold itself still active, and the copy still for sale in a
-- quantity that covers every hold on it. A held copy can still be archived or
-- have its quantity cut in Inventory, and a trade waiting for review can sit
-- for a while; this catches it before the customer is told to go ahead
-- (otherwise it only showed when the trade was finished). Same shape as
-- trade_short_lines.
create or replace function public.trade_held_problems(p_trade_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'card_name', l.card_name, 'wanted', l.quantity,
           'available', case when i.status = 'active' and r.status = 'active'
                             then greatest(0, l.quantity - greatest(0, held.total - i.quantity)) else 0 end)
           order by l.card_name), '[]'::jsonb)
  from public.trade_request_items l
  left join public.inventory_reservations r on r.id = l.reservation_id
  left join public.inventory_items i on i.id = l.inventory_item_id
  left join lateral (
    select coalesce(sum(x.quantity), 0)::int as total
    from public.inventory_reservations x
    where x.inventory_item_id = l.inventory_item_id and x.status = 'active'
  ) held on true
  where l.trade_request_id = p_trade_id
    and l.status = 'reserved'
    and (r.id is null or r.status <> 'active' or i.id is null or i.status <> 'active' or held.total > i.quantity);
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
  v_short := coalesce(public.trade_short_lines(p_trade_id), '[]'::jsonb) || public.trade_held_problems(p_trade_id);
  if jsonb_array_length(v_short) > 0 then
    raise exception '% isn''t available in that quantity any more. Change our cards on the trade, or ask the customer to.',
      v_short->0->>'card_name' using errcode = 'GT004';
  end if;

  -- Our cards are held from when the trade was sent; any not held yet (a
  -- trade sent before that, or a card staff added since) are held now, all
  -- or none. A local pickup trade then stays held, with no deadline, until
  -- staff finish it at the meetup (trade_complete_local) or it's canceled.
  -- A shipped one stays held while the customer confirms (and pays any
  -- deposit); if they don't in time, it closes and the hold ends.
  v_short := public.trade_reserve_core(p_trade_id, v_trade.trade_number);
  if v_short is not null then
    raise exception '% isn''t available in that quantity any more. Change our cards on the trade, or ask the customer to.',
      v_short->0->>'card_name' using errcode = 'GT004';
  end if;
  if v_local then
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

-- 4. Changing our cards on a sent trade holds or frees them at once -------------------
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
  -- Held from when the trade is sent: only a draft's cards aren't held.
  v_reserve := v_trade.status in ('pending_review', 'revision_requested', 'awaiting_confirmation', 'awaiting_deposit',
                                  'awaiting_shipment', 'tracking_submitted', 'in_transit', 'received', 'under_inspection');
  if not v_reserve and v_trade.status <> 'awaiting_trade_list' then
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
  perform public.trade_log(p_trade_id, p_actor_type, p_actor_id, p_actor_label, 'wanted_changed', v_trade.status, v_trade.status,
    jsonb_build_object('wanted_total_cents', v_total, 'reserved', v_reserve));
  return v_total;
end;
$$;

-- 5. Only the server may call these -------------------------------------------------
revoke all on function public.trade_reserve_core(uuid, bigint) from public, anon, authenticated;
grant execute on function public.trade_reserve_core(uuid, bigint) to service_role;
revoke all on function public.trade_submit(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.trade_submit(uuid, uuid, text) to service_role;
revoke all on function public.trade_held_problems(uuid) from public, anon, authenticated;
grant execute on function public.trade_held_problems(uuid) to service_role;
revoke all on function public.trade_approve(uuid, timestamptz, integer, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.trade_approve(uuid, timestamptz, integer, text, text, uuid, text) to service_role;
revoke all on function public.trade_set_wanted(uuid, jsonb, text[], text, uuid, text) from public, anon, authenticated;
grant execute on function public.trade_set_wanted(uuid, jsonb, text[], text, uuid, text) to service_role;
