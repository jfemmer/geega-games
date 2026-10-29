// Production pieces the consignment Phase 4+ migrations build on, beyond the
// trade standins: deal columns, shipping fields, storewide sales and the
// three-argument price functions (production's definitions), plus one
// existing function and view that price inventory, so the Phase 4 rewrite of
// them is exercised. Shared by the consignment sales and claims DB tests.

// What production has that the migration builds on: deal columns, shipping
// fields, storewide sales and the three-argument price functions (production's
// definitions), plus one existing function and view that price inventory, so
// the migration's rewrite of them is exercised.
export const PROD = `
alter table public.inventory_items add column deal_source text, add column deal_discount_percent integer,
  add column deal_started_at timestamptz, add column deal_note text;
alter table public.orders add column shipped_at timestamptz, add column postage_cost_cents integer,
  add column tracking_carrier text, add column tracking_number text, add column shipping_service text;
create function public.is_us_country(p text) returns boolean language sql immutable as $$ select coalesce(upper(p), 'US') in ('US', 'USA') $$;
create table public.storewide_sales (id uuid primary key default gen_random_uuid(), name text, enabled boolean not null default true,
  discount_percent integer not null, starts_at timestamptz not null, ends_at timestamptz not null);
create function public.storefront_effective_price(p_price_cents integer, p_original_price_cents integer, p_is_deal boolean)
returns integer language plpgsql stable set search_path to '' as $f$
declare v_discount integer; v_regular integer; v_sale_price integer;
begin
  if p_price_cents is null then return null; end if;
  select s.discount_percent into v_discount from public.storewide_sales s
  where s.enabled = true and now() >= s.starts_at and now() < s.ends_at order by s.starts_at desc limit 1;
  if v_discount is null then return p_price_cents; end if;
  v_regular := case when coalesce(p_is_deal, false) and p_original_price_cents is not null then p_original_price_cents else p_price_cents end;
  v_sale_price := greatest(1, round(v_regular * (100 - v_discount) / 100.0)::integer);
  return least(p_price_cents, v_sale_price);
end $f$;
create function public.storefront_effective_original_price(p_price_cents integer, p_original_price_cents integer, p_is_deal boolean)
returns integer language plpgsql stable set search_path to '' as $f$
declare v_effective integer; v_regular integer;
begin
  if p_price_cents is null then return null; end if;
  v_regular := case when coalesce(p_is_deal, false) and p_original_price_cents is not null then p_original_price_cents else p_price_cents end;
  v_effective := public.storefront_effective_price(p_price_cents, p_original_price_cents, p_is_deal);
  if v_effective < v_regular then return v_regular; end if;
  return p_original_price_cents;
end $f$;
create function public.storefront_effective_discount_percent(p_price_cents integer, p_original_price_cents integer, p_is_deal boolean)
returns integer language plpgsql stable set search_path to '' as $f$
declare v_effective integer; v_regular integer;
begin
  v_regular := public.storefront_effective_original_price(p_price_cents, p_original_price_cents, p_is_deal);
  v_effective := public.storefront_effective_price(p_price_cents, p_original_price_cents, p_is_deal);
  if v_regular is null or v_regular <= 0 or v_effective >= v_regular then return null; end if;
  return round((v_regular - v_effective) * 100.0 / v_regular)::integer;
end $f$;
create function public.inventory_live_prices(p_inventory_item_ids uuid[])
returns table(inventory_item_id uuid, price_cents integer) language sql stable set search_path to '' as $f$
  select i.id, public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal)
  from public.inventory_items i where i.id = any(p_inventory_item_ids);
$f$;
create view public.inventory_public with (security_invoker = true) as
  select i.id, public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal) as price_cents,
         public.storefront_effective_original_price(i.price_cents, i.original_price_cents, i.is_deal) as original_price_cents
  from public.inventory_items i where i.status = 'active';
`;
