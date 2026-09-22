-- Powers a new "Shop by Set" browse page: durable, self-maintaining SEO
-- surface area (one indexable page per set Geega actually stocks, e.g.
-- "Buy Final Fantasy MTG Singles") that needs no manual content updates as
-- inventory changes -- unlike a hand-written page per hot set, this adapts
-- automatically whenever a new crossover/expansion comes into stock. Ordered
-- by how many cards are actually available, not alphabetically: the sets
-- worth a dedicated page are the ones with real depth behind them.
create or replace function public.shop_sets_with_counts()
returns table(set_code text, set_name text, card_count bigint, min_price_cents integer)
language sql
stable
set search_path to 'public'
as $function$
  with sellable as (
    select i.*,
      greatest(
        0,
        i.quantity - coalesce((
          select sum(r.quantity)::int
          from public.inventory_reservations r
          where r.inventory_item_id = i.id and r.status = 'active'
        ), 0)
      ) as sellable_qty,
      public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal) as effective_price_cents
    from public.inventory_items i
    where i.status = 'active'
  ),
  in_stock as (
    select * from sellable where sellable_qty > 0
  )
  select
    set_code,
    min(set_name) as set_name,
    count(*) as card_count,
    min(effective_price_cents) as min_price_cents
  from in_stock
  group by set_code
  order by card_count desc, set_name asc;
$function$;

revoke all on function public.shop_sets_with_counts() from public;
grant execute on function public.shop_sets_with_counts() to anon, authenticated, service_role;
