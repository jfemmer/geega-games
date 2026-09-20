-- admin_search_inventory never returned is_deal/deal_source/deal_note/
-- original_price_cents/deal_discount_percent, even though the admin
-- InventoryPage table has read r.isDeal/r.dealSource for its "Placement"
-- column all along -- meaning that column has always silently shown "Main
-- store" for every row, deals included. Add the missing columns so staff
-- can actually see deal/flaw status at a glance in the main inventory list.
drop function if exists public.admin_search_inventory(
  text, text, text, text, text, text, text, text, integer, integer, integer
);

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
