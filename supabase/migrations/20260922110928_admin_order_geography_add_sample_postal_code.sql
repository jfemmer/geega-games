-- Adds a representative postal code per (state, city) group so the client
-- can geocode real order locations for the Order Geography map. Checkout
-- collects ship_postal_code as free text with no validation, so this picks
-- the first value that actually looks like a 5-digit US zip (earliest by
-- order date, for determinism) rather than trusting every row.
drop function if exists public.admin_order_geography();

create or replace function public.admin_order_geography()
returns table(
  ship_state text,
  ship_city text,
  order_count bigint,
  total_revenue_cents bigint,
  first_order_at timestamptz,
  last_order_at timestamptz,
  sample_postal_code text
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
    max(o.created_at) as last_order_at,
    (array_agg(substring(trim(o.ship_postal_code) from '^\d{5}') order by o.created_at)
      filter (where trim(o.ship_postal_code) ~ '^\d{5}'))[1] as sample_postal_code
  from public.orders o
  where o.payment_status = 'paid'
  group by 1, 2
  order by order_count desc, total_revenue_cents desc;
end;
$function$;

revoke all on function public.admin_order_geography() from public;
grant execute on function public.admin_order_geography() to authenticated, service_role;
