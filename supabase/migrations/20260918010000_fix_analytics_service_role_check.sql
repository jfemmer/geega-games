-- Same bug class already fixed for pos_create_sale/kiosk_create_pickup_request/
-- pos_cancel_pickup_request/pos_complete_pickup_sale in
-- 20260916091000_fix_pos_service_role_check.sql: inside a SECURITY DEFINER
-- function, current_user is always the function's OWNER for the duration of
-- the call, never the actual caller — so `current_user <> 'service_role'`
-- can never detect a service-role caller. Harmless today (these two
-- functions are only ever called directly by staff with their own JWT, so
-- the check collapses to `not is_staff()`, which still correctly rejects
-- non-staff), but it silently breaks the moment either is called from a
-- service-role path, exactly like the POS functions did. auth.role() reads
-- a session-level GUC that survives the SECURITY DEFINER identity switch,
-- so it actually works.

create or replace function public.admin_analytics_overview(p_range text default '30d'::text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_range_end timestamptz := now();
  v_range_start timestamptz;
  v_prev_start timestamptz;
  v_prev_end timestamptz;
  v_metrics jsonb;
  v_revenue jsonb;
  v_orders jsonb;
  v_activity jsonb;
begin
  if not (public.is_staff() or auth.role() = 'service_role') then
    raise exception 'Staff access required' using errcode = '42501';
  end if;

  case p_range
    when '7d' then v_range_start := v_range_end - interval '7 days';
    when '90d' then v_range_start := v_range_end - interval '90 days';
    when 'ytd' then v_range_start := date_trunc('year', v_range_end);
    else v_range_start := v_range_end - interval '30 days';
  end case;

  if p_range = 'ytd' then
    v_prev_start := v_range_start - interval '1 year';
    v_prev_end := v_range_end - interval '1 year';
  else
    v_prev_end := v_range_start;
    v_prev_start := v_range_start - (v_range_end - v_range_start);
  end if;

  with cur as (
    select coalesce(sum(total_cents), 0)::bigint as revenue, count(*) as orders
    from public.orders
    where payment_status = 'paid' and paid_at >= v_range_start and paid_at < v_range_end
  ),
  prev as (
    select coalesce(sum(total_cents), 0)::bigint as revenue, count(*) as orders
    from public.orders
    where payment_status = 'paid' and paid_at >= v_prev_start and paid_at < v_prev_end
  )
  select jsonb_build_object(
    'revenueCents', cur.revenue,
    'revenuePrevCents', prev.revenue,
    'orderCount', cur.orders,
    'orderCountPrev', prev.orders,
    'averageOrderValueCents', case when cur.orders > 0 then round(cur.revenue::numeric / cur.orders) else 0 end,
    'averageOrderValuePrevCents', case when prev.orders > 0 then round(prev.revenue::numeric / prev.orders) else 0 end,
    'ordersNeedingPacking', (select count(*) from public.orders where status = 'paid'),
    'ordersReadyToShip', (select count(*) from public.orders where status = 'ready_to_ship'),
    'ordersShippedToday', (select count(*) from public.orders where shipped_at::date = current_date),
    'totalInventoryUnits', (select coalesce(sum(quantity), 0) from public.inventory_items where status = 'active'),
    'lowStockCount', (select count(*) from public.inventory_items where quantity > 0 and quantity <= 2),
    'activeCustomers', (select count(*) from public.customers where status = 'active'),
    'activeSubscribers', (select count(*) from public.newsletter_subscribers where status = 'active')
  ) into v_metrics
  from cur, prev;

  -- Zero-filled daily series (real gaps show as real zeros, never skipped).
  with days as (
    select generate_series(date_trunc('day', v_range_start), date_trunc('day', v_range_end), interval '1 day')::date as d
  ),
  daily as (
    select date_trunc('day', paid_at)::date as d, sum(total_cents) as revenue, count(*) as orders
    from public.orders
    where payment_status = 'paid' and paid_at >= v_range_start and paid_at < v_range_end
    group by 1
  )
  select
    jsonb_agg(jsonb_build_object('date', to_char(days.d, 'YYYY-MM-DD'), 'value', coalesce(daily.revenue, 0)) order by days.d),
    jsonb_agg(jsonb_build_object('date', to_char(days.d, 'YYYY-MM-DD'), 'value', coalesce(daily.orders, 0)) order by days.d)
  into v_revenue, v_orders
  from days left join daily on daily.d = days.d;

  -- Real inventory-movement history, newest first. No fabricated actor
  -- names — actor is whatever the write path actually recorded.
  select coalesce(jsonb_agg(x order by (x ->> 'at') desc), '[]'::jsonb) into v_activity
  from (
    select jsonb_build_object(
      'id', m.id::text,
      'actor', coalesce(nullif(m.actor, ''), 'System'),
      'action', case m.reason
        when 'manual_add' then 'added'
        when 'manual_remove' then 'removed'
        when 'correction' then 'corrected'
        when 'scan_add' then 'scanned in'
        when 'batch_scan_add' then 'scanned in'
        when 'order_reserved' then 'reserved'
        when 'order_shipped' then 'shipped'
        when 'order_cancelled' then 'released'
        when 'import' then 'imported'
        when 'archive' then 'archived'
        when 'restore' then 'restored'
        else m.reason::text
      end,
      'target', m.card_name,
      'at', m.created_at
    ) as x
    from public.inventory_movements m
    order by m.created_at desc
    limit 20
  ) sub;

  return jsonb_build_object(
    'metrics', v_metrics,
    'revenue', coalesce(v_revenue, '[]'::jsonb),
    'orders', coalesce(v_orders, '[]'::jsonb),
    'recentActivity', v_activity
  );
end;
$function$;

create or replace function public.admin_analytics_trends(p_range text default '30d'::text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_range_end timestamptz := now();
  v_range_start timestamptz;
  v_units_sold bigint;
  v_revenue_cents bigint;
  v_order_count bigint;
  v_revenue_series jsonb;
  v_order_series jsonb;
  v_top_cards jsonb;
  v_top_sets jsonb;
  v_by_condition jsonb;
  v_by_finish jsonb;
  v_inventory_value bigint;
  v_cost_basis bigint;
  v_aging jsonb;
  v_new_customers bigint;
  v_repeat_customers bigint;
  v_newsletter_growth jsonb;
  v_campaign_performance jsonb;
begin
  if not (public.is_staff() or auth.role() = 'service_role') then
    raise exception 'Staff access required' using errcode = '42501';
  end if;

  case p_range
    when '7d' then v_range_start := v_range_end - interval '7 days';
    when '90d' then v_range_start := v_range_end - interval '90 days';
    when 'ytd' then v_range_start := date_trunc('year', v_range_end);
    else v_range_start := v_range_end - interval '30 days';
  end case;

  select coalesce(sum(oi.quantity), 0), coalesce(sum(o.total_cents), 0), count(distinct o.id)
    into v_units_sold, v_revenue_cents, v_order_count
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where o.payment_status = 'paid' and o.paid_at >= v_range_start and o.paid_at < v_range_end;

  with days as (
    select generate_series(date_trunc('day', v_range_start), date_trunc('day', v_range_end), interval '1 day')::date as d
  ),
  daily as (
    select date_trunc('day', paid_at)::date as d, sum(total_cents) as revenue, count(*) as orders
    from public.orders
    where payment_status = 'paid' and paid_at >= v_range_start and paid_at < v_range_end
    group by 1
  )
  select
    jsonb_agg(jsonb_build_object('date', to_char(days.d, 'YYYY-MM-DD'), 'value', coalesce(daily.revenue, 0)) order by days.d),
    jsonb_agg(jsonb_build_object('date', to_char(days.d, 'YYYY-MM-DD'), 'value', coalesce(daily.orders, 0)) order by days.d)
  into v_revenue_series, v_order_series
  from days left join daily on daily.d = days.d;

  select coalesce(jsonb_agg(jsonb_build_object('label', card_name, 'value', units, 'secondary', revenue_cents) order by units desc), '[]'::jsonb)
    into v_top_cards
  from (
    select oi.card_name, sum(oi.quantity) as units, sum(oi.line_total_cents) as revenue_cents
    from public.orders o join public.order_items oi on oi.order_id = o.id
    where o.payment_status = 'paid' and o.paid_at >= v_range_start and o.paid_at < v_range_end
    group by oi.card_name
    order by units desc
    limit 10
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('label', set_name, 'value', units, 'secondary', revenue_cents) order by units desc), '[]'::jsonb)
    into v_top_sets
  from (
    select oi.set_name, sum(oi.quantity) as units, sum(oi.line_total_cents) as revenue_cents
    from public.orders o join public.order_items oi on oi.order_id = o.id
    where o.payment_status = 'paid' and o.paid_at >= v_range_start and o.paid_at < v_range_end
    group by oi.set_name
    order by units desc
    limit 10
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('label', condition::text, 'value', round(100.0 * units / nullif(v_units_sold, 0), 1)) order by units desc), '[]'::jsonb)
    into v_by_condition
  from (
    select oi.condition, sum(oi.quantity) as units
    from public.orders o join public.order_items oi on oi.order_id = o.id
    where o.payment_status = 'paid' and o.paid_at >= v_range_start and o.paid_at < v_range_end
    group by oi.condition
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('label', finish::text, 'value', round(100.0 * units / nullif(v_units_sold, 0), 1)) order by units desc), '[]'::jsonb)
    into v_by_finish
  from (
    select oi.finish, sum(oi.quantity) as units
    from public.orders o join public.order_items oi on oi.order_id = o.id
    where o.payment_status = 'paid' and o.paid_at >= v_range_start and o.paid_at < v_range_end
    group by oi.finish
  ) x;

  select coalesce(sum(price_cents::bigint * quantity), 0), coalesce(sum(coalesce(cost_cents, 0)::bigint * quantity), 0)
    into v_inventory_value, v_cost_basis
  from public.inventory_items
  where status = 'active';

  select coalesce(jsonb_agg(jsonb_build_object('label', bucket, 'value', cards) order by sort_order), '[]'::jsonb)
    into v_aging
  from (
    select
      case
        when now() - created_at < interval '30 days' then '0-30 days'
        when now() - created_at < interval '60 days' then '31-60 days'
        when now() - created_at < interval '90 days' then '61-90 days'
        else '90+ days'
      end as bucket,
      case
        when now() - created_at < interval '30 days' then 1
        when now() - created_at < interval '60 days' then 2
        when now() - created_at < interval '90 days' then 3
        else 4
      end as sort_order,
      sum(quantity) as cards
    from public.inventory_items
    where status = 'active'
    group by 1, 2
  ) x;

  select count(*) into v_new_customers
  from public.customers
  where created_at >= v_range_start and created_at < v_range_end;

  select count(*) into v_repeat_customers
  from (
    select o.user_id
    from public.orders o
    where o.payment_status = 'paid' and o.paid_at >= v_range_start and o.paid_at < v_range_end
    group by o.user_id
    having (select count(*) from public.orders o2 where o2.user_id = o.user_id and o2.payment_status = 'paid') >= 2
  ) x;

  with days as (
    select generate_series(date_trunc('day', v_range_start), date_trunc('day', v_range_end), interval '1 day')::date as d
  ),
  daily as (
    select date_trunc('day', created_at)::date as d, count(*) as n
    from public.newsletter_subscribers
    where status = 'active' and created_at >= v_range_start and created_at < v_range_end
    group by 1
  )
  select jsonb_agg(jsonb_build_object('date', to_char(days.d, 'YYYY-MM-DD'), 'value', coalesce(daily.n, 0)) order by days.d)
    into v_newsletter_growth
  from days left join daily on daily.d = days.d;

  select coalesce(jsonb_agg(jsonb_build_object(
      'label', name,
      'value', round(100.0 * open_count / nullif(delivered_count, 0), 1),
      'secondary', click_count
    ) order by sent_at desc), '[]'::jsonb)
    into v_campaign_performance
  from (
    select name, open_count, delivered_count, click_count, sent_at
    from public.campaigns
    where status = 'sent' and sent_at >= v_range_start and sent_at < v_range_end
    order by sent_at desc
    limit 10
  ) x;

  return jsonb_build_object(
    'revenueSeries', coalesce(v_revenue_series, '[]'::jsonb),
    'orderSeries', coalesce(v_order_series, '[]'::jsonb),
    'averageOrderValueCents', case when v_order_count > 0 then round(v_revenue_cents::numeric / v_order_count) else 0 end,
    'unitsSold', v_units_sold,
    'topCards', v_top_cards,
    'topSets', v_top_sets,
    'salesByCondition', v_by_condition,
    'salesByFinish', v_by_finish,
    'inventoryValueCents', v_inventory_value,
    'estimatedCostBasisCents', v_cost_basis,
    'estimatedGrossMarginCents', v_inventory_value - v_cost_basis,
    'lowStockCount', (select count(*) from public.inventory_items where quantity > 0 and quantity <= 2),
    'agingInventory', v_aging,
    'newCustomers', v_new_customers,
    'repeatCustomers', v_repeat_customers,
    'newsletterGrowth', coalesce(v_newsletter_growth, '[]'::jsonb),
    'campaignPerformance', v_campaign_performance
  );
end;
$function$;
