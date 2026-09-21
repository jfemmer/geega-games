-- Adds a second, independent activity feed to admin_analytics_overview():
-- customerActivity, sourced from customer-facing events (new orders, sell
-- submissions/buying leads, account signups, newsletter signups, saved
-- decks) as opposed to the existing recentActivity feed, which is staff/
-- inventory actions from inventory_movements. Same shape ({id,actor,action,
-- target,at}), same SECURITY DEFINER + is_staff() gating, same jsonb return
-- type (no signature change, so CREATE OR REPLACE is safe — no DROP/grant
-- reset needed).

begin;

create or replace function public.admin_analytics_overview(p_range text default '30d')
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
  v_customer_activity jsonb;
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

  -- Customer-site activity: what customers themselves are doing, distinct
  -- from the staff/inventory feed above. Unions five event sources, each
  -- capped and ordered before the final merge so one noisy source (e.g. a
  -- CSV-imported batch of profiles) can't crowd out the others.
  with combined as (
    (
      select
        'order:' || o.id::text as id,
        coalesce(
          nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
          nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''),
          o.email,
          'Walk-in customer'
        ) as actor,
        'placed an order' as action,
        '#' || upper(left(o.id::text, 8)) as target,
        o.created_at as at
      from public.orders o
      left join public.profiles p on p.id = o.user_id
      left join public.customers c on c.id = o.customer_id
      order by o.created_at desc
      limit 20
    )
    union all
    (
      select
        'lead:' || s.id::text,
        coalesce(nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), s.email, 'Guest'),
        'submitted a sell request',
        s.reference_number::text,
        s.created_at
      from public.sell_submissions s
      order by s.created_at desc
      limit 20
    )
    union all
    (
      select
        'signup:' || pr.id::text,
        coalesce(nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''), 'New customer'),
        'created an account',
        null::text,
        pr.created_at
      from public.profiles pr
      order by pr.created_at desc
      limit 20
    )
    union all
    (
      select
        'newsletter:' || n.id::text,
        n.email,
        'subscribed to the newsletter',
        null::text,
        n.created_at
      from public.newsletter_subscribers n
      order by n.created_at desc
      limit 20
    )
    union all
    (
      select
        'deck:' || d.id::text,
        coalesce(nullif(trim(coalesce(pd.first_name, '') || ' ' || coalesce(pd.last_name, '')), ''), 'A customer'),
        'saved a deck',
        d.name,
        d.created_at
      from public.customer_decks d
      left join public.profiles pd on pd.id = d.user_id
      order by d.created_at desc
      limit 20
    )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'actor', actor,
      'action', action,
      'target', target,
      'at', at
    ) order by at desc), '[]'::jsonb)
  into v_customer_activity
  from (
    select * from combined order by at desc limit 20
  ) capped;

  return jsonb_build_object(
    'metrics', v_metrics,
    'revenue', coalesce(v_revenue, '[]'::jsonb),
    'orders', coalesce(v_orders, '[]'::jsonb),
    'recentActivity', v_activity,
    'customerActivity', v_customer_activity
  );
end;
$function$;

revoke all on function public.admin_analytics_overview(text) from public, anon, authenticated;
grant execute on function public.admin_analytics_overview(text) to authenticated, service_role;

commit;
