-- Supports real server-side order-number search in the admin Orders page.
-- order.supabase.ts's list() previously fetched at most 500 orders and then
-- filtered by search term IN JAVASCRIPT — meaning a search for an order
-- older than the 500 most recent (by whatever sort) silently found nothing.
-- Email/recipient-name search moves server-side via a plain .or(ilike)
-- filter (those are already text columns); order id is a uuid, which
-- PostgREST's ilike filter can't cast on its own, hence this small helper.
create or replace function public.admin_orders_matching_id_prefix(p_prefix text)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(id), '{}'::uuid[])
  from public.orders
  where public.is_staff()
    and id::text ilike (regexp_replace(p_prefix, '[^0-9a-fA-F]', '', 'g') || '%')
  limit 500;
$function$;

revoke all on function public.admin_orders_matching_id_prefix(text) from public, anon;
grant execute on function public.admin_orders_matching_id_prefix(text) to authenticated, service_role;
