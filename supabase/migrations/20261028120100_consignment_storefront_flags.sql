-- Consignments, Phase 1: tell the storefront which listings are sale-only.
--
-- Consigned copies are listed and bought like any other card, but are never
-- traded. The database already refuses them on every trade path
-- (20261028120000_consignment_foundation.sql); this lets the shop hide "Add to
-- trade" on them instead of offering a button that would fail.
--
--   * search_inventory and search_deals return a new last column, sale_only.
--     Adding a column changes their return type, so each is dropped and
--     recreated with production's definition, the new column, and the same
--     grants. Callers that don't read sale_only are unaffected.
--   * get_card_detail adds "saleOnly" to each listing.
--   * inventory_public gains sale_only as its last column.
--
-- Run after 20261028120000. Safe to run more than once.

-- ------------------------------------------------------------ search_inventory

drop function if exists public.search_inventory(text, text[], text[], text[], public.card_condition[], public.card_finish[], text[], integer, integer, boolean, text, integer, integer, boolean, text[], text[]);

create function public.search_inventory(
  p_query text default null::text, p_sets text[] default null::text[], p_colors text[] default null::text[],
  p_rarities text[] default null::text[], p_conditions public.card_condition[] default null::public.card_condition[],
  p_finishes public.card_finish[] default null::public.card_finish[], p_creature_types text[] default null::text[],
  p_min_price_cents integer default null::integer, p_max_price_cents integer default null::integer,
  p_in_stock_only boolean default true, p_sort text default 'name_asc'::text, p_limit integer default 24,
  p_offset integer default 0, p_include_archived boolean default false, p_color_groups text[] default null::text[],
  p_card_types text[] default null::text[]
)
returns table(
  id uuid, scryfall_id uuid, oracle_id uuid, set_code text, collector_number text, card_name text, set_name text,
  rarity text, type_line text, colors text[], creature_types text[], image_url text, condition public.card_condition,
  finish public.card_finish, foil boolean, variant_type text, quantity integer, price_cents integer, is_deal boolean,
  original_price_cents integer, deal_discount_percent integer, deal_source text, deal_note text,
  deal_started_at timestamp with time zone, total_count bigint, sale_only boolean
)
language sql
stable
set search_path to 'public'
as $function$
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
    c.n,
    f.ownership = 'consigned'
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
$function$;

grant execute on function public.search_inventory(text, text[], text[], text[], public.card_condition[], public.card_finish[], text[], integer, integer, boolean, text, integer, integer, boolean, text[], text[])
  to anon, authenticated, service_role;

-- ------------------------------------------------------------ search_deals

drop function if exists public.search_deals(text, text[], text[], public.card_condition[], integer, integer, text, integer, integer, text[], text[], text[]);

create function public.search_deals(
  p_query text default null::text, p_sets text[] default null::text[], p_rarities text[] default null::text[],
  p_conditions public.card_condition[] default null::public.card_condition[],
  p_min_price_cents integer default null::integer, p_max_price_cents integer default null::integer,
  p_sort text default 'newest'::text, p_limit integer default 24, p_offset integer default 0,
  p_color_groups text[] default null::text[], p_card_types text[] default null::text[],
  p_creature_types text[] default null::text[]
)
returns table(
  id uuid, scryfall_id uuid, oracle_id uuid, set_code text, set_name text, collector_number text, card_name text,
  rarity text, type_line text, image_url text, condition public.card_condition, finish public.card_finish,
  variant_type text, quantity integer, price_cents integer, original_price_cents integer, deal_discount_percent integer,
  deal_source text, deal_note text, deal_started_at timestamp with time zone, total_count bigint, sale_only boolean
)
language sql
stable
set search_path to 'public'
as $function$
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
    f.deal_source, f.deal_note, f.deal_started_at, c.n,
    f.ownership = 'consigned'
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
$function$;

grant execute on function public.search_deals(text, text[], text[], public.card_condition[], integer, integer, text, integer, integer, text[], text[], text[])
  to anon, authenticated, service_role;

-- ------------------------------------------------------------ get_card_detail

create or replace function public.get_card_detail(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_oracle_id uuid;
  v_card_name text;
  v_result jsonb;
  v_enrichment jsonb;
begin
  select i.oracle_id, i.card_name
    into v_oracle_id, v_card_name
  from public.inventory_items i
  where i.status = 'active'
    and public.slugify_card_name(i.card_name) = p_slug
  order by i.created_at asc
  limit 1;

  if v_oracle_id is null then
    return null;
  end if;

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
      public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal) as effective_price_cents,
      public.storefront_effective_original_price(i.price_cents, i.original_price_cents, i.is_deal) as effective_original_price_cents,
      public.storefront_effective_discount_percent(i.price_cents, i.original_price_cents, i.is_deal) as effective_discount_percent
    from public.inventory_items i
    where i.oracle_id = v_oracle_id and i.status = 'active'
  ),
  listings as (
    select
      jsonb_build_object(
        'id', b.id,
        'scryfallId', b.scryfall_id,
        'setCode', b.set_code,
        'setName', b.set_name,
        'collectorNumber', b.collector_number,
        'rarity', b.rarity,
        'condition', b.condition,
        'finish', b.finish,
        'variantType', b.variant_type,
        'imageUrl', b.image_url,
        'quantity', b.sellable_qty,
        'priceCents', b.effective_price_cents,
        'isDeal', (b.is_deal or b.effective_discount_percent is not null),
        'originalPriceCents', b.effective_original_price_cents,
        'dealDiscountPercent', b.effective_discount_percent,
        'dealSource', b.deal_source,
        'dealNote', b.deal_note,
        'saleOnly', b.ownership = 'consigned'
      ) as x,
      b.sellable_qty,
      b.effective_price_cents
    from base b
    where b.sellable_qty > 0
  )
  select jsonb_build_object(
    'oracleId', v_oracle_id,
    'cardName', v_card_name,
    'listings', coalesce((select jsonb_agg(l.x order by l.effective_price_cents asc nulls last) from listings l), '[]'::jsonb),
    'inStockCount', (select count(*) from listings),
    'minPriceCents', (select min(effective_price_cents) from listings),
    'maxPriceCents', (select max(effective_price_cents) from listings)
  ) into v_result;

  -- Enrich with representative Scryfall rules text from any printing
  -- sharing this oracle_id. Cosmetic content only (never price/availability)
  -- so a stale/missing bulk-cache row just means a plainer page, not a
  -- broken one — hence the null guard before merging.
  select jsonb_build_object(
    'typeLine', sc.raw ->> 'type_line',
    'oracleText', coalesce(sc.raw ->> 'oracle_text', sc.raw -> 'card_faces' -> 0 ->> 'oracle_text'),
    'manaCost', coalesce(sc.raw ->> 'mana_cost', sc.raw -> 'card_faces' -> 0 ->> 'mana_cost'),
    'power', coalesce(sc.raw ->> 'power', sc.raw -> 'card_faces' -> 0 ->> 'power'),
    'toughness', coalesce(sc.raw ->> 'toughness', sc.raw -> 'card_faces' -> 0 ->> 'toughness'),
    'loyalty', sc.raw ->> 'loyalty',
    'flavorText', coalesce(sc.raw ->> 'flavor_text', sc.raw -> 'card_faces' -> 0 ->> 'flavor_text'),
    'legalities', sc.raw -> 'legalities'
  )
  into v_enrichment
  from public.scryfall_bulk_cards sc
  where sc.oracle_id = v_oracle_id and sc.lang = 'en'
  order by sc.released_at desc nulls last
  limit 1;

  if v_enrichment is not null then
    v_result := v_result || v_enrichment;
  end if;

  return v_result;
end;
$function$;

-- ------------------------------------------------------------ inventory_public

create or replace view public.inventory_public
with (security_invoker = true)
as
 select i.id,
    i.scryfall_id,
    i.oracle_id,
    i.card_name,
    i.set_code,
    i.set_name,
    i.collector_number,
    i.rarity,
    i.type_line,
    i.colors,
    i.creature_types,
    i.image_url,
    i.condition,
    i.finish,
    i.foil,
    i.variant_type,
    i.language,
    greatest(i.quantity - coalesce(r.reserved_qty, 0), 0) as quantity,
    public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal) as price_cents,
    public.storefront_effective_original_price(i.price_cents, i.original_price_cents, i.is_deal) as original_price_cents,
    public.storefront_effective_discount_percent(i.price_cents, i.original_price_cents, i.is_deal) as discount_percent,
    i.scryfall_price_cents,
    i.ownership = 'consigned' as sale_only
   from public.inventory_items i
     left join ( select inventory_reservations.inventory_item_id,
            sum(inventory_reservations.quantity)::integer as reserved_qty
           from public.inventory_reservations
          where inventory_reservations.status = 'active'::public.reservation_status
          group by inventory_reservations.inventory_item_id) r on r.inventory_item_id = i.id
  where i.status = 'active'::public.inventory_status and (i.quantity - coalesce(r.reserved_qty, 0)) > 0;
