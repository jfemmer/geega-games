-- Trade Center: local pickup trades get their own terms.
--
-- Local pickup trades no longer have to share every setting with shipped
-- trades. These five apply to local pickup only (shipped trades keep using
-- the settings they always have):
--   local_credit_rate_percent    trade credit per $1 of their cards' value
--   local_min_card_value_cents   the per-card minimum ("staples worth $X+")
--   local_min_trade_value_cents  the minimum of our cards to start or send one
--   local_cash_payout_enabled    whether credit left over can be paid in cash
--   local_cash_rate_percent      the cash rate when it is
-- Each starts as a copy of the shipped setting, so nothing changes until
-- staff change them in Trades, Settings, Local pickup.
--
-- Like the shipped terms, a trade takes the rate and per-card minimum when
-- it starts (trade_requests.credit_rate_percent / min_card_value_cents), and
-- takes on the other way's terms if the customer switches how they'll trade
-- before sending it. The minimum trade is checked against today's setting
-- for the trade's way when it starts and when it's sent, and the cash rate
-- when a local trade is finished at the meetup.
--
-- Run after 20261027230000_trade_local_pickup.sql. Safe to run more than once.

-- 1. Settings ------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trade_settings' and column_name = 'local_credit_rate_percent'
  ) then
    alter table public.trade_settings
      add column local_credit_rate_percent integer not null default 80,
      add column local_min_card_value_cents integer not null default 1500,
      add column local_min_trade_value_cents integer not null default 7500,
      add column local_cash_payout_enabled boolean not null default false,
      add column local_cash_rate_percent integer not null default 50;
    -- Start from what shipped trades use today.
    update public.trade_settings set
      local_credit_rate_percent = credit_rate_percent,
      local_min_card_value_cents = min_card_value_cents,
      local_min_trade_value_cents = min_trade_value_cents,
      local_cash_payout_enabled = cash_payout_enabled,
      local_cash_rate_percent = cash_rate_percent;
  end if;
end$$;

alter table public.trade_settings drop constraint if exists trade_settings_local_credit_rate_percent_check;
alter table public.trade_settings add constraint trade_settings_local_credit_rate_percent_check
  check (local_credit_rate_percent between 1 and 100);
alter table public.trade_settings drop constraint if exists trade_settings_local_min_card_value_cents_check;
alter table public.trade_settings add constraint trade_settings_local_min_card_value_cents_check
  check (local_min_card_value_cents between 0 and 10000000);
alter table public.trade_settings drop constraint if exists trade_settings_local_min_trade_value_cents_check;
alter table public.trade_settings add constraint trade_settings_local_min_trade_value_cents_check
  check (local_min_trade_value_cents between 0 and 100000000);
alter table public.trade_settings drop constraint if exists trade_settings_local_cash_rate_percent_check;
alter table public.trade_settings add constraint trade_settings_local_cash_rate_percent_check
  check (local_cash_rate_percent between 1 and 100);

comment on column public.trade_settings.local_credit_rate_percent is
  'Local pickup: trade credit per $1 of the customer''s cards at TCG low (shipped trades use credit_rate_percent).';
comment on column public.trade_settings.local_min_card_value_cents is
  'Local pickup: the least a card can be worth, each, at TCG low (shipped trades use min_card_value_cents).';
comment on column public.trade_settings.local_min_trade_value_cents is
  'Local pickup: the least of our cards a trade can start or be sent with (shipped trades use min_trade_value_cents).';
comment on column public.trade_settings.local_cash_payout_enabled is
  'Local pickup: credit left over can be paid in cash at the meetup (shipped trades use cash_payout_enabled).';
comment on column public.trade_settings.local_cash_rate_percent is
  'Local pickup: cash per $1 of card value when credit left over is paid in cash (shipped trades use cash_rate_percent).';

-- 2. Starting a trade: local pickup's own rate, per-card minimum and minimum trade --
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
  v_min integer;
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
    -- Local pickup trades run on their own rate and per-card minimum.
    case when v_method = 'local' then s.local_credit_rate_percent else s.credit_rate_percent end,
    case when v_method = 'local' then s.local_min_card_value_cents else s.min_card_value_cents end,
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
  v_min := case when v_method = 'local' then s.local_min_trade_value_cents else s.min_trade_value_cents end;
  if v_total < v_min then
    raise exception 'Add % more in cards to reach the % minimum trade value.',
      to_char((v_min - v_total) / 100.0, 'FM$999,999,990.00'),
      to_char(v_min / 100.0, 'FM$999,999,990.00') using errcode = 'GT005';
  end if;
  if s.max_trade_value_cents is not null and v_total > s.max_trade_value_cents then
    raise exception 'A trade can include up to % of our cards.', to_char(s.max_trade_value_cents / 100.0, 'FM$999,999,990.00') using errcode = 'GT006';
  end if;

  perform public.trade_log(v_trade.id, 'customer', p_user_id, left(coalesce(p_customer_email, ''), 200), 'started', null, 'awaiting_trade_list',
    jsonb_build_object('wanted_total_cents', v_total, 'list_due_at', v_trade.list_due_at, 'handoff_method', v_method));
  return v_trade.id;
end;
$$;

-- 3. Switching how they'll trade takes on that way's terms ---------------------------
create or replace function public.trade_set_handoff(p_trade_id uuid, p_user_id uuid, p_handoff_method text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.trade_settings%rowtype;
  v_trade public.trade_requests%rowtype;
  v_rate integer;
  v_min_card integer;
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
  -- The trade takes on today's terms for how they'll trade now (nothing
  -- has been reviewed yet, so there's nothing earlier to honor).
  v_rate := case when p_handoff_method = 'local' then s.local_credit_rate_percent else s.credit_rate_percent end;
  v_min_card := case when p_handoff_method = 'local' then s.local_min_card_value_cents else s.min_card_value_cents end;
  update public.trade_requests set
    handoff_method = p_handoff_method,
    credit_rate_percent = v_rate,
    min_card_value_cents = v_min_card
  where id = p_trade_id;
  perform public.trade_log(p_trade_id, 'customer', p_user_id, v_trade.customer_email, 'handoff_changed', v_trade.status, v_trade.status,
    jsonb_build_object('from', v_trade.handoff_method, 'to', p_handoff_method,
                       'credit_rate_percent', v_rate, 'min_card_value_cents', v_min_card));
end;
$$;

-- 4. Sending it: the minimum trade for how they'll trade -----------------------------
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
end;
$$;

-- 5. Finishing at the meetup: local pickup's own cash payouts ------------------------
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
    if not s.local_cash_payout_enabled then
      raise exception 'Cash payouts for local pickup are turned off in Trades, Settings.' using errcode = 'GT010';
    end if;
    if v_excess = 0 then
      raise exception 'There''s no credit left over to pay in cash.' using errcode = 'GT010';
    end if;
    -- The same card value at the cash rate instead of the credit rate.
    v_cash := round(v_excess * s.local_cash_rate_percent / v_trade.credit_rate_percent::numeric)::int;
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

-- 6. Only the server may call these --------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.trade_start(uuid, jsonb, text, text, text)',
    'public.trade_set_handoff(uuid, uuid, text)',
    'public.trade_submit(uuid, uuid, text)',
    'public.trade_complete_local(uuid, jsonb, integer, text, text, boolean, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end$$;
