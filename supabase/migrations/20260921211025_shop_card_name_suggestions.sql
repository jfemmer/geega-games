-- Powers a type-ahead dropdown on the main /shop search box (previously it
-- only filtered the results grid after a debounce, with no suggestion list
-- — unlike the deck-builder's card search, which already has one). Scoped
-- to in-stock inventory only, so a suggestion always has real results
-- behind it. Anon-callable, same trust level as search_inventory.
create or replace function public.shop_card_name_suggestions(p_query text)
returns table(card_name text)
language sql
stable
set search_path to 'public'
as $function$
  select distinct on (lower(i.card_name)) i.card_name
  from public.inventory_items i
  where i.status = 'active'
    and i.quantity > 0
    and length(trim(coalesce(p_query, ''))) >= 2
    and i.card_name ilike '%' || trim(p_query) || '%'
  order by
    lower(i.card_name),
    (lower(i.card_name) not like lower(trim(p_query)) || '%'),
    i.card_name
  limit 8;
$function$;

revoke all on function public.shop_card_name_suggestions(text) from public;
grant execute on function public.shop_card_name_suggestions(text) to anon, authenticated, service_role;
