-- Yard Sale Mode: at a yard sale, shoppers scan a QR code that opens
-- /yard-sale on their phone. They see the website's in-stock cards at or
-- above a minimum price (with the yard sale discount), tap the ones they
-- want and send the list with just their name. Staff grab the cards; when
-- the shopper is done browsing the tables they pay in person (cash or
-- Venmo, outside the website) and staff tap Complete, which records the
-- sale and takes the cards off the website for good. Online orders are
-- paused while the sale is on.
--
-- Built on the kiosk's pickup lists (20260916090000_kiosk_pickup_requests):
--   * a list is a pickup_requests row and its cards pickup_request_items,
--     each held by an inventory_reservations row, so a held card drops out
--     of every stock count (website, register, kiosk) at once;
--   * a yard sale list also carries yard_sale_id and a pickup number (#1,
--     #2, ... per sale) that the shopper sees on their phone.
--
-- Table
--   yard_sales  one row per sale: the discount, the minimum price, when it
--               ends (online orders reopen by themselves then) and the next
--               pickup number. At most one is open at a time.
--
-- Functions (service role only unless noted)
--   yard_sale_status()         public: whether a sale is on, its discount,
--                              minimum price and end time
--   store_ordering_status()    public, replaced: also paused during a sale,
--                              which pauses both checkout functions (they
--                              already refuse orders while it says paused)
--   yard_sale_start / update / end   the admin's Yard Sale Mode switch
--   yard_sale_create_list      a shopper sends a list (holds the cards)
--   yard_sale_add_to_list      ... and adds more cards to it later
--   pickup_remove_item         staff: take a card (or some copies) off a list
--   yard_sale_complete_list    staff: paid in person, so the cards are sold
--   inventory_live_prices      server: what cards sell for right now
--
-- Prices: a card's website price is what the shop shows and the register
-- charges right now, a storewide sale included (storefront_effective_price,
-- as search_inventory, checkout and kiosk pickups use). Its yard sale price
-- is that less the yard sale discount, rounded to the nearest cent
-- (yard_sale_price). A list's total is the sum of those, so the prices a
-- shopper sees add up to exactly what they're charged. Prices and the
-- discount are the ones in effect when staff tap Complete, so "50% off for
-- the last hour" applies to lists completed in that hour.
--
-- When a sale ends, open lists are left alone: their cards stay held until
-- staff complete or cancel each list. A card someone paid for can't go back
-- on sale just because Complete wasn't tapped.

-- ---------------------------------------------------------------------------
-- yard_sales
-- ---------------------------------------------------------------------------

create table if not exists public.yard_sales (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  ended_at timestamptz,
  discount_percent integer not null default 0 check (discount_percent between 0 and 90),
  min_price_cents integer not null default 300 check (min_price_cents between 0 and 100000),
  next_pickup_number integer not null default 1 check (next_pickup_number between 1 and 1000000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint yard_sales_ends_after_start check (ends_at > started_at),
  constraint yard_sales_ended_after_start check (ended_at is null or ended_at >= started_at)
);

comment on table public.yard_sales is
  'Yard Sale Mode, one row per sale. A sale is on while ended_at is null and now() < ends_at. Written only through yard_sale_start/update/end (service role); staff read it via RLS; the storefront reads yard_sale_status().';
comment on column public.yard_sales.ended_at is
  'Set when staff end the sale early, or (as ends_at) when a sale that ran out on its own is closed by the next start.';
comment on column public.yard_sales.next_pickup_number is
  'The number the next list sent during this sale gets (#1, #2, ...).';

-- At most one sale that hasn't been closed.
create unique index if not exists yard_sales_one_open_idx
  on public.yard_sales ((true)) where ended_at is null;
create index if not exists yard_sales_started_at_idx on public.yard_sales (started_at desc);
create index if not exists yard_sales_created_by_idx on public.yard_sales (created_by);
create index if not exists yard_sales_updated_by_idx on public.yard_sales (updated_by);

drop trigger if exists yard_sales_set_updated_at on public.yard_sales;
create trigger yard_sales_set_updated_at
  before update on public.yard_sales
  for each row execute function public.tg_set_updated_at();

alter table public.yard_sales enable row level security;

drop policy if exists yard_sales_staff_select on public.yard_sales;
create policy yard_sales_staff_select
  on public.yard_sales for select to authenticated
  using ((select public.is_staff()));

revoke all on public.yard_sales from anon, authenticated;
grant select on public.yard_sales to authenticated;

-- ---------------------------------------------------------------------------
-- Pickup lists: the yard sale and pickup number, and one row per card
-- ---------------------------------------------------------------------------

alter table public.pickup_requests
  add column if not exists yard_sale_id uuid references public.yard_sales (id) on delete restrict,
  add column if not exists pickup_number integer;

comment on column public.pickup_requests.yard_sale_id is
  'Set for a list sent from /yard-sale during this yard sale; null for kiosk requests.';
comment on column public.pickup_requests.pickup_number is
  'The yard sale list''s number (#1, #2, ... per sale), shown on the shopper''s phone.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pickup_requests_yard_sale_number') then
    alter table public.pickup_requests
      add constraint pickup_requests_yard_sale_number
      check ((yard_sale_id is null) = (pickup_number is null) and (pickup_number is null or pickup_number >= 1));
  end if;
end$$;

create unique index if not exists pickup_requests_yard_sale_number_idx
  on public.pickup_requests (yard_sale_id, pickup_number) where yard_sale_id is not null;

-- A list holds each card once (adding more copies raises the quantity), so
-- its hold is always exactly one active reservation.
create unique index if not exists pickup_request_items_one_per_card_idx
  on public.pickup_request_items (pickup_request_id, inventory_item_id)
  where inventory_item_id is not null;
create unique index if not exists inventory_reservations_one_pickup_hold_idx
  on public.inventory_reservations (pickup_request_id, inventory_item_id)
  where pickup_request_id is not null and status = 'active';

-- ---------------------------------------------------------------------------
-- Prices and status
-- ---------------------------------------------------------------------------

-- One card's yard sale price: the website price less the discount, rounded
-- to the nearest cent. (src/store/lib/yardSale.ts has the same formula.)
create or replace function public.yard_sale_price(p_price_cents integer, p_discount_percent integer)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select ((p_price_cents::bigint * (100 - p_discount_percent) + 50) / 100)::integer
$$;

-- Public: is a sale on, and on what terms. Always one row; active = false
-- (and the rest null, sales_tax_bps aside) when no sale is on.
create or replace function public.yard_sale_status()
returns table (
  active boolean,
  sale_id uuid,
  discount_percent integer,
  min_price_cents integer,
  ends_at timestamptz,
  sales_tax_bps integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    y.id is not null,
    y.id,
    y.discount_percent,
    y.min_price_cents,
    y.ends_at,
    coalesce((select p.sales_tax_bps from public.pos_settings p order by p.id limit 1), 0)
  from (select 1) as one
  left join lateral (
    select ys.id, ys.discount_percent, ys.min_price_cents, ys.ends_at
    from public.yard_sales ys
    where ys.ended_at is null and now() < ys.ends_at
    order by ys.started_at desc
    limit 1
  ) y on true;
$$;

-- Vacation mode as before, plus: paused while a yard sale is on, with the
-- yard sale's message and end time (the later of the two when both are on;
-- none when vacation mode has no end). checkout_create_order and
-- checkout_create_guest_order refuse orders whenever this says paused.
create or replace function public.store_ordering_status()
returns table (paused boolean, message text, paused_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with vacation as (
    select
      st.orders_paused and (st.orders_paused_until is null or now() < st.orders_paused_until) as on_now,
      st.orders_paused_message as message,
      st.orders_paused_until as until
    from public.store_settings st
    where st.id
  ),
  sale as (
    select ys.ends_at
    from public.yard_sales ys
    where ys.ended_at is null and now() < ys.ends_at
    order by ys.started_at desc
    limit 1
  )
  select
    coalesce(v.on_now, false) or s.ends_at is not null,
    case
      when s.ends_at is not null then
        'We''re at our yard sale today, so online orders are paused. You can still browse and add cards to your cart.'
      else v.message
    end,
    case
      when coalesce(v.on_now, false) and s.ends_at is not null then
        case when v.until is null then null else greatest(v.until, s.ends_at) end
      when s.ends_at is not null then s.ends_at
      else v.until
    end
  from (select 1) as one
  left join vacation v on true
  left join sale s on true;
$$;

-- What each card sells for right now (see Prices in the header): null for
-- a card with no price. For the server: the yard sale list on a shopper's
-- phone and the lists in Pickup Requests show these.
create or replace function public.inventory_live_prices(p_inventory_item_ids uuid[])
returns table (inventory_item_id uuid, price_cents integer)
language sql
stable
set search_path = ''
as $$
  select i.id, public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal)
  from public.inventory_items i
  where i.id = any(p_inventory_item_ids);
$$;

revoke all on function public.inventory_live_prices(uuid[]) from public, anon, authenticated;
grant execute on function public.inventory_live_prices(uuid[]) to service_role;
revoke all on function public.yard_sale_price(integer, integer) from public, anon, authenticated;
revoke all on function public.yard_sale_status() from public;
grant execute on function public.yard_sale_status() to anon, authenticated, service_role;
revoke all on function public.store_ordering_status() from public;
grant execute on function public.store_ordering_status() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The Yard Sale Mode switch (admin, through /api/admin/yard-sale)
-- ---------------------------------------------------------------------------

create or replace function public.yard_sale_check_settings(
  p_ends_at timestamptz,
  p_discount_percent integer,
  p_min_price_cents integer
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_ends_at is null or p_ends_at <= now() then
    raise exception 'Pick an end time that hasn''t passed yet.' using errcode = 'GGY01';
  end if;
  if p_ends_at > now() + interval '7 days' then
    raise exception 'A yard sale can run for up to 7 days.' using errcode = 'GGY01';
  end if;
  if p_discount_percent is null or p_discount_percent not between 0 and 90 then
    raise exception 'The discount must be a whole number from 0%% to 90%%.' using errcode = 'GGY01';
  end if;
  if p_min_price_cents is null or p_min_price_cents not between 0 and 100000 then
    raise exception 'The minimum price must be between $0 and $1,000.' using errcode = 'GGY01';
  end if;
end;
$$;

-- Turn Yard Sale Mode on. A sale that ran out on its own is closed first
-- (as of its end time); one that's still on is an error, not replaced.
create or replace function public.yard_sale_start(
  p_ends_at timestamptz,
  p_discount_percent integer default 0,
  p_min_price_cents integer default 300,
  p_actor uuid default null
)
returns public.yard_sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.yard_sales;
begin
  if not public.staff_or_service_role() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform public.yard_sale_check_settings(p_ends_at, p_discount_percent, p_min_price_cents);

  if exists (select 1 from public.yard_sales y where y.ended_at is null and now() < y.ends_at) then
    raise exception 'A yard sale is already on.' using errcode = 'GGY02';
  end if;

  update public.yard_sales
    set ended_at = least(now(), ends_at), updated_by = coalesce(p_actor, updated_by)
    where ended_at is null;

  insert into public.yard_sales (ends_at, discount_percent, min_price_cents, created_by, updated_by)
    values (p_ends_at, p_discount_percent, p_min_price_cents, p_actor, p_actor)
    returning * into v_sale;
  return v_sale;
end;
$$;

-- Change the discount, minimum price or end time while the sale is on
-- (null leaves a setting as it is).
create or replace function public.yard_sale_update(
  p_sale_id uuid,
  p_ends_at timestamptz default null,
  p_discount_percent integer default null,
  p_min_price_cents integer default null,
  p_actor uuid default null
)
returns public.yard_sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.yard_sales;
begin
  if not public.staff_or_service_role() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_sale from public.yard_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Yard sale not found.' using errcode = 'GGY03';
  end if;
  if v_sale.ended_at is not null or now() >= v_sale.ends_at then
    raise exception 'This yard sale has already ended.' using errcode = 'GGY02';
  end if;
  perform public.yard_sale_check_settings(
    coalesce(p_ends_at, v_sale.ends_at),
    coalesce(p_discount_percent, v_sale.discount_percent),
    coalesce(p_min_price_cents, v_sale.min_price_cents)
  );

  update public.yard_sales
    set ends_at = coalesce(p_ends_at, ends_at),
        discount_percent = coalesce(p_discount_percent, discount_percent),
        min_price_cents = coalesce(p_min_price_cents, min_price_cents),
        updated_by = coalesce(p_actor, updated_by)
    where id = p_sale_id
    returning * into v_sale;
  return v_sale;
end;
$$;

-- Turn Yard Sale Mode off now. Ending a sale that's already over is a
-- no-op. Open lists are left as they are (see the header).
create or replace function public.yard_sale_end(p_sale_id uuid, p_actor uuid default null)
returns public.yard_sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.yard_sales;
begin
  if not public.staff_or_service_role() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_sale from public.yard_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Yard sale not found.' using errcode = 'GGY03';
  end if;
  if v_sale.ended_at is null then
    update public.yard_sales
      set ended_at = least(now(), ends_at), updated_by = coalesce(p_actor, updated_by)
      where id = p_sale_id
      returning * into v_sale;
  end if;
  return v_sale;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lists (the shopper's phone, through /api/yard-sale)
-- ---------------------------------------------------------------------------

-- The cards a shopper sent, checked and merged: one row per card, sorted so
-- every function locks stock rows in the same order.
create or replace function public.yard_sale_lines(p_items jsonb, p_max_lines integer)
returns table (inventory_item_id uuid, quantity integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_id uuid;
  v_qty integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one card to your list.' using errcode = 'GGY01';
  end if;
  if jsonb_array_length(p_items) > p_max_lines then
    raise exception 'That''s more cards than we can take at once. Send these in two goes.' using errcode = 'GGY01';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_id := (v_item ->> 'inventory_item_id')::uuid;
      v_qty := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'Something in your list didn''t look right. Please try again.' using errcode = 'GGY01';
    end;
    if v_id is null or v_qty is null or v_qty not between 1 and 20 then
      raise exception 'Something in your list didn''t look right. Please try again.' using errcode = 'GGY01';
    end if;
  end loop;

  return query
    select (e ->> 'inventory_item_id')::uuid, sum((e ->> 'quantity')::integer)::integer
    from jsonb_array_elements(p_items) as e
    group by 1
    order by 1;
end;
$$;

-- Hold one card for a list: the same sellable-quantity check every other
-- stock path uses, plus the yard sale's minimum price (on the website price,
-- as the yard sale page filters). Adding a card that's already on the list
-- raises its quantity (and its one hold).
create or replace function public.yard_sale_hold_card(
  p_request_id uuid,
  p_pickup_number integer,
  p_inventory_item_id uuid,
  p_quantity integer,
  p_min_price_cents integer
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_inv public.inventory_items;
  v_item public.pickup_request_items;
  v_res public.inventory_reservations;
  v_price integer;
  v_reserved integer;
  v_sellable integer;
  v_needed integer;
begin
  if not public.staff_or_service_role() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_inv from public.inventory_items where id = p_inventory_item_id for update;
  if not found or v_inv.status <> 'active' then
    raise exception 'One of the cards you picked is no longer available.' using errcode = 'GGY05';
  end if;
  v_price := public.storefront_effective_price(v_inv.price_cents, v_inv.original_price_cents, v_inv.is_deal);
  if v_price is null or v_price <= 0 then
    raise exception '% isn''t for sale right now.', v_inv.card_name using errcode = 'GGY05';
  end if;
  if v_price < p_min_price_cents then
    raise exception '% isn''t part of the yard sale.', v_inv.card_name using errcode = 'GGY05';
  end if;

  select coalesce(sum(r.quantity), 0)::integer into v_reserved
    from public.inventory_reservations r
    where r.inventory_item_id = v_inv.id and r.status = 'active';
  v_sellable := greatest(0, v_inv.quantity - v_reserved);

  select * into v_item from public.pickup_request_items
    where pickup_request_id = p_request_id and inventory_item_id = v_inv.id
    for update;

  if found then
    if v_item.quantity + p_quantity > 20 then
      raise exception 'A list can hold up to 20 copies of %.', v_inv.card_name using errcode = 'GGY01';
    end if;
    select * into v_res from public.inventory_reservations
      where pickup_request_id = p_request_id and inventory_item_id = v_inv.id and status = 'active'
      for update;
    -- Without its hold, the list's copies have to be found again too.
    v_needed := case when found then p_quantity else v_item.quantity + p_quantity end;
    if v_sellable < v_needed then
      if v_sellable = 0 then
        raise exception 'Someone just took the last %.', v_inv.card_name using errcode = 'GGY05';
      end if;
      raise exception 'Only % more of % % left.', v_sellable, v_inv.card_name,
        case when v_sellable = 1 then 'is' else 'are' end using errcode = 'GGY05';
    end if;
    update public.pickup_request_items
      set quantity = quantity + p_quantity, unit_price_cents = v_price
      where id = v_item.id;
    if v_res.id is not null then
      update public.inventory_reservations set quantity = quantity + p_quantity where id = v_res.id;
    else
      insert into public.inventory_reservations (inventory_item_id, pickup_request_id, quantity, status, note, reserved_by)
        values (v_inv.id, p_request_id, v_item.quantity + p_quantity, 'active',
                'Yard sale list #' || p_pickup_number, 'yard_sale');
    end if;
  else
    if p_quantity > 20 then
      raise exception 'A list can hold up to 20 copies of %.', v_inv.card_name using errcode = 'GGY01';
    end if;
    if v_sellable < p_quantity then
      if v_sellable = 0 then
        raise exception 'Someone just took the last %.', v_inv.card_name using errcode = 'GGY05';
      end if;
      raise exception 'Only % of % % left.', v_sellable, v_inv.card_name,
        case when v_sellable = 1 then 'is' else 'are' end using errcode = 'GGY05';
    end if;
    insert into public.pickup_request_items (
      pickup_request_id, inventory_item_id, card_name, set_code, set_name,
      collector_number, condition, finish, image_url, quantity, unit_price_cents
    ) values (
      p_request_id, v_inv.id, v_inv.card_name, v_inv.set_code, v_inv.set_name,
      v_inv.collector_number, v_inv.condition, v_inv.finish, v_inv.image_url, p_quantity, v_price
    );
    insert into public.inventory_reservations (inventory_item_id, pickup_request_id, quantity, status, note, reserved_by)
      values (v_inv.id, p_request_id, p_quantity, 'active', 'Yard sale list #' || p_pickup_number, 'yard_sale');
  end if;
end;
$$;

-- A shopper sends their list: it gets the sale's next pickup number and its
-- cards are held. All or nothing: one unavailable card fails the whole send.
create or replace function public.yard_sale_create_list(p_customer_name text, p_items jsonb)
returns table (request_id uuid, pickup_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_customer_name, ''));
  v_sale public.yard_sales;
  v_request_id uuid;
  v_number integer;
  v_line record;
begin
  if not public.staff_or_service_role() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'Please tell us your name (up to 60 characters).' using errcode = 'GGY01';
  end if;
  -- Check the cards before taking a number.
  perform 1 from public.yard_sale_lines(p_items, 30);

  select * into v_sale from public.yard_sales
    where ended_at is null and now() < ends_at
    order by started_at desc
    limit 1
    for update;
  if not found then
    raise exception 'The yard sale has ended.' using errcode = 'GGY02';
  end if;

  v_number := v_sale.next_pickup_number;
  update public.yard_sales set next_pickup_number = v_number + 1 where id = v_sale.id;

  insert into public.pickup_requests (customer_name, status, yard_sale_id, pickup_number)
    values (v_name, 'waiting', v_sale.id, v_number)
    returning id into v_request_id;

  for v_line in select * from public.yard_sale_lines(p_items, 30) loop
    perform public.yard_sale_hold_card(v_request_id, v_number, v_line.inventory_item_id, v_line.quantity, v_sale.min_price_cents);
  end loop;

  return query select v_request_id, v_number;
end;
$$;

-- More cards for a list that's still open, while the sale is on. A list
-- staff had marked ready needs pulling again.
create or replace function public.yard_sale_add_to_list(p_request_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.pickup_requests;
  v_sale public.yard_sales;
  v_line record;
  v_existing integer;
  v_new integer;
  v_count integer := 0;
begin
  if not public.staff_or_service_role() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_req from public.pickup_requests where id = p_request_id for update;
  if not found or v_req.yard_sale_id is null then
    raise exception 'We couldn''t find that list.' using errcode = 'GGY03';
  end if;
  if v_req.status = 'completed' then
    raise exception 'This list has already been paid for. Start a new one for more cards.' using errcode = 'GGY02';
  end if;
  if v_req.status = 'cancelled' then
    raise exception 'This list was closed. Start a new one for more cards.' using errcode = 'GGY02';
  end if;
  select * into v_sale from public.yard_sales where id = v_req.yard_sale_id for share;
  if v_sale.ended_at is not null or now() >= v_sale.ends_at then
    raise exception 'The yard sale has ended.' using errcode = 'GGY02';
  end if;

  select count(*)::integer into v_existing from public.pickup_request_items where pickup_request_id = p_request_id;
  select count(*)::integer into v_new
    from public.yard_sale_lines(p_items, 30) l
    where not exists (
      select 1 from public.pickup_request_items i
      where i.pickup_request_id = p_request_id and i.inventory_item_id = l.inventory_item_id
    );
  if v_existing + v_new > 60 then
    raise exception 'Your list is full. Pay for these first, then start a new list.' using errcode = 'GGY01';
  end if;

  for v_line in select * from public.yard_sale_lines(p_items, 30) loop
    perform public.yard_sale_hold_card(p_request_id, v_req.pickup_number, v_line.inventory_item_id, v_line.quantity, v_sale.min_price_cents);
    v_count := v_count + 1;
  end loop;

  if v_req.status = 'ready' then
    update public.pickup_requests set status = 'waiting', ready_at = null where id = p_request_id;
  end if;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff (Pickup Requests, through /api/admin?resource=pickup)
-- ---------------------------------------------------------------------------

-- Take a card off an open list (any pickup list, kiosk or yard sale):
-- all its copies, or p_quantity of them. The released copies go straight
-- back on the website. A list left with no cards is closed.
create or replace function public.pickup_remove_item(p_item_id uuid, p_quantity integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.pickup_request_items;
  v_req public.pickup_requests;
  v_res public.inventory_reservations;
  v_remove integer;
  v_left integer;
begin
  if not public.staff_or_service_role() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_item from public.pickup_request_items where id = p_item_id;
  if not found then
    raise exception 'That card isn''t on the list anymore.' using errcode = 'GGY03';
  end if;
  select * into v_req from public.pickup_requests where id = v_item.pickup_request_id for update;
  if v_req.status not in ('waiting', 'ready') then
    raise exception 'This list is already closed.' using errcode = 'GGY02';
  end if;
  select * into v_item from public.pickup_request_items where id = p_item_id for update;
  if not found then
    raise exception 'That card isn''t on the list anymore.' using errcode = 'GGY03';
  end if;

  v_remove := coalesce(p_quantity, v_item.quantity);
  if v_remove < 1 or v_remove > v_item.quantity then
    raise exception 'There are only % on the list.', v_item.quantity using errcode = 'GGY01';
  end if;

  if v_item.inventory_item_id is not null then
    select * into v_res from public.inventory_reservations
      where pickup_request_id = v_req.id and inventory_item_id = v_item.inventory_item_id and status = 'active'
      for update;
    if found then
      if v_remove >= v_res.quantity then
        update public.inventory_reservations
          set status = 'released', released_at = now(), released_by = 'Removed from pickup list'
          where id = v_res.id;
      else
        update public.inventory_reservations set quantity = quantity - v_remove where id = v_res.id;
      end if;
    end if;
  end if;

  if v_remove = v_item.quantity then
    delete from public.pickup_request_items where id = v_item.id;
  else
    update public.pickup_request_items set quantity = quantity - v_remove where id = v_item.id;
  end if;

  select count(*)::integer into v_left from public.pickup_request_items where pickup_request_id = v_req.id;
  if v_left = 0 then
    update public.inventory_reservations
      set status = 'released', released_at = now(), released_by = 'Pickup list emptied'
      where pickup_request_id = v_req.id and status = 'active';
    update public.pickup_requests set status = 'cancelled', cancelled_at = now() where id = v_req.id;
  end if;

  return jsonb_build_object(
    'request_id', v_req.id,
    'card_name', v_item.card_name,
    'removed', v_remove,
    'items_left', v_left,
    'cancelled', v_left = 0
  );
end;
$$;

-- Complete a yard sale list the shopper paid for in person: one order with
-- every card at its website price now (as pos_complete_pickup_sale records
-- kiosk pickups), the yard sale discount (as it is now) and the register's
-- sales tax, marked paid and handed over; stock goes down and the holds are
-- fulfilled, so the cards are off the website for good. No payment service
-- is involved.
create or replace function public.yard_sale_complete_list(
  p_request_id uuid,
  p_payment_method text
)
returns table (
  order_id uuid,
  subtotal_cents integer,
  discount_cents integer,
  tax_cents integer,
  total_cents integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.pickup_requests;
  v_sale public.yard_sales;
  v_method text;
  v_tax_bps integer;
  v_order_id uuid;
  v_subtotal integer := 0;
  v_discounted integer := 0;
  v_discount integer;
  v_tax integer;
  v_total integer;
  v_lines integer := 0;
  ri record;
  v_inv public.inventory_items;
  v_res public.inventory_reservations;
  v_price integer;
begin
  if not public.staff_or_service_role() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_method := case p_payment_method when 'cash' then 'Cash' when 'venmo' then 'Venmo' end;
  if v_method is null then
    raise exception 'Choose how they paid: cash or Venmo.' using errcode = 'GGY01';
  end if;

  select * into v_req from public.pickup_requests where id = p_request_id for update;
  if not found then
    raise exception 'We couldn''t find that list.' using errcode = 'GGY03';
  end if;
  if v_req.yard_sale_id is null then
    raise exception 'This is a kiosk request. Use Collect payment for it.' using errcode = 'GGY04';
  end if;
  if v_req.status = 'completed' then
    raise exception 'This list was already completed.' using errcode = 'GGY02';
  end if;
  if v_req.status = 'cancelled' then
    raise exception 'This list was cancelled.' using errcode = 'GGY02';
  end if;

  select * into v_sale from public.yard_sales where id = v_req.yard_sale_id;
  select coalesce((select p.sales_tax_bps from public.pos_settings p order by p.id limit 1), 0) into v_tax_bps;

  insert into public.orders (
    user_id, customer_id, email, channel, shipping_method,
    subtotal_cents, shipping_cents, discount_cents, store_credit_used_cents,
    tax_cents, total_cents, amount_due_cents,
    status, payment_status, internal_notes
  ) values (
    null, null, null, 'pos', null,
    0, 0, 0, 0,
    0, 0, 0,
    'pending_payment', 'unpaid',
    'Yard sale list #' || v_req.pickup_number || ' for ' || v_req.customer_name
  ) returning id into v_order_id;

  for ri in
    select * from public.pickup_request_items
    where pickup_request_id = p_request_id
    order by inventory_item_id, id
  loop
    if ri.inventory_item_id is null then
      raise exception '% was deleted from inventory. Take it off the list, then complete.', ri.card_name
        using errcode = 'GGY05';
    end if;
    select * into v_inv from public.inventory_items where id = ri.inventory_item_id for update;
    if not found or v_inv.status = 'archived' then
      raise exception '% is no longer in inventory. Take it off the list, then complete.', ri.card_name
        using errcode = 'GGY05';
    end if;
    v_price := public.storefront_effective_price(v_inv.price_cents, v_inv.original_price_cents, v_inv.is_deal);
    if v_price is null or v_price <= 0 then
      raise exception '% has no price. Price it or take it off the list, then complete.', ri.card_name
        using errcode = 'GGY05';
    end if;
    select * into v_res from public.inventory_reservations
      where pickup_request_id = p_request_id and inventory_item_id = v_inv.id and status = 'active'
      for update;
    if not found or v_res.quantity < ri.quantity then
      raise exception 'The hold on % was released. Take it off the list, then complete.', ri.card_name
        using errcode = 'GGY05';
    end if;
    if v_inv.quantity < ri.quantity then
      raise exception 'Inventory shows fewer copies of % than this list. Check the count, then complete.', ri.card_name
        using errcode = 'GGY05';
    end if;

    v_subtotal := v_subtotal + v_price * ri.quantity;
    v_discounted := v_discounted + public.yard_sale_price(v_price, v_sale.discount_percent) * ri.quantity;

    insert into public.order_items (
      order_id, inventory_item_id, scryfall_id, set_code, collector_number,
      card_name, set_name, condition, finish, variant_type, image_url,
      quantity, unit_price_cents, line_total_cents
    ) values (
      v_order_id, v_inv.id, v_inv.scryfall_id, v_inv.set_code, v_inv.collector_number,
      v_inv.card_name, v_inv.set_name, v_inv.condition, v_inv.finish, v_inv.variant_type, v_inv.image_url,
      ri.quantity, v_price, v_price * ri.quantity
    );

    update public.inventory_items set quantity = quantity - ri.quantity where id = v_inv.id;
    update public.inventory_reservations
      set status = 'fulfilled', released_at = now(), released_by = 'yard_sale_complete_list'
      where id = v_res.id;
    v_lines := v_lines + 1;
  end loop;

  if v_lines = 0 then
    raise exception 'This list has no cards left. Cancel it instead.' using errcode = 'GGY02';
  end if;

  v_discount := v_subtotal - v_discounted;
  v_tax := ((v_discounted::bigint * v_tax_bps) / 10000)::integer;
  v_total := v_discounted + v_tax;

  update public.orders
    set subtotal_cents = v_subtotal,
        discount_cents = v_discount,
        tax_cents = v_tax,
        total_cents = v_total,
        amount_due_cents = v_total,
        status = 'delivered',
        payment_status = 'paid',
        payment_provider = 'manual',
        payment_reference = 'Yard sale list #' || v_req.pickup_number || ' — ' || v_method,
        paid_at = now(),
        delivered_at = now()
    where id = v_order_id;

  update public.pickup_requests
    set status = 'completed', completed_at = now(), order_id = v_order_id
    where id = p_request_id;

  return query select v_order_id, v_subtotal, v_discount, v_tax, v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: everything but yard_sale_status is for the server (service role).
-- ---------------------------------------------------------------------------

revoke all on function public.yard_sale_check_settings(timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.yard_sale_start(timestamptz, integer, integer, uuid) from public, anon, authenticated;
revoke all on function public.yard_sale_update(uuid, timestamptz, integer, integer, uuid) from public, anon, authenticated;
revoke all on function public.yard_sale_end(uuid, uuid) from public, anon, authenticated;
revoke all on function public.yard_sale_lines(jsonb, integer) from public, anon, authenticated;
revoke all on function public.yard_sale_hold_card(uuid, integer, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.yard_sale_create_list(text, jsonb) from public, anon, authenticated;
revoke all on function public.yard_sale_add_to_list(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.pickup_remove_item(uuid, integer) from public, anon, authenticated;
revoke all on function public.yard_sale_complete_list(uuid, text) from public, anon, authenticated;

grant execute on function public.yard_sale_start(timestamptz, integer, integer, uuid) to service_role;
grant execute on function public.yard_sale_update(uuid, timestamptz, integer, integer, uuid) to service_role;
grant execute on function public.yard_sale_end(uuid, uuid) to service_role;
grant execute on function public.yard_sale_create_list(text, jsonb) to service_role;
grant execute on function public.yard_sale_add_to_list(uuid, jsonb) to service_role;
grant execute on function public.pickup_remove_item(uuid, integer) to service_role;
grant execute on function public.yard_sale_complete_list(uuid, text) to service_role;
