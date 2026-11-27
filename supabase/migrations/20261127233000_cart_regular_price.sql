-- The cart shows a discounted card's regular price struck through, the same
-- way the product cards do, so shoppers can see the storewide sale (or a Deals
-- & Specials price) applied to cards already in their cart.
--
-- cart_item_availability gains original_price_cents: the card's regular price
-- when price_cents is discounted, else null. "Discounted" is the catalog's own
-- rule (storefront_effective_discount_percent is set), so a leftover
-- original_price_cents on a card that isn't on a deal never shows. Consigned
-- copies are never discounted, so theirs is always null.
--
-- Otherwise production's definition unchanged (20261029120000_consignment_sales):
-- same price, stock, checkout-hold add-back and sale_only. Adding a column to
-- RETURNS TABLE needs drop + create, so the grants are restored below; the
-- migration runs in one transaction, so callers never see it missing.

drop function if exists public.cart_item_availability(uuid[]);
create function public.cart_item_availability(p_ids uuid[])
returns table(id uuid, card_name text, set_code text, set_name text, condition public.card_condition, finish public.card_finish,
              image_url text, price_cents integer, quantity integer, variant_type text, sale_only boolean,
              original_price_cents integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with ids as (
    select distinct x as id from unnest(p_ids) x
    where cardinality(p_ids) <= 500
  ),
  held as (
    select oi.inventory_item_id, sum(oi.quantity)::int as qty
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join ids on ids.id = oi.inventory_item_id
    where auth.uid() is not null and o.user_id = auth.uid()
      and o.channel = 'online' and o.status = 'pending_payment'
      and o.payment_status in ('unpaid', 'processing')
    group by oi.inventory_item_id
  ),
  res as (
    select r.inventory_item_id, sum(r.quantity)::int as reserved_qty
    from public.inventory_reservations r
    join ids on ids.id = r.inventory_item_id
    where r.status = 'active'
    group by r.inventory_item_id
  )
  select i.id, i.card_name, i.set_code, i.set_name, i.condition, i.finish, i.image_url,
         public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal, i.ownership),
         (greatest(i.quantity - coalesce(res.reserved_qty, 0), 0) + coalesce(held.qty, 0))::int,
         i.variant_type,
         i.ownership = 'consigned',
         case
           when public.storefront_effective_discount_percent(i.price_cents, i.original_price_cents, i.is_deal, i.ownership) is not null
             then public.storefront_effective_original_price(i.price_cents, i.original_price_cents, i.is_deal, i.ownership)
         end
  from public.inventory_items i
  join ids on ids.id = i.id
  left join res on res.inventory_item_id = i.id
  left join held on held.inventory_item_id = i.id
  where i.status = 'active'
    and greatest(i.quantity - coalesce(res.reserved_qty, 0), 0) + coalesce(held.qty, 0) > 0;
$function$;
revoke all on function public.cart_item_availability(uuid[]) from public;
grant execute on function public.cart_item_availability(uuid[]) to anon, authenticated, service_role;
