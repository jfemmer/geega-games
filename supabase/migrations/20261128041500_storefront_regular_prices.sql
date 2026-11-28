-- What each card sells for when no storewide sale is running: its own price,
-- Deals & Specials included (inventory_items.price_cents; the storewide sale is
-- applied on top of it only while the sale runs, by storefront_effective_price).
--
-- For the product feed (api/merchant-feed.ts). During a sale it sends Google
-- and Microsoft this as the card's price, with the sale price and the sale's
-- start and end beside it (sale_price, sale_price_effective_date). Merchant
-- Center reads the feed at most once a day; with the dates, it shows the
-- regular price again the moment the sale ends instead of whenever it next
-- reads the file.
--
-- Only cards the shop lists (active), at most 500 per call. The price is the
-- one any visitor sees when there's no sale, so it's public like the catalog.

create or replace function public.storefront_regular_prices(p_ids uuid[])
returns table(id uuid, price_cents integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select i.id, i.price_cents
  from public.inventory_items i
  where cardinality(p_ids) <= 500
    and i.id = any(p_ids)
    and i.status = 'active';
$function$;
revoke all on function public.storefront_regular_prices(uuid[]) from public;
grant execute on function public.storefront_regular_prices(uuid[]) to anon, authenticated, service_role;
