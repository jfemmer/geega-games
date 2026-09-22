-- Ranks unmet customer demand for sourcing decisions: combines wishlist saves
-- (customer_wishlist_items) with still-pending back-in-stock subscriptions
-- (card_stock_subscriptions where notified_at is null -- once notified, that
-- subscriber has already gotten their answer, so it's no longer open demand).
-- Business-sensitive (tells you exactly what to go buy), so gated to
-- owner/administrator like admin_audit_log, not all staff.
create or replace function public.admin_sourcing_signals()
returns table(
  oracle_id uuid,
  card_name text,
  wishlist_count bigint,
  stock_alert_count bigint,
  total_demand bigint,
  currently_in_stock boolean,
  in_stock_quantity integer
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not (public.is_staff() and public.current_staff_role() = any(array['owner','administrator']))
     and auth.role() <> 'service_role' then
    raise exception 'Owner or administrator access required' using errcode = '42501';
  end if;

  return query
  with wishlist_agg as (
    select w.oracle_id, max(w.card_name) as card_name, count(*) as cnt
    from public.customer_wishlist_items w
    group by w.oracle_id
  ),
  alert_agg as (
    select s.oracle_id, max(s.card_name) as card_name, count(*) as cnt
    from public.card_stock_subscriptions s
    where s.notified_at is null
    group by s.oracle_id
  ),
  combined as (
    select
      coalesce(w.oracle_id, a.oracle_id) as oracle_id,
      coalesce(w.card_name, a.card_name) as card_name,
      coalesce(w.cnt, 0) as wishlist_count,
      coalesce(a.cnt, 0) as stock_alert_count
    from wishlist_agg w
    full outer join alert_agg a on a.oracle_id = w.oracle_id
  ),
  stock as (
    select i.oracle_id, sum(greatest(0, i.quantity)) as qty
    from public.inventory_items i
    where i.status = 'active'
    group by i.oracle_id
  )
  select
    c.oracle_id,
    c.card_name,
    c.wishlist_count,
    c.stock_alert_count,
    (c.wishlist_count + c.stock_alert_count) as total_demand,
    coalesce(s.qty, 0) > 0 as currently_in_stock,
    coalesce(s.qty, 0)::int as in_stock_quantity
  from combined c
  left join stock s on s.oracle_id = c.oracle_id
  order by total_demand desc, card_name asc
  limit 200;
end;
$function$;

revoke all on function public.admin_sourcing_signals() from public;
grant execute on function public.admin_sourcing_signals() to authenticated, service_role;
