-- Storefront filters: Color, Card type, Creature type.
--
-- inventory_items already had `colors` and `creature_types` columns (and
-- search_inventory already accepted p_colors / p_creature_types), but nothing
-- ever populated them -- every row carried '{}', so a filter built on them
-- would have matched nothing. This migration:
--
--   1. Adds `card_types` (Artifact, Creature, Land, ...).
--   2. Adds pure helper functions that derive card_types / creature_types from
--      the Scryfall type_line and colors from the Scryfall card JSON (union of
--      all faces, so double-faced / adventure / split cards are covered).
--   3. Keeps all three columns correct automatically with a BEFORE trigger
--      (fires only when scryfall_id / oracle_id / type_line change, so stock
--      and price updates don't pay for it) and backfills existing rows.
--   4. Adds p_color_groups / p_card_types to search_inventory and
--      p_color_groups / p_card_types / p_creature_types to search_deals.
--   5. Returns in-stock card_types from inventory_facets (creature_types was
--      already returned and now actually has data).
--
-- Color groups (storefront vocabulary; multiple selections are OR'd, like
-- every other storefront filter group):
--   white/blue/black/red/green -> the card contains that color (a Boros card
--                                 shows under both Red and White)
--   multicolor                 -> two or more colors
--   colorless                  -> no colors and not a land (artifacts, Eldrazi, ...)
--   land                       -> no colors and is a land (a colored MDFC with a
--                                 land back face stays under its color)

alter table public.inventory_items
  add column if not exists card_types text[] not null default '{}';

comment on column public.inventory_items.card_types is
  'Card types parsed from type_line across all faces (Artifact, Battle, Creature, Enchantment, Instant, Kindred, Land, Planeswalker, Sorcery). Maintained by inventory_derive_card_attributes_trg.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.mtg_card_types(p_type_line text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(t order by t), '{}')
  from (
    select distinct case when w = 'Tribal' then 'Kindred' else w end as t
    from regexp_split_to_table(coalesce(p_type_line, ''), '\s*//\s*') as face,
         regexp_split_to_table(split_part(face, '—', 1), '\s+') as w
    where w in (
      'Artifact', 'Battle', 'Creature', 'Enchantment', 'Instant',
      'Kindred', 'Tribal', 'Land', 'Planeswalker', 'Sorcery'
    )
  ) s;
$$;

-- Creature subtypes are single words, with one printed exception ("Time Lord"),
-- which is protected from the whitespace split.
create or replace function public.mtg_creature_types(p_type_line text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(distinct replace(w, '_', ' ') order by replace(w, '_', ' ')), '{}')
  from regexp_split_to_table(coalesce(p_type_line, ''), '\s*//\s*') as face,
       regexp_split_to_table(
         btrim(split_part(replace(face, 'Time Lord', 'Time_Lord'), '—', 2)),
         '\s+'
       ) as w
  where split_part(face, '—', 1) ~ '\m(Creature|Kindred|Tribal)\M'
    and w <> '';
$$;

create or replace function public.mtg_card_colors(p_raw jsonb)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(distinct c order by c), '{}')
  from (
    select jsonb_array_elements_text(
      case when jsonb_typeof(p_raw -> 'colors') = 'array' then p_raw -> 'colors' else '[]'::jsonb end
    ) as c
    union all
    select jsonb_array_elements_text(
      case when jsonb_typeof(f -> 'colors') = 'array' then f -> 'colors' else '[]'::jsonb end
    )
    from jsonb_array_elements(
      case when jsonb_typeof(p_raw -> 'card_faces') = 'array' then p_raw -> 'card_faces' else '[]'::jsonb end
    ) as f
  ) s
  where c in ('W', 'U', 'B', 'R', 'G');
$$;

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
      where (g = 'white' and 'W' = any(coalesce(p_colors, '{}')))
         or (g = 'blue' and 'U' = any(coalesce(p_colors, '{}')))
         or (g = 'black' and 'B' = any(coalesce(p_colors, '{}')))
         or (g = 'red' and 'R' = any(coalesce(p_colors, '{}')))
         or (g = 'green' and 'G' = any(coalesce(p_colors, '{}')))
         or (g = 'multicolor' and cardinality(coalesce(p_colors, '{}')) >= 2)
         or (g = 'colorless' and cardinality(coalesce(p_colors, '{}')) = 0
             and not ('Land' = any(coalesce(p_card_types, '{}'))))
         or (g = 'land' and cardinality(coalesce(p_colors, '{}')) = 0
             and 'Land' = any(coalesce(p_card_types, '{}')))
    );
$$;

grant execute on function public.mtg_card_types(text) to anon, authenticated, service_role;
grant execute on function public.mtg_creature_types(text) to anon, authenticated, service_role;
grant execute on function public.mtg_card_colors(jsonb) to anon, authenticated, service_role;
grant execute on function public.mtg_matches_color_groups(text[], text[], text[]) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Trigger: keep colors / card_types / creature_types derived
-- ---------------------------------------------------------------------------

-- security definer so the Scryfall lookup works regardless of which role
-- writes the inventory row (admin RPCs, scanner, service role).
create or replace function public.inventory_derive_card_attributes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw jsonb;
begin
  new.card_types := public.mtg_card_types(new.type_line);
  new.creature_types := public.mtg_creature_types(new.type_line);

  if new.scryfall_id is not null then
    select b.raw into v_raw
    from public.scryfall_bulk_cards b
    where b.scryfall_id = new.scryfall_id;
  end if;
  -- Printing not in the bulk mirror yet: color is a gameplay property, so any
  -- printing of the same oracle card gives the right answer.
  if v_raw is null and new.oracle_id is not null then
    select b.raw into v_raw
    from public.scryfall_bulk_cards b
    where b.oracle_id = new.oracle_id
    limit 1;
  end if;
  if v_raw is not null then
    new.colors := public.mtg_card_colors(v_raw);
  end if;
  new.colors := coalesce(new.colors, '{}');

  return new;
end;
$$;

drop trigger if exists inventory_derive_card_attributes_trg on public.inventory_items;
create trigger inventory_derive_card_attributes_trg
  before insert or update of scryfall_id, oracle_id, type_line
  on public.inventory_items
  for each row execute function public.inventory_derive_card_attributes();

-- Backfill existing rows directly (no-op UPDATE of type_line would also work
-- but would bump updated_at on every row).
update public.inventory_items i
set
  card_types = public.mtg_card_types(i.type_line),
  creature_types = public.mtg_creature_types(i.type_line),
  colors = coalesce(
    (select public.mtg_card_colors(b.raw) from public.scryfall_bulk_cards b
      where b.scryfall_id = i.scryfall_id),
    (select public.mtg_card_colors(b.raw) from public.scryfall_bulk_cards b
      where b.oracle_id = i.oracle_id limit 1),
    i.colors
  );

-- ---------------------------------------------------------------------------
-- search_inventory: + p_color_groups, p_card_types
-- ---------------------------------------------------------------------------

drop function if exists public.search_inventory(
  text, text[], text[], text[], public.card_condition[], public.card_finish[],
  text[], integer, integer, boolean, text, integer, integer, boolean
);

create function public.search_inventory(
  p_query text default null,
  p_sets text[] default null,
  p_colors text[] default null,
  p_rarities text[] default null,
  p_conditions public.card_condition[] default null,
  p_finishes public.card_finish[] default null,
  p_creature_types text[] default null,
  p_min_price_cents integer default null,
  p_max_price_cents integer default null,
  p_in_stock_only boolean default true,
  p_sort text default 'name_asc',
  p_limit integer default 24,
  p_offset integer default 0,
  p_include_archived boolean default false,
  p_color_groups text[] default null,
  p_card_types text[] default null
)
returns table(
  id uuid, scryfall_id uuid, oracle_id uuid, set_code text,
  collector_number text, card_name text, set_name text, rarity text,
  type_line text, colors text[], creature_types text[], image_url text,
  condition public.card_condition, finish public.card_finish, foil boolean,
  variant_type text, quantity integer, price_cents integer, is_deal boolean,
  original_price_cents integer, deal_discount_percent integer,
  deal_source text, deal_note text, deal_started_at timestamptz, total_count bigint
)
language sql
stable
set search_path = public
as $$
  with base as (
    select i.*,
      greatest(
        0,
        i.quantity - coalesce((
          select sum(r.quantity)::int
          from public.inventory_reservations r
          where r.inventory_item_id = i.id and r.status = 'active'
        ), 0)
      ) as sellable_qty,
      public.storefront_effective_price(
        i.price_cents, i.original_price_cents, i.is_deal
      ) as effective_price_cents,
      public.storefront_effective_original_price(
        i.price_cents, i.original_price_cents, i.is_deal
      ) as effective_original_price_cents,
      public.storefront_effective_discount_percent(
        i.price_cents, i.original_price_cents, i.is_deal
      ) as effective_discount_percent
    from public.inventory_items i
  ),
  filtered as (
    select b.* from base b
    where
      (b.status = 'active' or (p_include_archived is true and b.status = 'archived'))
      and (
        p_query is null or p_query = ''
        or b.card_name ilike '%' || p_query || '%'
        or b.set_code ilike '%' || p_query || '%'
        or b.set_name ilike '%' || p_query || '%'
        or b.collector_number ilike '%' || p_query || '%'
      )
      and (p_sets is null or b.set_code = any(p_sets))
      and (p_colors is null or b.colors && p_colors)
      and public.mtg_matches_color_groups(b.colors, b.card_types, p_color_groups)
      and (p_card_types is null or b.card_types && p_card_types)
      and (p_rarities is null or b.rarity = any(p_rarities))
      and (p_conditions is null or b.condition = any(p_conditions))
      and (p_finishes is null or b.finish = any(p_finishes))
      and (p_creature_types is null or b.creature_types && p_creature_types)
      and (p_min_price_cents is null or b.effective_price_cents >= p_min_price_cents)
      and (p_max_price_cents is null or b.effective_price_cents <= p_max_price_cents)
      and (p_in_stock_only is false or b.sellable_qty > 0)
  ),
  counted as (select count(*) as n from filtered)
  select
    f.id, f.scryfall_id, f.oracle_id, f.set_code, f.collector_number,
    f.card_name, f.set_name, f.rarity, f.type_line, f.colors, f.creature_types,
    f.image_url, f.condition, f.finish, f.foil, f.variant_type,
    f.sellable_qty,
    f.effective_price_cents,
    (f.is_deal or f.effective_discount_percent is not null),
    f.effective_original_price_cents,
    f.effective_discount_percent,
    f.deal_source, f.deal_note, f.deal_started_at,
    c.n
  from filtered f cross join counted c
  order by
    case when p_sort = 'name_asc' then f.card_name end asc nulls last,
    case when p_sort = 'name_desc' then f.card_name end desc nulls last,
    case when p_sort = 'price_asc' then f.effective_price_cents end asc nulls last,
    case when p_sort = 'price_desc' then f.effective_price_cents end desc nulls last,
    case when p_sort = 'newest' then f.created_at end desc nulls last,
    f.card_name asc, f.id asc
  limit greatest(1, least(coalesce(p_limit, 24), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.search_inventory(
  text, text[], text[], text[], public.card_condition[], public.card_finish[],
  text[], integer, integer, boolean, text, integer, integer, boolean,
  text[], text[]
) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- search_deals: + p_color_groups, p_card_types, p_creature_types
-- ---------------------------------------------------------------------------

drop function if exists public.search_deals(
  text, text[], text[], public.card_condition[], integer, integer,
  text, integer, integer
);

create function public.search_deals(
  p_query text default null,
  p_sets text[] default null,
  p_rarities text[] default null,
  p_conditions public.card_condition[] default null,
  p_min_price_cents integer default null,
  p_max_price_cents integer default null,
  p_sort text default 'newest',
  p_limit integer default 24,
  p_offset integer default 0,
  p_color_groups text[] default null,
  p_card_types text[] default null,
  p_creature_types text[] default null
)
returns table(
  id uuid, scryfall_id uuid, oracle_id uuid, set_code text, set_name text,
  collector_number text, card_name text, rarity text, type_line text,
  image_url text, condition public.card_condition, finish public.card_finish,
  variant_type text, quantity integer, price_cents integer,
  original_price_cents integer, deal_discount_percent integer,
  deal_source text, deal_note text, deal_started_at timestamptz, total_count bigint
)
language sql
stable
set search_path = public
as $$
  with base as (
    select i.*,
      greatest(
        0,
        i.quantity - coalesce((
          select sum(r.quantity)::int
          from public.inventory_reservations r
          where r.inventory_item_id = i.id and r.status = 'active'
        ), 0)
      ) as sellable_qty,
      public.storefront_effective_price(
        i.price_cents, i.original_price_cents, i.is_deal
      ) as effective_price_cents,
      public.storefront_effective_original_price(
        i.price_cents, i.original_price_cents, i.is_deal
      ) as effective_original_price_cents,
      public.storefront_effective_discount_percent(
        i.price_cents, i.original_price_cents, i.is_deal
      ) as effective_discount_percent
    from public.inventory_items i
    where i.status = 'active' and i.is_deal = true
  ),
  filtered as (
    select b.* from base b
    where b.sellable_qty > 0
      and (
        p_query is null or p_query = ''
        or b.card_name ilike '%' || p_query || '%'
        or b.set_code ilike '%' || p_query || '%'
        or b.set_name ilike '%' || p_query || '%'
        or b.collector_number ilike '%' || p_query || '%'
      )
      and (p_sets is null or b.set_code = any(p_sets))
      and (p_rarities is null or b.rarity = any(p_rarities))
      and (p_conditions is null or b.condition = any(p_conditions))
      and public.mtg_matches_color_groups(b.colors, b.card_types, p_color_groups)
      and (p_card_types is null or b.card_types && p_card_types)
      and (p_creature_types is null or b.creature_types && p_creature_types)
      and (p_min_price_cents is null or b.effective_price_cents >= p_min_price_cents)
      and (p_max_price_cents is null or b.effective_price_cents <= p_max_price_cents)
  ),
  counted as (select count(*) as n from filtered)
  select
    f.id, f.scryfall_id, f.oracle_id, f.set_code, f.set_name, f.collector_number,
    f.card_name, f.rarity, f.type_line, f.image_url, f.condition, f.finish,
    f.variant_type,
    f.sellable_qty,
    f.effective_price_cents,
    f.effective_original_price_cents,
    f.effective_discount_percent,
    f.deal_source, f.deal_note, f.deal_started_at, c.n
  from filtered f cross join counted c
  order by
    case when p_sort = 'name_asc' then f.card_name end asc nulls last,
    case when p_sort = 'name_desc' then f.card_name end desc nulls last,
    case when p_sort = 'price_asc' then f.effective_price_cents end asc nulls last,
    case when p_sort = 'price_desc' then f.effective_price_cents end desc nulls last,
    case when p_sort = 'newest' then f.deal_started_at end desc nulls last,
    f.card_name asc, f.id asc
  limit greatest(1, least(coalesce(p_limit, 24), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.search_deals(
  text, text[], text[], public.card_condition[], integer, integer,
  text, integer, integer, text[], text[], text[]
) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- inventory_facets: + card_types
-- ---------------------------------------------------------------------------

drop function if exists public.inventory_facets();

create function public.inventory_facets()
returns table(
  sets jsonb,
  rarities text[],
  creature_types text[],
  price_min_cents integer,
  price_max_cents integer,
  card_types text[]
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
    (select array_agg(distinct t order by t) from instock, unnest(card_types) as t);
$function$;

grant execute on function public.inventory_facets() to anon, authenticated;
