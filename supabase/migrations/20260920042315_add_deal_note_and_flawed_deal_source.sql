-- Deals & Specials gets a third reason a line can be marked down: a physical
-- flaw or grading quirk that doesn't cleanly fit the NM/LP/MP/HP/DMG scale
-- (a factory miscut, a one-off ink smudge, foil peeling on a single copy,
-- etc.). deal_source stays a plain text column (already 'manual' |
-- 'aged_inventory'; 'flawed' is now a third accepted value, enforced at the
-- application layer like the existing two). deal_note is new: a short,
-- customer-facing explanation of WHY a line is discounted, most important
-- for a flawed deal but usable for any deal type.
alter table public.inventory_items
  add column if not exists deal_note text;

comment on column public.inventory_items.deal_note is
  'Customer-facing explanation of why this line is a deal -- e.g. the specific flaw for a deal_source=''flawed'' line. Shown on the storefront; distinct from the staff-only notes column.';

-- Return row type is changing (new deal_note column), so the existing
-- functions must be dropped before being recreated.
drop function if exists public.search_inventory(
  text, text[], text[], text[], public.card_condition[], public.card_finish[],
  text[], integer, integer, boolean, text, integer, integer, boolean
);
drop function if exists public.search_deals(
  text, text[], text[], public.card_condition[], integer, integer,
  text, integer, integer
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
  p_include_archived boolean default false
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
  text[], integer, integer, boolean, text, integer, integer, boolean
) to anon, authenticated, service_role;

create function public.search_deals(
  p_query text default null,
  p_sets text[] default null,
  p_rarities text[] default null,
  p_conditions public.card_condition[] default null,
  p_min_price_cents integer default null,
  p_max_price_cents integer default null,
  p_sort text default 'newest',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table(
  id uuid, scryfall_id uuid, set_code text, set_name text,
  collector_number text, card_name text, rarity text, type_line text,
  image_url text, condition public.card_condition, finish public.card_finish,
  quantity integer, price_cents integer, original_price_cents integer,
  deal_discount_percent integer, deal_source text, deal_note text,
  deal_started_at timestamptz, total_count bigint
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
      and (p_min_price_cents is null or b.effective_price_cents >= p_min_price_cents)
      and (p_max_price_cents is null or b.effective_price_cents <= p_max_price_cents)
  ),
  counted as (select count(*) as n from filtered)
  select
    f.id, f.scryfall_id, f.set_code, f.set_name, f.collector_number,
    f.card_name, f.rarity, f.type_line, f.image_url, f.condition, f.finish,
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
  text, integer, integer
) to anon, authenticated, service_role;
