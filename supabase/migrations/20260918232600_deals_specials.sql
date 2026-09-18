-- Deals & Specials merchandising.
-- Staff can place inventory in Deals manually. Active in-stock cards with a
-- regular price of at least $5 are automatically marked down 20% after 30 days
-- on the storefront. The regular price is retained for display and recovery.

alter table public.inventory_items
  add column if not exists storefront_listed_at timestamptz,
  add column if not exists is_deal boolean not null default false,
  add column if not exists deal_source text,
  add column if not exists original_price_cents integer,
  add column if not exists deal_discount_percent integer,
  add column if not exists deal_started_at timestamptz;

update public.inventory_items
set storefront_listed_at = created_at
where storefront_listed_at is null;

alter table public.inventory_items
  alter column storefront_listed_at set default now(),
  alter column storefront_listed_at set not null;

alter table public.inventory_items drop constraint if exists inventory_items_deal_source_check;
alter table public.inventory_items
  add constraint inventory_items_deal_source_check
  check (deal_source is null or deal_source in ('manual','aged_inventory'));

alter table public.inventory_items drop constraint if exists inventory_items_original_price_check;
alter table public.inventory_items
  add constraint inventory_items_original_price_check
  check (original_price_cents is null or original_price_cents >= 0);

alter table public.inventory_items drop constraint if exists inventory_items_deal_discount_check;
alter table public.inventory_items
  add constraint inventory_items_deal_discount_check
  check (deal_discount_percent is null or deal_discount_percent between 1 and 90);

create or replace function public.inventory_storefront_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  relisted boolean := false;
begin
  if tg_op = 'INSERT' then
    new.storefront_listed_at := coalesce(new.storefront_listed_at, now());
    return new;
  end if;

  relisted :=
    (old.quantity <= 0 and new.quantity > 0)
    or (old.status <> 'active' and new.status = 'active');

  if relisted then
    new.storefront_listed_at := now();
    if old.deal_source = 'aged_inventory' then
      new.price_cents := coalesce(old.original_price_cents, new.price_cents);
      new.is_deal := false;
      new.deal_source := null;
      new.original_price_cents := null;
      new.deal_discount_percent := null;
      new.deal_started_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_storefront_lifecycle_trg on public.inventory_items;
create trigger inventory_storefront_lifecycle_trg
before insert or update of quantity, status on public.inventory_items
for each row execute function public.inventory_storefront_lifecycle();

create or replace function public.apply_aged_inventory_deals()
returns integer
language plpgsql
set search_path = public
as $$
declare
  affected integer;
begin
  update public.inventory_items
  set original_price_cents = price_cents,
      price_cents = round(price_cents * 0.80)::integer,
      is_deal = true,
      deal_source = 'aged_inventory',
      deal_discount_percent = 20,
      deal_started_at = now(),
      updated_at = now()
  where status = 'active'
    and quantity > 0
    and is_deal = false
    and price_cents >= 500
    and storefront_listed_at <= now() - interval '30 days';

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.apply_aged_inventory_deals() from public, anon, authenticated;
grant execute on function public.apply_aged_inventory_deals() to postgres, service_role;

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
  p_include_archived boolean default false
)
returns table(
  id uuid, scryfall_id uuid, oracle_id uuid, set_code text,
  collector_number text, card_name text, set_name text, rarity text,
  type_line text, colors text[], creature_types text[], image_url text,
  condition public.card_condition, finish public.card_finish, foil boolean,
  variant_type text, quantity integer, price_cents integer,
  original_price_cents integer, deal_discount_percent integer,
  deal_source text, deal_started_at timestamptz, total_count bigint
)
language sql
stable
set search_path = public
as $$
  with base as (
    select i.*,
      greatest(0, i.quantity - coalesce((
        select sum(r.quantity)::int from public.inventory_reservations r
        where r.inventory_item_id = i.id and r.status = 'active'
      ), 0)) as sellable_qty
    from public.inventory_items i
  ),
  filtered as (
    select b.* from base b
    where
      (b.status = 'active' or (p_include_archived is true and b.status = 'archived'))
      and (p_query is null or p_query = ''
        or b.card_name ilike '%' || p_query || '%'
        or b.set_code ilike '%' || p_query || '%'
        or b.set_name ilike '%' || p_query || '%'
        or b.collector_number ilike '%' || p_query || '%')
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
    f.sellable_qty, f.price_cents, f.original_price_cents,
    f.deal_discount_percent, f.deal_source, f.deal_started_at, c.n
  from filtered f cross join counted c
  order by
    case when p_sort = 'name_asc' then f.card_name end asc nulls last,
    case when p_sort = 'name_desc' then f.card_name end desc nulls last,
    case when p_sort = 'price_asc' then f.price_cents end asc nulls last,
    case when p_sort = 'price_desc' then f.price_cents end desc nulls last,
    case when p_sort = 'newest' then f.created_at end desc nulls last,
    f.card_name asc, f.id asc
  limit greatest(1, least(coalesce(p_limit, 24), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.search_inventory(
  text, text[], text[], text[], public.card_condition[], public.card_finish[],
  text[], integer, integer, boolean, text, integer, integer, boolean
) to public, anon, authenticated, service_role;

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
      greatest(0, i.quantity - coalesce((
        select sum(r.quantity)::int from public.inventory_reservations r
        where r.inventory_item_id = i.id and r.status = 'active'
      ), 0)) as sellable_qty
    from public.inventory_items i
    where i.status = 'active' and i.is_deal = true
  ),
  filtered as (
    select b.* from base b
    where b.sellable_qty > 0
      and (p_query is null or p_query = ''
        or b.card_name ilike '%' || p_query || '%'
        or b.set_code ilike '%' || p_query || '%'
        or b.set_name ilike '%' || p_query || '%'
        or b.collector_number ilike '%' || p_query || '%')
      and (p_sets is null or b.set_code = any(p_sets))
      and (p_rarities is null or b.rarity = any(p_rarities))
      and (p_conditions is null or b.condition = any(p_conditions))
      and (p_min_price_cents is null or b.price_cents >= p_min_price_cents)
      and (p_max_price_cents is null or b.price_cents <= p_max_price_cents)
  ),
  counted as (select count(*) as n from filtered)
  select
    f.id, f.scryfall_id, f.set_code, f.set_name, f.collector_number,
    f.card_name, f.rarity, f.type_line, f.image_url, f.condition, f.finish,
    f.sellable_qty, f.price_cents, f.original_price_cents,
    f.deal_discount_percent, f.deal_source, f.deal_started_at, c.n
  from filtered f cross join counted c
  order by
    case when p_sort = 'name_asc' then f.card_name end asc nulls last,
    case when p_sort = 'name_desc' then f.card_name end desc nulls last,
    case when p_sort = 'price_asc' then f.price_cents end asc nulls last,
    case when p_sort = 'price_desc' then f.price_cents end desc nulls last,
    case when p_sort = 'newest' then f.deal_started_at end desc nulls last,
    f.card_name asc, f.id asc
  limit greatest(1, least(coalesce(p_limit, 24), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.search_deals(
  text, text[], text[], public.card_condition[], integer, integer,
  text, integer, integer
) to anon, authenticated, service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'geega-aged-inventory-deals'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end;
$$;

select cron.schedule(
  'geega-aged-inventory-deals',
  '15 4 * * *',
  'select public.apply_aged_inventory_deals();'
);
