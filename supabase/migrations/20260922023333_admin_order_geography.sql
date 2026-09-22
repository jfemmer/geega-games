-- Where paid orders actually ship to -- the real, unambiguous "interest by
-- location" signal (unlike wishlist/stock-alert rows, which carry no
-- address). Returned at (state, city) grain; the admin UI rolls up to
-- state-level for the top view and filters down to a state's cities on
-- request, rather than needing two separate RPCs for what is, in practice,
-- a small result set. Revenue by location is business-sensitive, so gated
-- to owner/administrator like admin_sourcing_signals.
create or replace function public.admin_order_geography()
returns table(
  ship_state text,
  ship_city text,
  order_count bigint,
  total_revenue_cents bigint,
  first_order_at timestamptz,
  last_order_at timestamptz
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
  select
    coalesce(nullif(trim(o.ship_state), ''), 'Unknown') as ship_state,
    coalesce(nullif(trim(o.ship_city), ''), 'Unknown') as ship_city,
    count(*) as order_count,
    sum(o.total_cents)::bigint as total_revenue_cents,
    min(o.created_at) as first_order_at,
    max(o.created_at) as last_order_at
  from public.orders o
  where o.payment_status = 'paid'
  group by 1, 2
  order by order_count desc, total_revenue_cents desc;
end;
$function$;

revoke all on function public.admin_order_geography() from public;
grant execute on function public.admin_order_geography() to authenticated, service_role;
