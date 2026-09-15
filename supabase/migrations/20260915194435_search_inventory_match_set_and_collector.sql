-- Broaden public.search_inventory's text match: it previously matched ONLY
-- card_name, so searching a set code ("MH2"), set name ("Modern Horizons 2"),
-- or collector number ("138") from the storefront search bar returned nothing.
-- Same signature/return shape/sort/pagination — additive OR conditions only,
-- so every previously-matching row still matches (case-insensitive via ilike).
CREATE OR REPLACE FUNCTION public.search_inventory(
  p_query text DEFAULT NULL::text,
  p_sets text[] DEFAULT NULL::text[],
  p_colors text[] DEFAULT NULL::text[],
  p_rarities text[] DEFAULT NULL::text[],
  p_conditions card_condition[] DEFAULT NULL::card_condition[],
  p_finishes card_finish[] DEFAULT NULL::card_finish[],
  p_creature_types text[] DEFAULT NULL::text[],
  p_min_price_cents integer DEFAULT NULL::integer,
  p_max_price_cents integer DEFAULT NULL::integer,
  p_in_stock_only boolean DEFAULT true,
  p_sort text DEFAULT 'name_asc'::text,
  p_limit integer DEFAULT 24,
  p_offset integer DEFAULT 0,
  p_include_archived boolean DEFAULT false
)
 RETURNS TABLE(id uuid, scryfall_id uuid, oracle_id uuid, set_code text, collector_number text, card_name text, set_name text, rarity text, type_line text, colors text[], creature_types text[], image_url text, condition card_condition, finish card_finish, foil boolean, variant_type text, quantity integer, price_cents integer, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with base as (
    select i.*,
      greatest(
        0,
        i.quantity - coalesce((
          select sum(r.quantity)::int from public.inventory_reservations r
          where r.inventory_item_id = i.id and r.status = 'active'
        ), 0)
      ) as sellable_qty
    from public.inventory_items i
  ),
  filtered as (
    select b.* from base b
    where
      (p_include_archived is true or b.status <> 'archived')
      and (
        p_query is null or p_query = ''
        or b.card_name ilike '%' || p_query || '%'
        or b.set_code ilike '%' || p_query || '%'
        or b.set_name ilike '%' || p_query || '%'
        or b.collector_number ilike '%' || p_query || '%'
      )
      and (p_sets is null or b.set_code = any(p_sets))
      and (p_colors is null or b.colors && p_colors)
      and (p_rarities is null or b.rarity = any(p_rarities))
      and (p_conditions is null or b.condition = any(p_conditions))
      and (p_finishes is null or b.finish = any(p_finishes))
      and (p_creature_types is null or b.creature_types && p_creature_types)
      and (p_min_price_cents is null or b.price_cents >= p_min_price_cents)
      and (p_max_price_cents is null or b.price_cents <= p_max_price_cents)
      and (p_in_stock_only is false or b.sellable_qty > 0)
  ),
  counted as (select count(*) as n from filtered)
  select
    f.id, f.scryfall_id, f.oracle_id, f.set_code, f.collector_number,
    f.card_name, f.set_name, f.rarity, f.type_line, f.colors, f.creature_types,
    f.image_url, f.condition, f.finish, f.foil, f.variant_type,
    f.sellable_qty as quantity, f.price_cents, c.n as total_count
  from filtered f cross join counted c
  order by
    case when p_sort = 'name_asc'   then f.card_name end asc nulls last,
    case when p_sort = 'name_desc'  then f.card_name end desc nulls last,
    case when p_sort = 'price_asc'  then f.price_cents end asc nulls last,
    case when p_sort = 'price_desc' then f.price_cents end desc nulls last,
    case when p_sort = 'newest'     then f.created_at end desc nulls last,
    f.card_name asc, f.id asc
  limit greatest(1, least(coalesce(p_limit, 24), 100))
  offset greatest(0, coalesce(p_offset, 0));
$function$;
