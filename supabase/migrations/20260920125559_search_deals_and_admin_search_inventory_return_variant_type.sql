-- variant_type (Artist Proof / Special Edition / custom label) already exists
-- on inventory_items and is already part of admin_upsert_inventory's identity
-- matching + the uq_inventory_sku unique index, and search_inventory already
-- returns it -- but search_deals and admin_search_inventory don't, so a
-- flawed/deal Artist Proof line would lose its badge on Deals & Specials, and
-- staff couldn't see variant status in the main admin inventory list.
drop function if exists public.search_deals(
  text, text[], text[], public.card_condition[], integer, integer,
  text, integer, integer
);
drop function if exists public.admin_search_inventory(
  text, text, text, text, text, text, text, text, integer, integer, integer
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
  p_offset integer default 0
)
returns table(
  id uuid, scryfall_id uuid, set_code text, set_name text,
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
      and (p_min_price_cents is null or b.effective_price_cents >= p_min_price_cents)
      and (p_max_price_cents is null or b.effective_price_cents <= p_max_price_cents)
  ),
  counted as (select count(*) as n from filtered)
  select
    f.id, f.scryfall_id, f.set_code, f.set_name, f.collector_number,
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
  text, integer, integer
) to anon, authenticated, service_role;

create function public.admin_search_inventory(
  p_query text default null,
  p_status text default 'all',
  p_stock text default 'all',
  p_condition text default 'all',
  p_finish text default 'all',
  p_set_code text default 'all',
  p_sort text default 'updated',
  p_sort_dir text default 'desc',
  p_low_stock_threshold integer default 2,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table(
  id uuid, scryfall_id uuid, oracle_id uuid, set_code text,
  collector_number text, card_name text, set_name text, rarity text,
  type_line text, colors text[], creature_types text[], image_url text,
  condition card_condition, finish card_finish, foil boolean,
  variant_type text, quantity integer, price_cents integer, cost_cents integer,
  scryfall_price_cents integer, storage_location text, sku text, notes text,
  status inventory_status, is_deal boolean, deal_source text, deal_note text,
  original_price_cents integer, deal_discount_percent integer,
  created_at timestamptz, updated_at timestamptz, total_count bigint
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not public.is_staff() and auth.role() <> 'service_role' then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  return query
  with filtered as (
    select i.* from public.inventory_items i
    where
      (p_query is null or p_query = ''
        or i.card_name ilike '%' || p_query || '%'
        or i.set_name  ilike '%' || p_query || '%'
        or i.set_code  ilike '%' || p_query || '%'
        or coalesce(i.sku,'') ilike '%' || p_query || '%')
      and (p_status = 'all' or i.status::text = p_status)
      and (
        p_stock = 'all'
        or (p_stock = 'out' and i.quantity = 0)
        or (p_stock = 'in'  and i.quantity > 0)
        or (p_stock = 'low' and i.quantity > 0 and i.quantity <= greatest(0, p_low_stock_threshold))
      )
      and (p_condition = 'all' or i.condition::text = p_condition)
      and (p_finish = 'all' or i.finish::text = p_finish)
      and (p_set_code = 'all' or i.set_code = p_set_code)
  ),
  counted as (select count(*) as n from filtered)
  select
    f.id, f.scryfall_id, f.oracle_id, f.set_code, f.collector_number,
    f.card_name, f.set_name, f.rarity, f.type_line, f.colors, f.creature_types,
    f.image_url, f.condition, f.finish, f.foil, f.variant_type, f.quantity,
    f.price_cents, f.cost_cents, f.scryfall_price_cents, f.storage_location,
    f.sku, f.notes, f.status, f.is_deal, f.deal_source, f.deal_note,
    f.original_price_cents, f.deal_discount_percent,
    f.created_at, f.updated_at, c.n as total_count
  from filtered f cross join counted c
  order by
    case when p_sort = 'name'     and p_sort_dir = 'asc'  then f.card_name end asc nulls last,
    case when p_sort = 'name'     and p_sort_dir = 'desc' then f.card_name end desc nulls last,
    case when p_sort = 'quantity' and p_sort_dir = 'asc'  then f.quantity end asc nulls last,
    case when p_sort = 'quantity' and p_sort_dir = 'desc' then f.quantity end desc nulls last,
    case when p_sort = 'price'    and p_sort_dir = 'asc'  then f.price_cents end asc nulls last,
    case when p_sort = 'price'    and p_sort_dir = 'desc' then f.price_cents end desc nulls last,
    case when p_sort = 'updated'  and p_sort_dir = 'asc'  then f.updated_at end asc nulls last,
    case when p_sort = 'updated'  and p_sort_dir = 'desc' then f.updated_at end desc nulls last,
    f.updated_at desc, f.id asc
  limit greatest(1, least(coalesce(p_limit, 25), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

grant execute on function public.admin_search_inventory(
  text, text, text, text, text, text, text, text, integer, integer, integer
) to authenticated, service_role;
