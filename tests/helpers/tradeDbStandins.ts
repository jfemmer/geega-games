// The tables and functions the Trade Center's database builds on (production's
// definitions, trimmed to what it touches), for running the trade migrations
// in PGlite. Shared by tests/tradeCenterDb.test.ts and
// tests/tradeLocalPickupDb.test.ts.

export const STANDINS = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table auth.users (id uuid primary key, email text, is_anonymous boolean not null default false);
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'anon') $$;

create type public.inventory_movement_reason as enum ('manual_add','manual_remove','correction','scan_add','batch_scan_add','order_reserved','order_shipped','order_cancelled','import','archive','restore','return_restock');
create type public.card_condition as enum ('NM','LP','MP','HP','DMG');
create type public.card_finish as enum ('nonfoil','foil','etched');
create type public.inventory_status as enum ('active','reserved','archived');
create type public.reservation_status as enum ('active','released','fulfilled');
create type public.order_status as enum ('pending_payment','paid','packing','ready_to_ship','shipped','delivered','cancelled','refunded');
create type public.payment_status as enum ('unpaid','processing','paid','refunded','failed');
create type public.payment_provider as enum ('stripe','paypal','store_credit','manual');
create type public.shipping_method as enum ('tracked','pwe');
create type public.order_channel as enum ('online','pos');
create type public.store_credit_type as enum ('opening_balance','admin_adjustment','order_spend','order_refund','trade_in_payout','referral_reward');

create function public.tg_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create function public.is_staff() returns boolean language sql stable as $$ select false $$;
create function public.inventory_write_authorized() returns boolean language sql stable as $$ select public.is_staff() or auth.role() = 'service_role' $$;

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(), scryfall_id uuid, oracle_id uuid, card_name text not null,
  set_code text not null, set_name text, collector_number text not null, rarity text, type_line text, image_url text,
  condition public.card_condition not null, finish public.card_finish not null, quantity integer not null default 0 check (quantity >= 0),
  price_cents integer, cost_cents integer, scryfall_price_cents integer, storage_location text, sku text, notes text,
  variant_type text not null default '', language text not null default 'en', colors text[] not null default '{}',
  creature_types text[] not null default '{}', status public.inventory_status not null default 'active',
  original_price_cents integer, is_deal boolean not null default false,
  -- Production's (20261028120000_consignment_foundation.sql): only business-owned stock is traded or joined.
  ownership text not null default 'business',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(), inventory_item_id uuid not null references public.inventory_items(id),
  customer_id uuid, quantity integer not null check (quantity > 0), status public.reservation_status not null default 'active', note text,
  reserved_by text, reserved_at timestamptz not null default now(), released_at timestamptz, released_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), pickup_request_id uuid,
  constraint chk_reservation_holder check (((customer_id is not null) and (pickup_request_id is null)) or ((customer_id is null) and (pickup_request_id is not null)))
);
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(), inventory_item_id uuid not null, card_name text not null, delta integer not null,
  previous_quantity integer not null, resulting_quantity integer not null, reason public.inventory_movement_reason not null,
  related_order_number text, actor text, note text, created_at timestamptz not null default now()
);
create function public.us_state_code(p_state text) returns text language sql immutable set search_path to '' as $f$
  select r.code from (values ('AL','ALABAMA'),('CA','CALIFORNIA'),('IL','ILLINOIS'),('KS','KANSAS'),('MO','MISSOURI'),('NY','NEW YORK'),('TX','TEXAS')) as r(code, name)
  where upper(btrim(regexp_replace(regexp_replace(coalesce(p_state, ''), '[.,]', '', 'g'), '[[:space:]]+', ' ', 'g'))) in (r.code, r.name) limit 1 $f$;
create function public.us_zip(p_zip text) returns text language sql immutable set search_path to '' as $f$
  select case when z ~ '^[0-9]{5}$' then z when z ~ '^[0-9]{5}[- ]?[0-9]{4}$' then left(z, 5) || '-' || right(z, 4) end
  from (select btrim(coalesce(p_zip, '')) as z) s $f$;
create table public.orders (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete restrict, email text, ship_recipient text, ship_line1 text, ship_line2 text,
  ship_city text, ship_state text, ship_postal_code text, ship_country text default 'US', subtotal_cents integer not null check (subtotal_cents >= 0),
  shipping_cents integer not null default 0 check (shipping_cents >= 0), discount_cents integer not null default 0 check (discount_cents >= 0),
  store_credit_used_cents integer not null default 0 check (store_credit_used_cents >= 0),
  total_cents integer not null check (total_cents >= 0), amount_due_cents integer not null check (amount_due_cents >= 0), shipping_method public.shipping_method,
  payment_provider public.payment_provider, payment_reference text, payment_status public.payment_status not null default 'unpaid',
  paid_at timestamptz, delivered_at timestamptz, status public.order_status not null default 'pending_payment', internal_notes text,
  channel public.order_channel not null default 'online', tax_cents integer not null default 0 check (tax_cents >= 0), customer_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint chk_amount_due check (amount_due_cents = (total_cents - store_credit_used_cents)),
  constraint chk_online_requires_identity check ((channel <> 'online'::order_channel) or ((email is not null) and (shipping_method is not null))),
  constraint chk_orders_ship_within_us check (((ship_country is null) or (ship_country = 'US')) and ((ship_state is null) or (public.us_state_code(ship_state) is not null)) and ((ship_postal_code is null) or (public.us_zip(ship_postal_code) is not null)))
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), inventory_item_id uuid,
  scryfall_id uuid, set_code text, collector_number text, card_name text not null, set_name text,
  condition public.card_condition not null, finish public.card_finish not null, variant_type text not null default '',
  image_url text, quantity integer not null check (quantity > 0), unit_price_cents integer not null check (unit_price_cents >= 0), line_total_cents integer not null check (line_total_cents >= 0),
  created_at timestamptz not null default now(), packed boolean not null default false
);
create table public.store_credit_transactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, amount_cents integer not null,
  type public.store_credit_type not null, reason text, reference_type text, reference_id uuid, created_by uuid,
  created_at timestamptz not null default now()
);
create function public.store_credit_balance(p_user_id uuid) returns integer language sql stable as $$
  select coalesce(sum(amount_cents), 0)::integer from public.store_credit_transactions where user_id = p_user_id $$;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function public.staff_or_service_role() returns boolean language sql stable as $$ select auth.role() = 'service_role' $$;
create table public.photo_requests (status text); create table public.pickup_requests (status text);
create table public.sell_submissions (status text); create table public.referral_leads (status text);
create table public.partners (status text); create table public.sorting_requests (status text);
create table public.customers (source text, created_at timestamptz not null default now());
create table public.staff_section_seen (user_id uuid, section text, seen_at timestamptz);
create table public.staff_push_subscriptions (
  id uuid primary key default gen_random_uuid(), kinds text[] not null, updated_at timestamptz not null default now(),
  constraint staff_push_subscriptions_kinds_check check (kinds <@ array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup', 'photo_request', 'sorting_request']::text[])
);
insert into public.staff_push_subscriptions (kinds) values (array['order', 'sorting_request']);
`;

export const UPSERT = `
create function public.admin_upsert_inventory(p_scryfall_id uuid, p_oracle_id uuid, p_card_name text, p_set_code text, p_set_name text, p_collector_number text, p_rarity text, p_type_line text, p_image_url text, p_condition card_condition, p_finish card_finish, p_quantity integer, p_price_cents integer, p_cost_cents integer DEFAULT NULL::integer, p_scryfall_price_cents integer DEFAULT NULL::integer, p_storage_location text DEFAULT NULL::text, p_sku text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_variant_type text DEFAULT ''::text, p_language text DEFAULT 'en'::text, p_colors text[] DEFAULT '{}'::text[], p_creature_types text[] DEFAULT '{}'::text[], p_actor text DEFAULT NULL::text, p_reason inventory_movement_reason DEFAULT 'manual_add'::inventory_movement_reason)
 RETURNS inventory_items LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_row public.inventory_items; v_prev integer;
begin
  if not public.inventory_write_authorized() then raise exception 'Staff access required' using errcode = '42501'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'Quantity must be at least 1'; end if;
  select * into v_row from public.inventory_items i
  where i.status = 'active' and i.condition = p_condition and i.finish = p_finish
    and coalesce(i.variant_type, '') = coalesce(p_variant_type, '') and coalesce(i.language, 'en') = coalesce(p_language, 'en')
    and ((p_scryfall_id is not null and i.scryfall_id = p_scryfall_id)
      or (p_scryfall_id is null and i.scryfall_id is null and i.set_code = p_set_code and i.collector_number = p_collector_number))
  limit 1 for update;
  if found then
    v_prev := v_row.quantity;
    update public.inventory_items set quantity = quantity + p_quantity, price_cents = coalesce(price_cents, p_price_cents),
      image_url = coalesce(image_url, p_image_url), scryfall_price_cents = coalesce(p_scryfall_price_cents, scryfall_price_cents)
      where id = v_row.id returning * into v_row;
  else
    insert into public.inventory_items (scryfall_id, oracle_id, card_name, set_code, set_name, collector_number, rarity, type_line,
      image_url, condition, finish, quantity, price_cents, cost_cents, scryfall_price_cents, storage_location, sku, notes,
      variant_type, language, colors, creature_types, status)
    values (p_scryfall_id, p_oracle_id, p_card_name, p_set_code, p_set_name, p_collector_number, p_rarity, p_type_line, p_image_url,
      p_condition, p_finish, p_quantity, p_price_cents, p_cost_cents, p_scryfall_price_cents, p_storage_location, p_sku, p_notes,
      coalesce(p_variant_type, ''), coalesce(p_language, 'en'), coalesce(p_colors, '{}'), coalesce(p_creature_types, '{}'), 'active')
    returning * into v_row;
    v_prev := 0;
  end if;
  insert into public.inventory_movements (inventory_item_id, card_name, delta, previous_quantity, resulting_quantity, reason, actor)
  values (v_row.id, v_row.card_name, p_quantity, v_prev, v_row.quantity, p_reason, p_actor);
  return v_row;
end;
$function$;
`;
