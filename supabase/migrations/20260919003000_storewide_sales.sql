-- Storewide sale scheduling + effective pricing.
-- One enabled sale may be scheduled/active at a time. The active sale applies
-- across storefront, cart, online checkout, kiosk/catalog, and POS. Existing
-- Deals & Specials do not stack: the customer receives whichever price is lower.

create table if not exists public.storewide_sales (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Storewide Sale',
  discount_percent integer not null check (discount_percent between 1 and 90),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  enabled boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create unique index if not exists storewide_sales_single_enabled_idx
  on public.storewide_sales ((enabled))
  where enabled = true;

alter table public.storewide_sales enable row level security;
revoke all on table public.storewide_sales from anon, authenticated;
grant select on public.storewide_sales to anon, authenticated;

drop policy if exists "Public can read active storewide sale" on public.storewide_sales;
create policy "Public can read active storewide sale"
on public.storewide_sales
for select
to anon, authenticated
using (
  enabled = true
  and now() >= starts_at
  and now() < ends_at
);

create index if not exists storewide_sales_created_by_idx
  on public.storewide_sales (created_by);

create or replace function public.current_storewide_sale()
returns table(
  id uuid,
  name text,
  discount_percent integer,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.name, s.discount_percent, s.starts_at, s.ends_at
  from public.storewide_sales s
  where s.enabled = true
    and now() >= s.starts_at
    and now() < s.ends_at
  order by s.starts_at desc
  limit 1;
$$;

revoke all on function public.current_storewide_sale() from public;
grant execute on function public.current_storewide_sale() to anon, authenticated, service_role;

create or replace function public.storefront_effective_price(
  p_price_cents integer,
  p_original_price_cents integer,
  p_is_deal boolean
)
returns integer
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_discount integer;
  v_regular integer;
  v_sale_price integer;
begin
  if p_price_cents is null then return null; end if;

  select s.discount_percent into v_discount
  from public.storewide_sales s
  where s.enabled = true
    and now() >= s.starts_at
    and now() < s.ends_at
  order by s.starts_at desc
  limit 1;

  if v_discount is null then
    return p_price_cents;
  end if;

  v_regular := case
    when coalesce(p_is_deal, false) and p_original_price_cents is not null
      then p_original_price_cents
    else p_price_cents
  end;

  v_sale_price := greatest(
    1,
    round(v_regular * (100 - v_discount) / 100.0)::integer
  );
  return least(p_price_cents, v_sale_price);
end;
$$;

revoke all on function public.storefront_effective_price(integer,integer,boolean) from public;
grant execute on function public.storefront_effective_price(integer,integer,boolean)
to anon, authenticated, service_role;

create or replace function public.storefront_effective_original_price(
  p_price_cents integer,
  p_original_price_cents integer,
  p_is_deal boolean
)
returns integer
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_effective integer;
  v_regular integer;
begin
  if p_price_cents is null then return null; end if;

  v_regular := case
    when coalesce(p_is_deal, false) and p_original_price_cents is not null
      then p_original_price_cents
    else p_price_cents
  end;

  v_effective := public.storefront_effective_price(
    p_price_cents, p_original_price_cents, p_is_deal
  );

  if v_effective < v_regular then return v_regular; end if;
  return p_original_price_cents;
end;
$$;

revoke all on function public.storefront_effective_original_price(integer,integer,boolean) from public;
grant execute on function public.storefront_effective_original_price(integer,integer,boolean)
to anon, authenticated, service_role;

create or replace function public.storefront_effective_discount_percent(
  p_price_cents integer,
  p_original_price_cents integer,
  p_is_deal boolean
)
returns integer
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_effective integer;
  v_regular integer;
begin
  if p_price_cents is null then return null; end if;

  v_regular := case
    when coalesce(p_is_deal, false) and p_original_price_cents is not null
      then p_original_price_cents
    else p_price_cents
  end;

  if v_regular <= 0 then return null; end if;

  v_effective := public.storefront_effective_price(
    p_price_cents, p_original_price_cents, p_is_deal
  );

  if v_effective >= v_regular then return null; end if;

  return greatest(
    1,
    round((v_regular - v_effective) * 100.0 / v_regular)::integer
  );
end;
$$;

revoke all on function public.storefront_effective_discount_percent(integer,integer,boolean) from public;
grant execute on function public.storefront_effective_discount_percent(integer,integer,boolean)
to anon, authenticated, service_role;

drop view if exists public.inventory_public;

create view public.inventory_public
with (security_invoker = true)
as
select
  i.id,
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
  public.storefront_effective_price(
    i.price_cents, i.original_price_cents, i.is_deal
  ) as price_cents,
  public.storefront_effective_original_price(
    i.price_cents, i.original_price_cents, i.is_deal
  ) as original_price_cents,
  public.storefront_effective_discount_percent(
    i.price_cents, i.original_price_cents, i.is_deal
  ) as discount_percent,
  i.scryfall_price_cents
from public.inventory_items i
left join (
  select inventory_item_id, sum(quantity)::integer as reserved_qty
  from public.inventory_reservations
  where status = 'active'
  group by inventory_item_id
) r on r.inventory_item_id = i.id
where i.status = 'active'
  and (i.quantity - coalesce(r.reserved_qty, 0)) > 0;

grant select on public.inventory_public to anon, authenticated;

create or replace function public.search_inventory(
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
  deal_source text, deal_started_at timestamptz, total_count bigint
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
    f.deal_source, f.deal_started_at,
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

create or replace function public.search_deals(
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
  deal_discount_percent integer, deal_source text, deal_started_at timestamptz,
  total_count bigint
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
    f.deal_source, f.deal_started_at, c.n
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

-- Preserve existing overloads and business logic while swapping their unit
-- price source to the effective sale-aware price.
do $$
declare
  rec record;
  ddl text;
begin
  for rec in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'checkout_create_order',
        'pos_create_sale',
        'pos_complete_pickup_sale'
      )
  loop
    ddl := pg_get_functiondef(rec.oid);

    if rec.proname in ('checkout_create_order','pos_create_sale') then
      ddl := replace(
        ddl,
        'v_unit := v_inv.price_cents;',
        'v_unit := public.storefront_effective_price(v_inv.price_cents, v_inv.original_price_cents, v_inv.is_deal);'
      );
    elsif rec.proname = 'pos_complete_pickup_sale' then
      ddl := replace(
        ddl,
        'v_line := v_inv.price_cents * ri.quantity;',
        'v_line := public.storefront_effective_price(v_inv.price_cents, v_inv.original_price_cents, v_inv.is_deal) * ri.quantity;'
      );
      ddl := replace(
        ddl,
        'ri.quantity, v_inv.price_cents, v_line',
        'ri.quantity, public.storefront_effective_price(v_inv.price_cents, v_inv.original_price_cents, v_inv.is_deal), v_line'
      );
    end if;

    execute ddl;
  end loop;
end $$;
