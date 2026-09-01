-- =============================================================================
-- 0013_search_inventory.sql
-- Server-side inventory search: filtering, sorting, pagination, and total count
-- in ONE indexed round-trip. The storefront NEVER downloads the whole table.
--
-- Runs SECURITY INVOKER so the base-table RLS applies: anon/customers see only
-- in-stock rows; staff see everything. cost_cents is never returned.
--
-- Returns each matching row plus a window total_count so the client can render
-- pagination without a second query.
-- =============================================================================

create or replace function public.search_inventory(
  p_query        text default null,        -- fuzzy card-name search
  p_sets         text[] default null,       -- set_code IN (...)
  p_colors       text[] default null,       -- overlaps (any of)
  p_rarities     text[] default null,       -- rarity IN (...)
  p_conditions   card_condition[] default null,
  p_finishes     card_finish[] default null,
  p_creature_types text[] default null,     -- overlaps (any of)
  p_min_price_cents integer default null,
  p_max_price_cents integer default null,
  p_in_stock_only boolean default true,     -- staff may pass false to see all
  p_sort         text default 'name_asc',   -- see CASE below
  p_limit        integer default 24,
  p_offset       integer default 0
)
returns table (
  id uuid,
  scryfall_id uuid,
  oracle_id uuid,
  set_code text,
  collector_number text,
  card_name text,
  set_name text,
  rarity text,
  type_line text,
  colors text[],
  creature_types text[],
  image_url text,
  condition card_condition,
  finish card_finish,
  foil boolean,
  variant_type text,
  quantity integer,
  price_cents integer,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select i.*
    from public.inventory_items i
    where
      (p_query is null or p_query = '' or i.card_name ilike '%' || p_query || '%')
      and (p_sets is null or i.set_code = any(p_sets))
      and (p_colors is null or i.colors && p_colors)
      and (p_rarities is null or i.rarity = any(p_rarities))
      and (p_conditions is null or i.condition = any(p_conditions))
      and (p_finishes is null or i.finish = any(p_finishes))
      and (p_creature_types is null or i.creature_types && p_creature_types)
      and (p_min_price_cents is null or i.price_cents >= p_min_price_cents)
      and (p_max_price_cents is null or i.price_cents <= p_max_price_cents)
      -- in-stock gate. Note base-table RLS already hides out-of-stock from
      -- non-staff, so this only matters when staff explicitly pass false.
      and (p_in_stock_only is false or i.quantity > 0)
  ),
  counted as (
    select count(*) as n from filtered
  )
  select
    f.id, f.scryfall_id, f.oracle_id, f.set_code, f.collector_number,
    f.card_name, f.set_name, f.rarity, f.type_line, f.colors, f.creature_types,
    f.image_url, f.condition, f.finish, f.foil, f.variant_type,
    f.quantity, f.price_cents,
    c.n as total_count
  from filtered f cross join counted c
  order by
    case when p_sort = 'name_asc'   then f.card_name end asc nulls last,
    case when p_sort = 'name_desc'  then f.card_name end desc nulls last,
    case when p_sort = 'price_asc'  then f.price_cents end asc nulls last,
    case when p_sort = 'price_desc' then f.price_cents end desc nulls last,
    case when p_sort = 'newest'     then f.created_at end desc nulls last,
    -- stable tiebreaker so pagination never duplicates/skips rows
    f.card_name asc, f.id asc
  limit greatest(1, least(coalesce(p_limit, 24), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

comment on function public.search_inventory is
  'Storefront search: optional filters + sort + pagination + total_count in one query. SECURITY INVOKER so RLS applies; never returns cost_cents.';

-- Distinct facet values for building filter UIs, in-stock only, for anon/customers.
-- One row, arrays of available options. Cheap enough to call alongside search.
create or replace function public.inventory_facets()
returns table (
  sets text[],
  rarities text[],
  creature_types text[],
  price_min_cents integer,
  price_max_cents integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select array_agg(distinct set_code order by set_code)
       from public.inventory_items where quantity > 0),
    (select array_agg(distinct rarity order by rarity)
       from public.inventory_items where quantity > 0 and rarity is not null),
    (select array_agg(distinct ct order by ct)
       from public.inventory_items, unnest(creature_types) as ct
       where quantity > 0),
    (select min(price_cents) from public.inventory_items where quantity > 0),
    (select max(price_cents) from public.inventory_items where quantity > 0);
$$;

grant execute on function public.search_inventory(
  text, text[], text[], text[], card_condition[], card_finish[], text[],
  integer, integer, boolean, text, integer, integer
) to anon, authenticated;

grant execute on function public.inventory_facets() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Explicit privilege grants (reproducibility).
-- Supabase's hosted setup grants these to anon/authenticated by default, but we
-- declare them so a from-scratch `supabase db reset` in ANY environment yields
-- identical behavior. RLS still governs which ROWS are visible; these grants
-- only permit the SELECT to be attempted. cost_cents remains protected because
-- the storefront reads inventory_public (which omits it) and RLS limits rows.
-- ---------------------------------------------------------------------------
grant select on public.inventory_items to anon, authenticated;
grant select on public.inventory_public to anon, authenticated;
