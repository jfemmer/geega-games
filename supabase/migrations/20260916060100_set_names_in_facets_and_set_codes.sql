-- Both admin_inventory_set_codes() and inventory_facets() previously returned
-- only the short set code (e.g. "MH2"), which the "Set" filter dropdowns then
-- rendered verbatim as the only visible label. Return the full set name
-- alongside the code so the UI can show "Modern Horizons 2" instead of an
-- abbreviation, while still filtering by the (unambiguous) code.

drop function if exists public.admin_inventory_set_codes();

create function public.admin_inventory_set_codes()
returns table(set_code text, set_name text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select set_code, min(set_name) as set_name
  from public.inventory_items
  where public.inventory_write_authorized()
  group by set_code
  order by min(set_name);
$function$;

grant execute on function public.admin_inventory_set_codes() to authenticated;

drop function if exists public.inventory_facets();

create function public.inventory_facets()
returns table(
  sets jsonb,
  rarities text[],
  creature_types text[],
  price_min_cents integer,
  price_max_cents integer
)
language sql
stable
set search_path to 'public'
as $function$
  with sellable as (
    select i.*,
      greatest(
        0,
        i.quantity - coalesce((
          select sum(r.quantity)::int from public.inventory_reservations r
          where r.inventory_item_id = i.id and r.status = 'active'
        ), 0)
      ) as sellable_qty
    from public.inventory_items i
    where i.status <> 'archived'
  ),
  instock as (select * from sellable where sellable_qty > 0),
  distinct_sets as (
    select set_code, min(set_name) as set_name
    from instock
    group by set_code
  )
  select
    (select jsonb_agg(jsonb_build_object('code', set_code, 'name', set_name) order by set_name) from distinct_sets),
    (select array_agg(distinct rarity order by rarity) from instock where rarity is not null),
    (select array_agg(distinct ct order by ct) from instock, unnest(creature_types) as ct),
    (select min(price_cents) from instock),
    (select max(price_cents) from instock);
$function$;

grant execute on function public.inventory_facets() to anon, authenticated;
