-- Storefront color filter, round two:
--
--   * A single color (white/blue/black/red/green) now means MONO-colored:
--     exactly that one color. Multicolor cards appear only under Multicolor
--     or their named combination.
--   * New named-combination groups, encoded as 'combo:<letters>' where the
--     letters are the exact color set in any order (e.g. 'combo:UB' = Dimir,
--     'combo:BRU' = Grixis, 'combo:WUBRG' = five-color). Matched as an exact
--     set, so Dimir never includes Grixis/Esper/etc.
--   * inventory_facets() returns color_combos: the exact multicolor sets in
--     stock (letters sorted alphabetically), so the storefront only lists
--     combinations a shopper can actually buy.
--
-- Unchanged: multicolor (2+ colors), colorless (no colors, not a land),
-- land (no colors, is a land). Selections are still OR'd.
-- search_inventory / search_deals already call this helper, so they pick up
-- the new semantics without being recreated.

create or replace function public.mtg_matches_color_groups(
  p_colors text[],
  p_card_types text[],
  p_groups text[]
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_groups is null
    or cardinality(p_groups) = 0
    or exists (
      select 1
      from unnest(p_groups) as g
      cross join lateral (select coalesce(p_colors, '{}') as c) cc
      where (g = 'white' and cc.c = array['W'])
         or (g = 'blue' and cc.c = array['U'])
         or (g = 'black' and cc.c = array['B'])
         or (g = 'red' and cc.c = array['R'])
         or (g = 'green' and cc.c = array['G'])
         or (g = 'multicolor' and cardinality(cc.c) >= 2)
         or (g = 'colorless' and cardinality(cc.c) = 0
             and not ('Land' = any(coalesce(p_card_types, '{}'))))
         or (g = 'land' and cardinality(cc.c) = 0
             and 'Land' = any(coalesce(p_card_types, '{}')))
         or (
           g like 'combo:_%'
           and cardinality(cc.c) >= 2
           and cc.c @> regexp_split_to_array(upper(substr(g, 7)), '')
           and cc.c <@ regexp_split_to_array(upper(substr(g, 7)), '')
         )
    );
$$;

grant execute on function public.mtg_matches_color_groups(text[], text[], text[]) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- inventory_facets: + color_combos
-- ---------------------------------------------------------------------------

drop function if exists public.inventory_facets();

create function public.inventory_facets()
returns table(
  sets jsonb,
  rarities text[],
  creature_types text[],
  price_min_cents integer,
  price_max_cents integer,
  card_types text[],
  color_combos text[]
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
    (select max(price_cents) from instock),
    (select array_agg(distinct t order by t) from instock, unnest(card_types) as t),
    (select array_agg(distinct combo order by combo)
       from (
         select (select string_agg(c, '' order by c) from unnest(colors) as c) as combo
         from instock
         where cardinality(colors) >= 2
       ) s);
$function$;

grant execute on function public.inventory_facets() to anon, authenticated;
