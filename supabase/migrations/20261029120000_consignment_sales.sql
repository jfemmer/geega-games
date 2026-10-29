-- Consignments, Phase 4: listing accepted cards, recording every sale, and payouts.
--
--   Listing         consignment_list_lot() puts accepted copies on sale on the
--                   website (only when the consignor approved website sales),
--                   at the list price and never below their minimum.
--   No discounts    Consigned cards always sell at their listed price: no
--                   storewide sale, deal markdown, member discount or yard-sale
--                   price applies to them (storefront_effective_*(..., ownership),
--                   checkout_place_order_core, and the guards below).
--   Website only    In person (register, kiosk pickups, yard sale lists) is not
--                   a channel a consignor can approve, so those refuse consigned
--                   cards. TCGplayer and eBay sales are recorded by staff with
--                   consignment_record_external_sale().
--   Sales ledger    consignment_sales: one row per consigned order line or
--                   marketplace sale. Website sales are recorded automatically
--                   when the order is paid, follow it as it ships and is
--                   delivered, and are cancelled (and put back on sale if they
--                   never shipped) when the order is cancelled or refunded.
--   Settlement      After delivery and the inspection period, staff confirm the
--                   actual expenses; the database computes the Net Sale Amount,
--                   Commission (tier by the card's price, from the consignor's
--                   signed agreement) and the payout.
--   Payouts         consignment_payouts: payments to the consignor, recorded by
--                   staff (paid outside the site), covering settled sales.
--
-- Run after 20261028180000. Safe to run more than once.
-- Error codes: GC050-GC079.

-- ============================================================ prices: consigned cards are never discounted

-- The ownership-aware versions. Business rows get exactly what they got before
-- (they call the existing three-argument functions); consigned rows always get
-- their own price, with no "was" price and no discount.
create or replace function public.storefront_effective_price(p_price_cents integer, p_original_price_cents integer, p_is_deal boolean, p_ownership text)
returns integer
language sql
stable
set search_path to ''
as $$
  select case when p_ownership = 'consigned' then p_price_cents
    else public.storefront_effective_price(p_price_cents, p_original_price_cents, p_is_deal) end;
$$;

create or replace function public.storefront_effective_original_price(p_price_cents integer, p_original_price_cents integer, p_is_deal boolean, p_ownership text)
returns integer
language sql
stable
set search_path to ''
as $$
  select case when p_ownership = 'consigned' then null::integer
    else public.storefront_effective_original_price(p_price_cents, p_original_price_cents, p_is_deal) end;
$$;

create or replace function public.storefront_effective_discount_percent(p_price_cents integer, p_original_price_cents integer, p_is_deal boolean, p_ownership text)
returns integer
language sql
stable
set search_path to ''
as $$
  select case when p_ownership = 'consigned' then null::integer
    else public.storefront_effective_discount_percent(p_price_cents, p_original_price_cents, p_is_deal) end;
$$;

grant execute on function public.storefront_effective_price(integer, integer, boolean, text) to anon, authenticated, service_role;
grant execute on function public.storefront_effective_original_price(integer, integer, boolean, text) to anon, authenticated, service_role;
grant execute on function public.storefront_effective_discount_percent(integer, integer, boolean, text) to anon, authenticated, service_role;

-- The cart's prices and stock, now saying which lines are consigned (sale
-- only: no member discount). Production's definition plus sale_only, and the
-- ownership-aware price. The return type changes, so it's dropped first.
drop function if exists public.cart_item_availability(uuid[]);
create function public.cart_item_availability(p_ids uuid[])
returns table(id uuid, card_name text, set_code text, set_name text, condition public.card_condition, finish public.card_finish,
              image_url text, price_cents integer, quantity integer, variant_type text, sale_only boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with ids as (
    select distinct x as id from unnest(p_ids) x
    where cardinality(p_ids) <= 500
  ),
  held as (
    select oi.inventory_item_id, sum(oi.quantity)::int as qty
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join ids on ids.id = oi.inventory_item_id
    where auth.uid() is not null and o.user_id = auth.uid()
      and o.channel = 'online' and o.status = 'pending_payment'
      and o.payment_status in ('unpaid', 'processing')
    group by oi.inventory_item_id
  ),
  res as (
    select r.inventory_item_id, sum(r.quantity)::int as reserved_qty
    from public.inventory_reservations r
    join ids on ids.id = r.inventory_item_id
    where r.status = 'active'
    group by r.inventory_item_id
  )
  select i.id, i.card_name, i.set_code, i.set_name, i.condition, i.finish, i.image_url,
         public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal, i.ownership),
         (greatest(i.quantity - coalesce(res.reserved_qty, 0), 0) + coalesce(held.qty, 0))::int,
         i.variant_type,
         i.ownership = 'consigned'
  from public.inventory_items i
  join ids on ids.id = i.id
  left join res on res.inventory_item_id = i.id
  left join held on held.inventory_item_id = i.id
  where i.status = 'active'
    and greatest(i.quantity - coalesce(res.reserved_qty, 0), 0) + coalesce(held.qty, 0) > 0;
$function$;
revoke all on function public.cart_item_availability(uuid[]) from public;
grant execute on function public.cart_item_availability(uuid[]) to anon, authenticated, service_role;

-- Online checkout: production's definition (20261009010000_member_discount)
-- with three changes for consigned cards:
--   * their price is the ownership-aware one (no storewide sale);
--   * the member discount is taken off the other cards only;
--   * an order with a consigned card always ships tracked, so its delivery
--     (which starts the buyer's inspection period) is known. Free shipping
--     is still decided on the whole card subtotal.
create or replace function public.checkout_place_order_core(
  p_uid uuid,
  p_email text,
  p_items jsonb,
  p_shipping_method public.shipping_method,
  p_store_credit_requested_cents integer,
  p_ship_recipient text,
  p_ship_line1 text,
  p_ship_line2 text,
  p_ship_city text,
  p_ship_state text,
  p_ship_postal_code text,
  p_ship_country text
)
returns table(
  order_id uuid,
  subtotal_cents integer,
  shipping_cents integer,
  total_cents integer,
  store_credit_used_cents integer,
  amount_due_cents integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_subtotal integer := 0;
  -- Consigned cards in the order: never member-discounted, always tracked.
  v_consigned_subtotal integer := 0;
  v_has_consigned boolean := false;
  v_discount integer := 0;
  v_shipping integer := 0;
  v_total integer := 0;
  v_credit_balance integer := 0;
  v_credit_used integer := 0;
  v_amount_due integer := 0;
  v_order_id uuid;
  v_lines integer;
  v_method public.shipping_method := p_shipping_method;
  v_ship_state text;
  v_ship_zip text;
  r record;
  c_tracked_cents constant integer := 550;
  c_pwe_cents constant integer := 150;
  c_free_shipping_threshold constant integer := 7500;
  -- Mirrored by MEMBER_DISCOUNT_PERCENT in src/store/lib/money.ts.
  c_member_discount_percent constant integer := 5;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'cart is empty' using errcode = 'P0001';
  end if;

  select count(distinct (e->>'inventory_item_id')) into v_lines from jsonb_array_elements(p_items) e;
  if v_lines > 100 then
    raise exception 'too many items' using errcode = 'P0006';
  end if;

  if nullif(btrim(p_ship_line1), '') is null
     or nullif(btrim(p_ship_city), '') is null
     or nullif(btrim(p_ship_state), '') is null
     or nullif(btrim(p_ship_postal_code), '') is null then
    raise exception 'shipping address required' using errcode = 'P0009';
  end if;
  v_ship_state := public.us_state_code(p_ship_state);
  v_ship_zip := public.us_zip(p_ship_postal_code);
  if not public.is_us_country(p_ship_country) or v_ship_state is null or v_ship_zip is null then
    raise exception 'us shipping only' using errcode = 'P0010';
  end if;

  insert into public.orders (
    user_id, email, shipping_method,
    subtotal_cents, shipping_cents, discount_cents,
    store_credit_used_cents, total_cents, amount_due_cents,
    ship_recipient, ship_line1, ship_line2, ship_city, ship_state, ship_postal_code, ship_country,
    status, payment_status
  ) values (
    p_uid, p_email, p_shipping_method, 0, 0, 0, 0, 0, 0,
    nullif(btrim(p_ship_recipient), ''), btrim(p_ship_line1), nullif(btrim(p_ship_line2), ''),
    btrim(p_ship_city), v_ship_state, v_ship_zip, 'US',
    'pending_payment', 'unpaid'
  ) returning id into v_order_id;

  for r in
    select (e->>'inventory_item_id')::uuid as inv_id, sum((e->>'quantity')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1
  loop
    declare
      v_inv public.inventory_items%rowtype;
      v_unit integer;
      v_line integer;
      v_reserved integer;
      v_sellable integer;
    begin
      if r.qty is null or r.qty <= 0 or r.qty > 99 then
        raise exception 'invalid quantity' using errcode = 'P0007';
      end if;

      select * into v_inv from public.inventory_items where id = r.inv_id for update;
      if not found then
        raise exception 'item no longer available' using errcode = 'P0002';
      end if;
      if v_inv.status = 'archived' then
        raise exception 'item no longer available' using errcode = 'P0002';
      end if;
      if v_inv.price_cents is null then
        raise exception 'item has no price: %', v_inv.card_name using errcode = 'P0003';
      end if;

      select coalesce(sum(res.quantity), 0)::int into v_reserved
      from public.inventory_reservations res
      where res.inventory_item_id = v_inv.id and res.status = 'active';

      v_sellable := greatest(0, v_inv.quantity - v_reserved);

      if v_sellable < r.qty then
        raise exception 'insufficient stock for % (sellable %, need %)',
          v_inv.card_name, v_sellable, r.qty using errcode = 'P0004';
      end if;

      v_unit := public.storefront_effective_price(v_inv.price_cents, v_inv.original_price_cents, v_inv.is_deal, v_inv.ownership);
      v_line := v_unit * r.qty;
      v_subtotal := v_subtotal + v_line;
      if v_inv.ownership = 'consigned' then
        v_consigned_subtotal := v_consigned_subtotal + v_line;
        v_has_consigned := true;
      end if;

      insert into public.order_items (
        order_id, inventory_item_id, scryfall_id, set_code, collector_number,
        card_name, set_name, condition, finish, variant_type, image_url,
        quantity, unit_price_cents, line_total_cents
      ) values (
        v_order_id, v_inv.id, v_inv.scryfall_id, v_inv.set_code, v_inv.collector_number,
        v_inv.card_name, v_inv.set_name, v_inv.condition, v_inv.finish, v_inv.variant_type, v_inv.image_url,
        r.qty, v_unit, v_line
      );

      update public.inventory_items set quantity = quantity - r.qty where id = v_inv.id;
    end;
  end loop;

  if v_subtotal = 0 then
    raise exception 'cart is empty' using errcode = 'P0001';
  end if;

  if v_subtotal >= c_free_shipping_threshold then
    v_method := 'tracked';
    v_shipping := 0;
  elsif p_shipping_method = 'tracked' or v_has_consigned then
    v_method := 'tracked';
    v_shipping := c_tracked_cents;
  elsif p_shipping_method = 'pwe' then
    v_shipping := c_pwe_cents;
  end if;

  -- The member discount: off the cards that aren't consigned, rounded to the
  -- nearest cent (half up), after free shipping was decided on the full price.
  if p_uid is not null
     and not exists (select 1 from auth.users u where u.id = p_uid and u.is_anonymous) then
    v_discount := (((v_subtotal - v_consigned_subtotal)::bigint * c_member_discount_percent + 50) / 100)::integer;
  end if;

  v_total := v_subtotal - v_discount + v_shipping;
  if p_uid is not null then
    v_credit_balance := public.store_credit_balance(p_uid);
    v_credit_used := least(
      greatest(coalesce(p_store_credit_requested_cents, 0), 0),
      greatest(v_credit_balance, 0), v_total
    );
  end if;
  v_amount_due := v_total - v_credit_used;

  if v_credit_used > 0 then
    insert into public.store_credit_transactions
      (user_id, amount_cents, type, reason, reference_type, reference_id)
    values (p_uid, -v_credit_used, 'order_spend', 'Checkout', 'order', v_order_id);
  end if;

  update public.orders set
    shipping_method = v_method,
    subtotal_cents = v_subtotal,
    discount_cents = v_discount,
    shipping_cents = v_shipping,
    store_credit_used_cents = v_credit_used,
    total_cents = v_total,
    amount_due_cents = v_amount_due,
    payment_provider = case when v_amount_due = 0 then 'store_credit'::payment_provider else null end,
    payment_status = (case when v_amount_due = 0 then 'paid' else 'unpaid' end)::payment_status,
    status = (case when v_amount_due = 0 then 'paid' else 'pending_payment' end)::order_status,
    paid_at = case when v_amount_due = 0 then now() else null end
  where id = v_order_id;

  return query select v_order_id, v_subtotal, v_shipping, v_total, v_credit_used, v_amount_due;
end;
$function$;

-- Unchanged: only the server (service role) may call this directly.
revoke all on function public.checkout_place_order_core(
  uuid, text, jsonb, public.shipping_method, integer, text, text, text, text, text, text, text
) from public, anon, authenticated;

-- Every other function and view that prices inventory rows: switch each
-- storefront_effective_*(x.price_cents, x.original_price_cents, x.is_deal)
-- call to the ownership-aware version, keeping everything else exactly as it
-- is in production. Found by pattern, so nothing is missed, and checked
-- afterwards: the migration fails if any such call is left.
do $rewrite$
declare
  -- x.price_cents, x.original_price_cents, x.is_deal (qualified by any alias) ...
  v_pattern constant text := 'storefront_effective_(price|original_price|discount_percent)\(\s*(\w+)\.price_cents\s*,\s*\2\.original_price_cents\s*,\s*\2\.is_deal\s*\)';
  v_replace constant text := 'storefront_effective_\1(\2.price_cents, \2.original_price_cents, \2.is_deal, \2.ownership)';
  -- ... or unqualified (a view over one table prints its columns that way).
  v_bare constant text := 'storefront_effective_(price|original_price|discount_percent)\(\s*price_cents\s*,\s*original_price_cents\s*,\s*is_deal\s*\)';
  v_bare_replace constant text := 'storefront_effective_\1(price_cents, original_price_cents, is_deal, ownership)';
  f record;
  v record;
  v_new text;
  v_left integer;
begin
  for f in
    select p.oid
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and p.proname not like 'storefront\_effective\_%'
      and (pg_get_functiondef(p.oid) ~ v_pattern or pg_get_functiondef(p.oid) ~ v_bare)
  loop
    v_new := regexp_replace(regexp_replace(pg_get_functiondef(f.oid), v_pattern, v_replace, 'g'), v_bare, v_bare_replace, 'g');
    execute v_new;
  end loop;

  -- A view keeps its options (inventory_public is security_invoker): CREATE OR
  -- REPLACE VIEW without them would drop them.
  for v in
    select c.oid, c.relname, c.reloptions
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
      and (pg_get_viewdef(c.oid) ~ v_pattern or pg_get_viewdef(c.oid) ~ v_bare)
  loop
    v_new := regexp_replace(regexp_replace(pg_get_viewdef(v.oid), v_pattern, v_replace, 'g'), v_bare, v_bare_replace, 'g');
    execute format('create or replace view public.%I%s as %s', v.relname,
      case when v.reloptions is null then '' else ' with (' || array_to_string(v.reloptions, ', ') || ')' end, v_new);
  end loop;

  select count(*) into v_left
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    and p.proname not like 'storefront\_effective\_%'
    and (pg_get_functiondef(p.oid) ~ v_pattern or pg_get_functiondef(p.oid) ~ v_bare);
  select v_left + count(*) into v_left
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
    and (pg_get_viewdef(c.oid) ~ v_pattern or pg_get_viewdef(c.oid) ~ v_bare);
  if v_left > 0 then
    raise exception 'Consignment pricing: % function(s) or view(s) still price inventory without ownership.', v_left;
  end if;
end;
$rewrite$;

-- ============================================================ consigned inventory rows: rules

-- Consigned rows are never deals, never below the consignor's minimum, and
-- are changed only through Consignments: price, quantity added, status and
-- what card it is. Checkout taking copies, a cancelled checkout putting them
-- back (geega.stock_restore) and photos, notes or storage location are fine.
create or replace function public.tg_consigned_inventory_rules()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_min integer;
  v_managed boolean := coalesce(current_setting('geega.consignment_write', true), '') = 'on';
  v_restore boolean := coalesce(current_setting('geega.stock_restore', true), '') = 'on';
begin
  if new.ownership is distinct from 'consigned' then
    return new;
  end if;
  if new.is_deal or new.original_price_cents is not null or new.deal_source is not null or new.deal_discount_percent is not null then
    raise exception '% is a consigned card. Consigned cards sell at their listed price: no deals or markdowns.', new.card_name using errcode = 'GC050';
  end if;
  select l.min_price_cents into v_min from public.consignment_lots l where l.id = new.consignment_lot_id;
  if v_min is not null and new.price_cents is not null and new.price_cents < v_min then
    raise exception '% can''t be priced below the consignor''s minimum of $%.', new.card_name, to_char(v_min / 100.0, 'FM999990.00') using errcode = 'GC051';
  end if;
  if tg_op = 'UPDATE' and not v_managed then
    if new.price_cents is distinct from old.price_cents
       or new.status is distinct from old.status
       or (new.quantity > old.quantity and not v_restore)
       or new.scryfall_id is distinct from old.scryfall_id
       or new.card_name is distinct from old.card_name
       or new.set_code is distinct from old.set_code
       or new.collector_number is distinct from old.collector_number
       or new.condition is distinct from old.condition
       or new.finish is distinct from old.finish
       or new.language is distinct from old.language
       or new.variant_type is distinct from old.variant_type then
      raise exception '% is a consigned card. Change its price, stock or status in Consignments.', new.card_name using errcode = 'GC052';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists consigned_inventory_rules on public.inventory_items;
create trigger consigned_inventory_rules before insert or update on public.inventory_items
  for each row execute function public.tg_consigned_inventory_rules();

-- Pickup holds (kiosk requests and yard sale lists) can't take consigned cards.
create or replace function public.tg_pickup_hold_not_consigned()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_name text;
begin
  if new.pickup_request_id is null or new.status <> 'active' then
    return new;
  end if;
  select i.card_name into v_name from public.inventory_items i
    where i.id = new.inventory_item_id and i.ownership = 'consigned';
  if found then
    raise exception '% is a consigned card. Consigned cards sell only through the website.', v_name using errcode = 'GC053';
  end if;
  return new;
end;
$$;
drop trigger if exists pickup_hold_not_consigned on public.inventory_reservations;
create trigger pickup_hold_not_consigned before insert or update on public.inventory_reservations
  for each row execute function public.tg_pickup_hold_not_consigned();

-- Order lines for consigned cards: online orders only, at exactly the listed
-- price, and only while the consignor approves website sales.
create or replace function public.tg_order_item_consigned()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_inv public.inventory_items%rowtype;
  v_channel public.order_channel;
  v_consignment uuid;
begin
  if new.inventory_item_id is null then
    return new;
  end if;
  select * into v_inv from public.inventory_items where id = new.inventory_item_id;
  if not found or v_inv.ownership is distinct from 'consigned' then
    return new;
  end if;
  select o.channel into v_channel from public.orders o where o.id = new.order_id;
  if v_channel is distinct from 'online' then
    raise exception '% is a consigned card. Consigned cards sell only through the website.', v_inv.card_name using errcode = 'GC054';
  end if;
  if new.unit_price_cents <> v_inv.price_cents then
    raise exception '% is a consigned card and sells at its listed price.', v_inv.card_name using errcode = 'GC055';
  end if;
  select l.consignment_id into v_consignment from public.consignment_lots l where l.id = v_inv.consignment_lot_id;
  if coalesce((public.consignment_current_elections(v_consignment) -> 'channels' ->> 'website')::boolean, false) is not true then
    raise exception '% isn''t available on the website right now.', v_inv.card_name using errcode = 'GC056';
  end if;
  return new;
end;
$$;
drop trigger if exists order_item_consigned on public.order_items;
create trigger order_item_consigned before insert on public.order_items
  for each row execute function public.tg_order_item_consigned();

-- ============================================================ lot history: more events

alter table public.consignment_lot_events drop constraint if exists consignment_lot_events_event_check;
alter table public.consignment_lot_events add constraint consignment_lot_events_event_check
  check (event in ('received', 'inspection_started', 'accepted', 'rejected', 'reopened',
                   'listed', 'unlisted', 'price_changed', 'sold', 'sale_cancelled'));

-- ============================================================ payouts and sales

create table if not exists public.consignment_payouts (
  id uuid primary key default gen_random_uuid(),
  consignment_id uuid not null references public.consignments(id) on delete restrict,
  amount_cents integer not null check (amount_cents >= 0),
  sale_count integer not null check (sale_count >= 1),
  method text not null check (method in ('paypal', 'venmo', 'zelle', 'check', 'ach', 'store_credit')),
  reference text check (reference is null or char_length(reference) <= 200),
  paid_at timestamptz not null,
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  created_by text,
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 500),
  voided_by text,
  constraint consignment_payouts_void_reason check ((voided_at is null) = (void_reason is null))
);
create index if not exists consignment_payouts_consignment_idx on public.consignment_payouts (consignment_id, paid_at desc);
comment on table public.consignment_payouts is
  'Money paid to a consignor (outside the site) for settled sales. Written only by consignment_record_payout / consignment_void_payout.';

create table if not exists public.consignment_sales (
  id uuid primary key default gen_random_uuid(),
  consignment_id uuid not null references public.consignments(id) on delete restrict,
  lot_id uuid not null references public.consignment_lots(id) on delete restrict,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  channel text not null check (channel in ('website', 'tcgplayer', 'ebay')),
  order_id uuid references public.orders(id) on delete restrict,
  order_item_id uuid unique references public.order_items(id) on delete restrict,
  external_order_ref text check (external_order_ref is null or char_length(external_order_ref) <= 100),
  quantity integer not null check (quantity between 1 and 9999),
  -- The Final Selling Price of one card.
  unit_price_cents integer not null check (unit_price_cents > 0),
  gross_cents integer generated always as (unit_price_cents * quantity) stored,
  sold_at timestamptz not null,
  shipped_at timestamptz,
  delivered_at timestamptz,
  inspection_days integer not null default 3 check (inspection_days between 0 and 60),
  -- delivered_at + inspection_days: the earliest the sale can be settled and paid.
  payable_at timestamptz,
  status text not null default 'open' check (status in ('open', 'settled', 'paid', 'cancelled')),
  -- The consignor's commission tiers from their signed agreement.
  commission_tiers jsonb not null,
  -- Actual Transaction Expenses for the whole line, confirmed at settlement.
  marketplace_fee_cents integer check (marketplace_fee_cents >= 0),
  processing_fee_cents integer check (processing_fee_cents >= 0),
  postage_cents integer check (postage_cents >= 0),
  insurance_cents integer check (insurance_cents >= 0),
  other_expense_cents integer check (other_expense_cents >= 0),
  other_expense_note text check (other_expense_note is null or char_length(other_expense_note) <= 500),
  -- Computed by consignment_settle_sale.
  net_sale_cents integer check (net_sale_cents >= 0),
  commission_rate_bps integer check (commission_rate_bps between 0 and 10000),
  commission_cents integer check (commission_cents >= 0),
  payout_cents integer check (payout_cents >= 0),
  settlement_detail jsonb,
  settled_at timestamptz,
  settled_by text,
  payout_id uuid references public.consignment_payouts(id) on delete restrict,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  restocked boolean not null default false,
  -- Something staff must look at (e.g. an order refunded after its payout).
  flag text check (flag is null or char_length(flag) <= 500),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by text,
  constraint consignment_sales_source check (
    (channel = 'website' and order_item_id is not null and order_id is not null)
    or (channel <> 'website' and order_item_id is null and external_order_ref is not null)),
  constraint consignment_sales_settled check (
    status not in ('settled', 'paid') or (net_sale_cents is not null and commission_cents is not null and payout_cents is not null and settled_at is not null)),
  constraint consignment_sales_paid check ((status = 'paid') = (payout_id is not null)),
  constraint consignment_sales_cancelled check ((status = 'cancelled') = (cancelled_at is not null))
);
create index if not exists consignment_sales_consignment_idx on public.consignment_sales (consignment_id, sold_at desc);
create index if not exists consignment_sales_lot_idx on public.consignment_sales (lot_id);
create index if not exists consignment_sales_order_idx on public.consignment_sales (order_id);
create index if not exists consignment_sales_payout_idx on public.consignment_sales (payout_id);
comment on table public.consignment_sales is
  'Each consigned card line sold: website orders (recorded when paid) and TCGplayer/eBay sales (recorded by staff). Settled after delivery and the inspection period; paid through consignment_payouts.';

-- Sales and payouts change only through the functions below.
create or replace function public.tg_consignment_ledger_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if coalesce(current_setting('geega.consignment_write', true), '') <> 'on' then
    raise exception 'Consignment sales and payouts are changed only through Consignments.' using errcode = 'GC057';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Consignment sales and payouts are never deleted. Cancel or void them instead.' using errcode = 'GC057';
  end if;
  return new;
end;
$$;
drop trigger if exists consignment_sales_guard on public.consignment_sales;
create trigger consignment_sales_guard before insert or update or delete on public.consignment_sales
  for each row execute function public.tg_consignment_ledger_guard();
drop trigger if exists consignment_payouts_guard on public.consignment_payouts;
create trigger consignment_payouts_guard before insert or update or delete on public.consignment_payouts
  for each row execute function public.tg_consignment_ledger_guard();

alter table public.consignment_sales enable row level security;
alter table public.consignment_payouts enable row level security;
revoke all on public.consignment_sales, public.consignment_payouts from anon, authenticated;
grant select on public.consignment_sales, public.consignment_payouts to authenticated;
drop policy if exists consignment_sales_staff_read on public.consignment_sales;
create policy consignment_sales_staff_read on public.consignment_sales for select to authenticated using (public.is_staff());
drop policy if exists consignment_payouts_staff_read on public.consignment_payouts;
create policy consignment_payouts_staff_read on public.consignment_payouts for select to authenticated using (public.is_staff());

-- ============================================================ lot quantities

-- Where a lot's accepted copies are: on sale on the website, in an unpaid
-- checkout, sold (not cancelled), or still unlisted.
create or replace function public.consignment_lot_quantities(p_lot_id uuid)
returns table(accepted integer, on_sale integer, pending integer, sold integer, unlisted integer)
language sql
stable
security definer
set search_path to ''
as $$
  with l as (select * from public.consignment_lots where id = p_lot_id),
  inv as (select coalesce(sum(i.quantity), 0)::int as q from public.inventory_items i where i.consignment_lot_id = p_lot_id),
  pend as (
    select coalesce(sum(oi.quantity), 0)::int as q
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.inventory_items i on i.id = oi.inventory_item_id
    where i.consignment_lot_id = p_lot_id and o.status = 'pending_payment' and o.payment_status <> 'paid'),
  s as (select coalesce(sum(cs.quantity), 0)::int as q from public.consignment_sales cs where cs.lot_id = p_lot_id and cs.status <> 'cancelled')
  select l.quantity_accepted, inv.q, pend.q, s.q, greatest(l.quantity_accepted - inv.q - pend.q - s.q, 0)
  from l, inv, pend, s;
$$;

-- The same for every accepted lot of a consignment (Consignments > Cards).
create or replace function public.consignment_lot_quantities_all(p_consignment_id uuid)
returns table(lot_id uuid, accepted integer, on_sale integer, pending integer, sold integer, unlisted integer)
language sql
stable
security definer
set search_path to ''
as $$
  select l.id, q.accepted, q.on_sale, q.pending, q.sold, q.unlisted
  from public.consignment_lots l
  cross join lateral public.consignment_lot_quantities(l.id) q
  where l.consignment_id = p_consignment_id and l.status in ('accepted', 'listed', 'sold');
$$;

-- A lot that's been accepted is 'listed' while any copy is on the website,
-- 'sold' once every accepted copy is sold, otherwise 'accepted'.
create or replace function public.consignment_refresh_lot_status(p_lot_id uuid, p_actor text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  l public.consignment_lots%rowtype;
  q record;
  v_to text;
begin
  select * into l from public.consignment_lots where id = p_lot_id for update;
  if not found or l.status not in ('accepted', 'listed', 'sold') then
    return l.status;
  end if;
  select * into q from public.consignment_lot_quantities(p_lot_id);
  v_to := case when q.sold >= q.accepted and q.accepted > 0 then 'sold'
               when q.on_sale + q.pending > 0 then 'listed'
               else 'accepted' end;
  if v_to <> l.status then
    perform set_config('geega.consignment_write', 'on', true);
    update public.consignment_lots set status = v_to where id = l.id;
  end if;
  return v_to;
end;
$$;

-- The consignor's terms from their signed agreement.
create or replace function public.consignment_signed_terms(p_consignment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select a.terms_snapshot from public.consignment_agreements a
  where a.consignment_id = p_consignment_id and a.status = 'signed'
  order by a.signed_at desc limit 1;
$$;

-- ============================================================ listing

-- Put accepted copies on sale on the website (or add more), at the list
-- price (p_price_cents, or the lot's list price), never below the minimum.
create or replace function public.consignment_list_lot(p_lot_id uuid, p_quantity integer, p_price_cents integer, p_actor text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  l public.consignment_lots%rowtype;
  c public.consignments%rowtype;
  q record;
  v_price integer;
  v_inv uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into l from public.consignment_lots where id = p_lot_id for update;
  if not found then
    raise exception 'That card line isn''t there.' using errcode = 'GC041';
  end if;
  if l.status not in ('accepted', 'listed') then
    raise exception 'Only accepted cards can be listed.' using errcode = 'GC044';
  end if;
  select * into c from public.consignments where id = l.consignment_id for update;
  if c.status not in ('signed', 'inventory_received', 'active') then
    raise exception 'This consignment isn''t active, so its cards can''t be listed.' using errcode = 'GC044';
  end if;
  if coalesce((public.consignment_current_elections(c.id) -> 'channels' ->> 'website')::boolean, false) is not true then
    raise exception 'The consignor didn''t approve website sales. Sell on a channel they approved and record the sale.' using errcode = 'GC060';
  end if;
  v_price := coalesce(p_price_cents, l.list_price_cents);
  if v_price is null or v_price <= 0 then
    raise exception 'Enter a list price.' using errcode = 'GC045';
  end if;
  if l.min_price_cents is not null and v_price < l.min_price_cents then
    raise exception 'The price can''t be below the consignor''s minimum of $%.', to_char(l.min_price_cents / 100.0, 'FM999990.00') using errcode = 'GC051';
  end if;
  select * into q from public.consignment_lot_quantities(l.id);
  if p_quantity is null or p_quantity < 1 or p_quantity > q.unlisted then
    raise exception 'You can list up to % more of this card.', q.unlisted using errcode = 'GC061';
  end if;

  perform set_config('geega.consignment_write', 'on', true);
  if v_price is distinct from l.list_price_cents then
    update public.consignment_lots set list_price_cents = v_price where id = l.id;
  end if;

  select i.id into v_inv from public.inventory_items i where i.consignment_lot_id = l.id order by i.created_at limit 1 for update;
  if v_inv is null then
    insert into public.inventory_items (
      scryfall_id, oracle_id, card_name, set_code, set_name, collector_number, rarity, image_url,
      condition, finish, variant_type, language, quantity, price_cents, scryfall_price_cents, status,
      ownership, consignment_lot_id, notes
    ) values (
      l.scryfall_id, l.oracle_id, l.card_name, l.set_code, l.set_name, l.collector_number, l.rarity, l.image_url,
      l.condition, l.finish, l.variant_type, l.language, p_quantity, v_price, l.market_price_cents, 'active',
      'consigned', l.id, 'Consigned: GG-C-' || c.consignment_number
    ) returning id into v_inv;
  else
    update public.inventory_items
      set quantity = quantity + p_quantity, price_cents = v_price, status = 'active'
      where id = v_inv;
  end if;

  insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
  values (l.id, c.id, 'listed', l.status, 'listed', jsonb_build_object('quantity', p_quantity, 'priceCents', v_price, 'channel', 'website'), p_actor);
  update public.consignment_lots set status = 'listed' where id = l.id;

  -- The term starts when accepted cards are first posted (agreement 6.1).
  if c.term_started_at is null or c.status <> 'active' then
    update public.consignments set status = 'active', term_started_at = coalesce(term_started_at, now()) where id = c.id;
  end if;
  perform set_config('geega.consignment_write', '', true);
  return v_inv;
end;
$$;

-- Take copies off the website (they stay accepted, unlisted).
create or replace function public.consignment_unlist_lot(p_lot_id uuid, p_quantity integer, p_actor text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  l public.consignment_lots%rowtype;
  v_inv public.inventory_items%rowtype;
  v_reserved integer;
  v_free integer;
  v_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into l from public.consignment_lots where id = p_lot_id for update;
  if not found then
    raise exception 'That card line isn''t there.' using errcode = 'GC041';
  end if;
  select * into v_inv from public.inventory_items where consignment_lot_id = l.id order by created_at limit 1 for update;
  select coalesce(sum(r.quantity), 0)::int into v_reserved from public.inventory_reservations r
    where r.inventory_item_id = v_inv.id and r.status = 'active';
  v_free := greatest(coalesce(v_inv.quantity, 0) - coalesce(v_reserved, 0), 0);
  if p_quantity is null or p_quantity < 1 or p_quantity > v_free then
    raise exception 'You can take up to % off sale right now.', v_free using errcode = 'GC061';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  update public.inventory_items set quantity = quantity - p_quantity where id = v_inv.id;
  insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
  values (l.id, l.consignment_id, 'unlisted', l.status, l.status, jsonb_build_object('quantity', p_quantity), p_actor);
  v_status := public.consignment_refresh_lot_status(l.id, p_actor);
  perform set_config('geega.consignment_write', '', true);
  return v_status;
end;
$$;

-- Change the list price (never below the minimum); the website copy follows.
create or replace function public.consignment_set_lot_price(p_lot_id uuid, p_price_cents integer, p_actor text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  l public.consignment_lots%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into l from public.consignment_lots where id = p_lot_id for update;
  if not found then
    raise exception 'That card line isn''t there.' using errcode = 'GC041';
  end if;
  if l.status not in ('accepted', 'listed') then
    raise exception 'Only accepted or listed cards can be repriced.' using errcode = 'GC044';
  end if;
  if p_price_cents is null or p_price_cents <= 0 then
    raise exception 'Enter a list price.' using errcode = 'GC045';
  end if;
  if l.min_price_cents is not null and p_price_cents < l.min_price_cents then
    raise exception 'The price can''t be below the consignor''s minimum of $%.', to_char(l.min_price_cents / 100.0, 'FM999990.00') using errcode = 'GC051';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_lots set list_price_cents = p_price_cents where id = l.id;
  update public.inventory_items set price_cents = p_price_cents where consignment_lot_id = l.id;
  insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
  values (l.id, l.consignment_id, 'price_changed', l.status, l.status,
          jsonb_build_object('fromCents', l.list_price_cents, 'toCents', p_price_cents), p_actor);
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- ============================================================ sales

-- TCGplayer or eBay: staff record a sale with its actual fees. Copies come
-- from the unlisted ones first, then off the website.
create or replace function public.consignment_record_external_sale(
  p_lot_id uuid,
  p_channel text,
  p_quantity integer,
  p_unit_price_cents integer,
  p_sold_at timestamptz,
  p_external_ref text,
  p_marketplace_fee_cents integer,
  p_processing_fee_cents integer,
  p_postage_cents integer,
  p_notes text,
  p_actor text
) returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  l public.consignment_lots%rowtype;
  q record;
  v_terms jsonb;
  v_inv public.inventory_items%rowtype;
  v_reserved integer;
  v_from_site integer;
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_channel not in ('tcgplayer', 'ebay') then
    raise exception 'Choose TCGplayer or eBay. Website sales are recorded from orders.' using errcode = 'GC045';
  end if;
  select * into l from public.consignment_lots where id = p_lot_id for update;
  if not found then
    raise exception 'That card line isn''t there.' using errcode = 'GC041';
  end if;
  if l.status not in ('accepted', 'listed') then
    raise exception 'Only accepted cards can be sold.' using errcode = 'GC044';
  end if;
  if coalesce((public.consignment_current_elections(l.consignment_id) -> 'channels' ->> p_channel)::boolean, false) is not true then
    raise exception 'The consignor didn''t approve % sales.', case p_channel when 'tcgplayer' then 'TCGplayer' else 'eBay' end using errcode = 'GC060';
  end if;
  if p_unit_price_cents is null or p_unit_price_cents <= 0 then
    raise exception 'Enter what each card sold for.' using errcode = 'GC045';
  end if;
  if l.min_price_cents is not null and p_unit_price_cents < l.min_price_cents then
    raise exception 'That''s below the consignor''s minimum of $%.', to_char(l.min_price_cents / 100.0, 'FM999990.00') using errcode = 'GC051';
  end if;
  if coalesce(btrim(p_external_ref), '') = '' then
    raise exception 'Enter the marketplace order number.' using errcode = 'GC045';
  end if;
  if p_sold_at is null or p_sold_at > now() + interval '1 day' then
    raise exception 'Enter when it sold.' using errcode = 'GC045';
  end if;
  if coalesce(p_marketplace_fee_cents, 0) < 0 or coalesce(p_processing_fee_cents, 0) < 0 or coalesce(p_postage_cents, 0) < 0 then
    raise exception 'Fees can''t be negative.' using errcode = 'GC045';
  end if;

  select * into q from public.consignment_lot_quantities(l.id);
  select * into v_inv from public.inventory_items where consignment_lot_id = l.id order by created_at limit 1 for update;
  select coalesce(sum(r.quantity), 0)::int into v_reserved from public.inventory_reservations r
    where r.inventory_item_id = v_inv.id and r.status = 'active';
  if p_quantity is null or p_quantity < 1
     or p_quantity > q.unlisted + greatest(coalesce(v_inv.quantity, 0) - coalesce(v_reserved, 0), 0) then
    raise exception 'Only % of this card can be sold right now.', q.unlisted + greatest(coalesce(v_inv.quantity, 0) - coalesce(v_reserved, 0), 0) using errcode = 'GC061';
  end if;
  v_from_site := greatest(p_quantity - q.unlisted, 0);

  v_terms := public.consignment_signed_terms(l.consignment_id);
  if v_terms is null then
    raise exception 'This consignment has no signed agreement.' using errcode = 'GC042';
  end if;

  perform set_config('geega.consignment_write', 'on', true);
  if v_from_site > 0 then
    update public.inventory_items set quantity = quantity - v_from_site where id = v_inv.id;
  end if;
  insert into public.consignment_sales (
    consignment_id, lot_id, inventory_item_id, channel, external_order_ref, quantity, unit_price_cents, sold_at,
    inspection_days, commission_tiers, marketplace_fee_cents, processing_fee_cents, postage_cents, notes, created_by
  ) values (
    l.consignment_id, l.id, v_inv.id, p_channel, btrim(p_external_ref), p_quantity, p_unit_price_cents, p_sold_at,
    coalesce((v_terms ->> 'inspectionDays')::int, 3), v_terms -> 'commissionTiers',
    coalesce(p_marketplace_fee_cents, 0), coalesce(p_processing_fee_cents, 0), coalesce(p_postage_cents, 0),
    nullif(btrim(p_notes), ''), p_actor
  ) returning id into v_id;
  insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
  values (l.id, l.consignment_id, 'sold', l.status, l.status,
          jsonb_build_object('channel', p_channel, 'quantity', p_quantity, 'unitPriceCents', p_unit_price_cents, 'saleId', v_id, 'orderRef', btrim(p_external_ref)), p_actor);
  perform public.consignment_refresh_lot_status(l.id, p_actor);
  perform set_config('geega.consignment_write', '', true);
  return v_id;
end;
$$;

-- When a sale reached the buyer (marketplace sales, or website orders whose
-- delivery wasn't tracked). The inspection period runs from here.
create or replace function public.consignment_mark_sale_delivered(p_sale_id uuid, p_delivered_at timestamptz, p_actor text)
returns timestamptz
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.consignment_sales%rowtype;
  v_payable timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into s from public.consignment_sales where id = p_sale_id for update;
  if not found then
    raise exception 'That sale isn''t there.' using errcode = 'GC062';
  end if;
  if s.status <> 'open' then
    raise exception 'Only open sales can be changed.' using errcode = 'GC063';
  end if;
  if p_delivered_at is null or p_delivered_at < s.sold_at or p_delivered_at > now() + interval '1 hour' then
    raise exception 'Delivery must be after the sale and not in the future.' using errcode = 'GC045';
  end if;
  v_payable := p_delivered_at + make_interval(days => s.inspection_days);
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_sales
    set delivered_at = p_delivered_at, payable_at = v_payable,
        notes = concat_ws(E'\n', notes, 'Delivery recorded by ' || coalesce(p_actor, 'staff') || '.')
    where id = s.id;
  perform set_config('geega.consignment_write', '', true);
  return v_payable;
end;
$$;

-- Confirm a sale's actual expenses once the inspection period is over. The
-- database works out the rest (agreement 4.1-4.6):
--   Net Sale Amount = Final Selling Price x quantity - expenses (never below 0)
--   Commission      = rate for one card's Final Selling Price x Net Sale Amount
--   Payout          = Net Sale Amount - Commission
create or replace function public.consignment_settle_sale(
  p_sale_id uuid,
  p_marketplace_fee_cents integer,
  p_processing_fee_cents integer,
  p_postage_cents integer,
  p_insurance_cents integer,
  p_other_expense_cents integer,
  p_other_expense_note text,
  p_detail jsonb,
  p_actor text
) returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.consignment_sales%rowtype;
  v_expenses bigint;
  v_net integer;
  v_rate integer;
  v_commission integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into s from public.consignment_sales where id = p_sale_id for update;
  if not found then
    raise exception 'That sale isn''t there.' using errcode = 'GC062';
  end if;
  if s.status <> 'open' then
    raise exception 'Only open sales can be settled.' using errcode = 'GC063';
  end if;
  if s.delivered_at is null or s.payable_at is null then
    raise exception 'Record delivery first. The buyer''s inspection period starts when the card is delivered.' using errcode = 'GC064';
  end if;
  if now() < s.payable_at then
    raise exception 'The buyer''s inspection period ends %.', to_char(s.payable_at at time zone 'America/Chicago', 'Mon FMDD at FMHH12:MI AM') using errcode = 'GC064';
  end if;
  if least(coalesce(p_marketplace_fee_cents, 0), coalesce(p_processing_fee_cents, 0), coalesce(p_postage_cents, 0),
           coalesce(p_insurance_cents, 0), coalesce(p_other_expense_cents, 0)) < 0 then
    raise exception 'Expenses can''t be negative.' using errcode = 'GC045';
  end if;
  if coalesce(p_other_expense_cents, 0) > 0 and coalesce(btrim(p_other_expense_note), '') = '' then
    raise exception 'Say what the other expense is (it must be one the consignor approved in writing).' using errcode = 'GC045';
  end if;

  v_expenses := coalesce(p_marketplace_fee_cents, 0)::bigint + coalesce(p_processing_fee_cents, 0) + coalesce(p_postage_cents, 0)
              + coalesce(p_insurance_cents, 0) + coalesce(p_other_expense_cents, 0);
  v_net := greatest(s.gross_cents - v_expenses, 0)::int;
  v_rate := public.consignment_commission_rate_bps(s.unit_price_cents, s.commission_tiers);
  v_commission := public.consignment_commission_cents(s.unit_price_cents, v_net, s.commission_tiers);

  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_sales set
    marketplace_fee_cents = coalesce(p_marketplace_fee_cents, 0),
    processing_fee_cents = coalesce(p_processing_fee_cents, 0),
    postage_cents = coalesce(p_postage_cents, 0),
    insurance_cents = coalesce(p_insurance_cents, 0),
    other_expense_cents = coalesce(p_other_expense_cents, 0),
    other_expense_note = nullif(btrim(p_other_expense_note), ''),
    net_sale_cents = v_net,
    commission_rate_bps = v_rate,
    commission_cents = v_commission,
    payout_cents = v_net - v_commission,
    settlement_detail = p_detail,
    settled_at = now(),
    settled_by = p_actor,
    status = 'settled'
  where id = s.id;
  perform set_config('geega.consignment_write', '', true);
  return v_net - v_commission;
end;
$$;

-- Undo a settlement (not yet paid) to correct it.
create or replace function public.consignment_unsettle_sale(p_sale_id uuid, p_actor text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.consignment_sales%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into s from public.consignment_sales where id = p_sale_id for update;
  if not found then
    raise exception 'That sale isn''t there.' using errcode = 'GC062';
  end if;
  if s.status <> 'settled' then
    raise exception 'Only settled, unpaid sales can be reopened.' using errcode = 'GC063';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_sales set
    status = 'open', net_sale_cents = null, commission_rate_bps = null, commission_cents = null, payout_cents = null,
    settled_at = null, settled_by = null,
    notes = concat_ws(E'\n', notes, 'Settlement reopened by ' || coalesce(p_actor, 'staff') || ' on ' || to_char(now() at time zone 'America/Chicago', 'YYYY-MM-DD') || '.')
  where id = s.id;
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- Cancel a TCGplayer or eBay sale that fell through (website sales follow
-- their order). The copies go back to the consignor's unlisted stock.
create or replace function public.consignment_cancel_sale(p_sale_id uuid, p_reason text, p_actor text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.consignment_sales%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into s from public.consignment_sales where id = p_sale_id for update;
  if not found then
    raise exception 'That sale isn''t there.' using errcode = 'GC062';
  end if;
  if s.channel = 'website' then
    raise exception 'Website sales follow their order. Cancel or refund the order instead.' using errcode = 'GC063';
  end if;
  if s.status not in ('open', 'settled') then
    raise exception 'Only open or settled, unpaid sales can be cancelled.' using errcode = 'GC063';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the sale is cancelled.' using errcode = 'GC045';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_sales set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason),
    net_sale_cents = null, commission_rate_bps = null, commission_cents = null, payout_cents = null, settled_at = null, settled_by = null
  where id = s.id;
  insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
  select s.lot_id, s.consignment_id, 'sale_cancelled', l.status, l.status, jsonb_build_object('saleId', s.id, 'reason', btrim(p_reason)), p_actor
  from public.consignment_lots l where l.id = s.lot_id;
  perform public.consignment_refresh_lot_status(s.lot_id, p_actor);
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- ============================================================ website orders -> sales

-- Keeps website sales in step with their orders:
--   paid                  a sale for each consigned line (commission tiers and
--                         inspection period from the signed agreement)
--   shipped / delivered   copied to the sales; delivery starts the inspection period
--   cancelled / refunded  open and settled sales are cancelled; copies that
--                         never shipped go back on sale. A sale already paid
--                         out is flagged for staff instead.
create or replace function public.tg_consignment_order_sync()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  oi record;
  s record;
  v_terms jsonb;
  v_lots uuid[] := '{}';
  v_lot uuid;
  v_cancel boolean;
begin
  if new.channel is distinct from 'online' then
    return new;
  end if;
  v_cancel := new.status in ('cancelled', 'refunded') and old.status not in ('cancelled', 'refunded');

  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' and new.status not in ('cancelled', 'refunded') then
    for oi in
      select o_i.id, o_i.quantity, o_i.unit_price_cents, i.id as inv_id, i.consignment_lot_id, l.consignment_id
      from public.order_items o_i
      join public.inventory_items i on i.id = o_i.inventory_item_id
      join public.consignment_lots l on l.id = i.consignment_lot_id
      where o_i.order_id = new.id and i.ownership = 'consigned'
    loop
      v_terms := public.consignment_signed_terms(oi.consignment_id);
      perform set_config('geega.consignment_write', 'on', true);
      insert into public.consignment_sales (
        consignment_id, lot_id, inventory_item_id, channel, order_id, order_item_id, quantity, unit_price_cents,
        sold_at, inspection_days, commission_tiers, created_by
      ) values (
        oi.consignment_id, oi.consignment_lot_id, oi.inv_id, 'website', new.id, oi.id, oi.quantity, oi.unit_price_cents,
        coalesce(new.paid_at, now()), coalesce((v_terms ->> 'inspectionDays')::int, 3),
        coalesce(v_terms -> 'commissionTiers', '[{"maxPriceCents": 15000, "rateBps": 2000}, {"maxPriceCents": null, "rateBps": 1000}]'::jsonb),
        'website order'
      ) on conflict (order_item_id) do nothing;
      insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
      select l.id, l.consignment_id, 'sold', l.status, l.status,
             jsonb_build_object('channel', 'website', 'quantity', oi.quantity, 'unitPriceCents', oi.unit_price_cents, 'orderId', new.id), 'website order'
      from public.consignment_lots l where l.id = oi.consignment_lot_id;
      v_lots := array_append(v_lots, oi.consignment_lot_id);
    end loop;
  end if;

  if new.shipped_at is distinct from old.shipped_at then
    perform set_config('geega.consignment_write', 'on', true);
    update public.consignment_sales set shipped_at = new.shipped_at where order_id = new.id and status = 'open';
  end if;

  if new.delivered_at is not null and new.delivered_at is distinct from old.delivered_at and not v_cancel then
    perform set_config('geega.consignment_write', 'on', true);
    update public.consignment_sales
      set delivered_at = new.delivered_at, payable_at = new.delivered_at + make_interval(days => inspection_days)
      where order_id = new.id and status = 'open';
  end if;

  if v_cancel then
    for s in select * from public.consignment_sales where order_id = new.id and status <> 'cancelled' for update loop
      perform set_config('geega.consignment_write', 'on', true);
      if s.status = 'paid' then
        update public.consignment_sales
          set flag = 'Order ' || new.status::text || ' after this sale was paid out. Recover or adjust the payout by hand.'
          where id = s.id;
      else
        update public.consignment_sales set
          status = 'cancelled', cancelled_at = now(), cancel_reason = 'Order ' || new.status::text,
          net_sale_cents = null, commission_rate_bps = null, commission_cents = null, payout_cents = null, settled_at = null, settled_by = null,
          restocked = (new.shipped_at is null and s.inventory_item_id is not null)
        where id = s.id;
        if new.shipped_at is null and s.inventory_item_id is not null then
          update public.inventory_items set quantity = quantity + s.quantity where id = s.inventory_item_id;
        end if;
        insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
        select l.id, l.consignment_id, 'sale_cancelled', l.status, l.status,
               jsonb_build_object('saleId', s.id, 'orderId', new.id, 'restocked', new.shipped_at is null), 'website order'
        from public.consignment_lots l where l.id = s.lot_id;
        v_lots := array_append(v_lots, s.lot_id);
      end if;
    end loop;
  end if;

  foreach v_lot in array v_lots loop
    perform public.consignment_refresh_lot_status(v_lot, 'website order');
  end loop;
  perform set_config('geega.consignment_write', '', true);
  return new;
end;
$$;
drop trigger if exists consignment_order_sync on public.orders;
create trigger consignment_order_sync after update on public.orders
  for each row execute function public.tg_consignment_order_sync();

-- ============================================================ payouts

-- Record money paid to the consignor for settled sales of one consignment.
create or replace function public.consignment_record_payout(
  p_consignment_id uuid,
  p_sale_ids uuid[],
  p_method text,
  p_reference text,
  p_paid_at timestamptz,
  p_note text,
  p_actor text
) returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_methods text[];
  v_count integer;
  v_amount bigint;
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_sale_ids is null or cardinality(p_sale_ids) = 0 then
    raise exception 'Choose the sales this payout covers.' using errcode = 'GC045';
  end if;
  select payout_methods into v_methods from public.consignment_settings where id;
  if p_method is null or not (p_method = any(coalesce(v_methods, '{}'))) then
    raise exception 'Choose a payout method you offer.' using errcode = 'GC045';
  end if;
  if p_paid_at is null or p_paid_at > now() + interval '1 day' then
    raise exception 'Enter when it was paid.' using errcode = 'GC045';
  end if;
  perform 1 from public.consignment_sales where id = any(p_sale_ids) for update;
  select count(*), coalesce(sum(payout_cents), 0) into v_count, v_amount
  from public.consignment_sales
  where id = any(p_sale_ids) and consignment_id = p_consignment_id and status = 'settled';
  if v_count <> cardinality(array(select distinct unnest(p_sale_ids))) then
    raise exception 'Every sale in a payout must be settled, unpaid and from this consignment.' using errcode = 'GC065';
  end if;

  perform set_config('geega.consignment_write', 'on', true);
  insert into public.consignment_payouts (consignment_id, amount_cents, sale_count, method, reference, paid_at, note, created_by)
  values (p_consignment_id, v_amount, v_count, p_method, nullif(btrim(p_reference), ''), p_paid_at, nullif(btrim(p_note), ''), p_actor)
  returning id into v_id;
  update public.consignment_sales set status = 'paid', payout_id = v_id where id = any(p_sale_ids);
  perform set_config('geega.consignment_write', '', true);
  return v_id;
end;
$$;

-- A payout recorded by mistake: kept, marked void, and its sales go back to settled.
create or replace function public.consignment_void_payout(p_payout_id uuid, p_reason text, p_actor text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  p public.consignment_payouts%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into p from public.consignment_payouts where id = p_payout_id for update;
  if not found then
    raise exception 'That payout isn''t there.' using errcode = 'GC066';
  end if;
  if p.voided_at is not null then
    raise exception 'That payout is already void.' using errcode = 'GC066';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the payout is void.' using errcode = 'GC045';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_payouts set voided_at = now(), void_reason = btrim(p_reason), voided_by = p_actor where id = p.id;
  update public.consignment_sales set status = 'settled', payout_id = null where payout_id = p.id;
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- ============================================================ grants

revoke all on function public.consignment_lot_quantities(uuid) from public, anon, authenticated;
revoke all on function public.consignment_lot_quantities_all(uuid) from public, anon, authenticated;
revoke all on function public.consignment_refresh_lot_status(uuid, text) from public, anon, authenticated;
revoke all on function public.consignment_signed_terms(uuid) from public, anon, authenticated;
revoke all on function public.consignment_list_lot(uuid, integer, integer, text) from public, anon, authenticated;
revoke all on function public.consignment_unlist_lot(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.consignment_set_lot_price(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.consignment_record_external_sale(uuid, text, integer, integer, timestamptz, text, integer, integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.consignment_mark_sale_delivered(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.consignment_settle_sale(uuid, integer, integer, integer, integer, integer, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.consignment_unsettle_sale(uuid, text) from public, anon, authenticated;
revoke all on function public.consignment_cancel_sale(uuid, text, text) from public, anon, authenticated;
revoke all on function public.consignment_record_payout(uuid, uuid[], text, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.consignment_void_payout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.consignment_lot_quantities(uuid) to service_role;
grant execute on function public.consignment_lot_quantities_all(uuid) to service_role;
grant execute on function public.consignment_refresh_lot_status(uuid, text) to service_role;
grant execute on function public.consignment_signed_terms(uuid) to service_role;
grant execute on function public.consignment_list_lot(uuid, integer, integer, text) to service_role;
grant execute on function public.consignment_unlist_lot(uuid, integer, text) to service_role;
grant execute on function public.consignment_set_lot_price(uuid, integer, text) to service_role;
grant execute on function public.consignment_record_external_sale(uuid, text, integer, integer, timestamptz, text, integer, integer, integer, text, text) to service_role;
grant execute on function public.consignment_mark_sale_delivered(uuid, timestamptz, text) to service_role;
grant execute on function public.consignment_settle_sale(uuid, integer, integer, integer, integer, integer, text, jsonb, text) to service_role;
grant execute on function public.consignment_unsettle_sale(uuid, text) to service_role;
grant execute on function public.consignment_cancel_sale(uuid, text, text) to service_role;
grant execute on function public.consignment_record_payout(uuid, uuid[], text, text, timestamptz, text, text) to service_role;
grant execute on function public.consignment_void_payout(uuid, text, text) to service_role;
revoke all on function public.tg_consignment_order_sync() from public, anon, authenticated;

-- ============================================================ the consignor's view: sales and payouts

-- As in 20261028180000, plus each consignment's sales (with the settlement
-- once it's final) and payouts. Order numbers, buyers and staff notes are
-- never included.
create or replace function public.my_consignments()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'consignmentNumber', c.consignment_number,
    'status', c.status,
    'signedAt', c.signed_at,
    'termStartedAt', c.term_started_at,
    'initialTermDays', c.initial_term_days,
    'elections', public.consignment_current_elections(c.id),
    'agreements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'status', a.status,
        'versionNumber', v.version_number,
        'invitedAt', a.invited_at,
        'expiresAt', a.invite_expires_at,
        'signedAt', a.signed_at,
        'agreementSha256', a.rendered_sha256,
        'hasPdf', s.pdf_path is not null,
        'pdfSha256', s.pdf_sha256,
        'terms', a.terms_snapshot
      ) order by a.created_at desc)
      from public.consignment_agreements a
      join public.consignment_agreement_versions v on v.id = a.version_id
      left join public.consignment_signatures s on s.agreement_id = a.id
      where a.consignment_id = c.id and a.status <> 'void'), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'cardName', l.card_name,
        'setCode', l.set_code,
        'setName', l.set_name,
        'collectorNumber', l.collector_number,
        'finish', l.finish,
        'imageUrl', l.image_url,
        'status', l.status,
        'quantitySubmitted', l.quantity_submitted,
        'quantityAccepted', l.quantity_accepted,
        'quantityRejected', l.quantity_rejected,
        'declaredCondition', l.declared_condition,
        'condition', l.condition,
        'listPriceCents', case when l.status in ('accepted', 'listed', 'reserved_for_sale', 'sold') then l.list_price_cents end,
        'minPriceCents', case when l.status in ('accepted', 'listed', 'reserved_for_sale', 'sold') then l.min_price_cents end,
        'rejectionReason', l.rejection_reason,
        'receivedAt', b.received_at
      ) order by b.batch_number, l.card_name)
      from public.consignment_lots l
      left join public.consignment_receiving_batches b on b.id = l.batch_id
      where l.consignment_id = c.id), '[]'::jsonb),
    'sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cs.id,
        'cardName', l.card_name,
        'setCode', l.set_code,
        'collectorNumber', l.collector_number,
        'channel', cs.channel,
        'quantity', cs.quantity,
        'unitPriceCents', cs.unit_price_cents,
        'grossCents', cs.gross_cents,
        'soldAt', cs.sold_at,
        'shippedAt', cs.shipped_at,
        'deliveredAt', cs.delivered_at,
        'payableAt', cs.payable_at,
        'status', cs.status,
        'cancelReason', case when cs.status = 'cancelled' then cs.cancel_reason end,
        'settlement', case when cs.status in ('settled', 'paid') then jsonb_build_object(
          'marketplaceFeeCents', cs.marketplace_fee_cents,
          'processingFeeCents', cs.processing_fee_cents,
          'postageCents', cs.postage_cents,
          'insuranceCents', cs.insurance_cents,
          'otherExpenseCents', cs.other_expense_cents,
          'otherExpenseNote', cs.other_expense_note,
          'netSaleCents', cs.net_sale_cents,
          'commissionRateBps', cs.commission_rate_bps,
          'commissionCents', cs.commission_cents,
          'payoutCents', cs.payout_cents,
          'settledAt', cs.settled_at) end,
        'payoutId', cs.payout_id
      ) order by cs.sold_at desc)
      from public.consignment_sales cs
      join public.consignment_lots l on l.id = cs.lot_id
      where cs.consignment_id = c.id), '[]'::jsonb),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'amountCents', p.amount_cents,
        'saleCount', p.sale_count,
        'method', p.method,
        'paidAt', p.paid_at,
        'reference', p.reference,
        'voided', p.voided_at is not null
      ) order by p.paid_at desc)
      from public.consignment_payouts p
      where p.consignment_id = c.id), '[]'::jsonb)
  ) order by c.created_at desc), '[]'::jsonb)
  from public.consignments c
  join public.consignors p on p.id = c.consignor_id
  where p.user_id = auth.uid();
$$;
revoke all on function public.my_consignments() from public, anon;
grant execute on function public.my_consignments() to authenticated, service_role;

-- ============================================================ settings: marketplace buyers pay shipping

-- On TCGplayer and eBay the buyer pays shipping, which covers the postage, so
-- the estimator no longer charges consignors postage on those channels. Only
-- the seeded $0 is changed; a value the owner set is kept.
update public.consignment_settings
set buyer_terms = jsonb_set(jsonb_set(buyer_terms,
      '{tcgplayer,shippingCents}', to_jsonb(default_postage_cents), true),
      '{ebay,shippingCents}', to_jsonb(default_postage_cents), true)
where id
  and coalesce((buyer_terms #>> '{tcgplayer,shippingCents}')::int, 0) = 0
  and coalesce((buyer_terms #>> '{ebay,shippingCents}')::int, 0) = 0;
