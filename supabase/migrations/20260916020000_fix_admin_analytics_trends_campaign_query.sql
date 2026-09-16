-- Fixes a real bug in admin_analytics_trends (introduced in
-- 20260916010000_admin_analytics_real_data.sql): the campaign-performance
-- query applied ORDER BY sent_at / LIMIT directly around a bare
-- jsonb_agg(...) over public.campaigns, with no GROUP BY. Since jsonb_agg
-- collapses the whole query to one row, ordering by a non-aggregated column
-- of the (multi-row) source table is invalid — Postgres correctly rejected
-- it with "column campaigns.sent_at must appear in the GROUP BY clause",
-- which is what actually broke the live Trends page ("Could not load
-- trends."). Every other ordered+limited aggregate in this function
-- (topCards, topSets, aging) already used the correct pattern: select the
-- raw rows (ordered + limited) in a subquery first, THEN aggregate. This
-- applies that same fix here. Verified live against the real database for
-- all four ranges (7d/30d/90d/ytd) before applying.

begin;

create or replace function public.admin_analytics_trends(p_range text default '30d')
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
  if not public.is_staff() and current_user <> 'service_role' then
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

commit;
