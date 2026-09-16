-- In-store kiosk: a customer, standing in the shop at a store computer (NOT
-- the staff register), searches inventory themselves and submits a pickup
-- list. No account needed -- just a name. This:
--   * Holds the requested cards via the SAME inventory_reservations
--     mechanism staff already use (so "sellable" stock drops everywhere
--     online, in the register, and in future kiosk searches immediately --
--     one hold mechanism, not a second competing one).
--   * Creates a pickup_requests/pickup_request_items row pair staff can see
--     and work from -- NOT a real order yet, since nothing has been paid for
--     and the cards haven't been physically pulled.
--   * Only becomes a real order (via pos_complete_pickup_sale) once staff has
--     pulled everything and the customer is ready to pay at the register.
--
-- The kiosk itself is a PUBLIC, unauthenticated page (like the existing "Sell
-- Your Cards" flow) -- kiosk_create_pickup_request is only callable by the
-- service_role key from its server endpoint (api/kiosk/submit.ts), which
-- applies its own validation, honeypot, and rate limiting before calling in,
-- exactly like sell_submissions today.

create type public.pickup_request_status as enum ('waiting', 'ready', 'completed', 'cancelled');

create table public.pickup_requests (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text,
  status public.pickup_request_status not null default 'waiting',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  order_id uuid references public.orders(id) on delete set null
);

comment on table public.pickup_requests is
  'A customer-submitted kiosk pickup list: cards are held (via a matching inventory_reservations row per item) so staff can pull them while the customer keeps browsing. Becomes a real order only once pos_complete_pickup_sale runs at checkout.';

create table public.pickup_request_items (
  id uuid primary key default gen_random_uuid(),
  pickup_request_id uuid not null references public.pickup_requests(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  card_name text not null,
  set_code text,
  set_name text,
  collector_number text,
  condition public.card_condition not null,
  finish public.card_finish not null default 'nonfoil',
  image_url text,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  pulled boolean not null default false,
  created_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.pickup_requests;
create trigger set_updated_at
  before update on public.pickup_requests
  for each row execute function public.tg_set_updated_at();

alter table public.pickup_requests enable row level security;
alter table public.pickup_request_items enable row level security;

drop policy if exists pickup_requests_staff_select on public.pickup_requests;
create policy pickup_requests_staff_select
  on public.pickup_requests for select to authenticated using (public.is_staff());

drop policy if exists pickup_request_items_staff_select on public.pickup_request_items;
create policy pickup_request_items_staff_select
  on public.pickup_request_items for select to authenticated
  using (exists (
    select 1 from public.pickup_requests pr
    where pr.id = pickup_request_items.pickup_request_id and public.is_staff()
  ));

revoke all on public.pickup_requests from anon, authenticated;
revoke all on public.pickup_request_items from anon, authenticated;
grant select on public.pickup_requests to authenticated;
grant select on public.pickup_request_items to authenticated;

-- ---------------------------------------------------------------------------
-- inventory_reservations: allow a hold to belong to a kiosk pickup request
-- instead of a known customer. Exactly one holder, same as before (a
-- customer_id) or now (a pickup_request_id), never neither, never both.
-- ---------------------------------------------------------------------------
alter table public.inventory_reservations
  add column pickup_request_id uuid references public.pickup_requests(id) on delete cascade;
alter table public.inventory_reservations alter column customer_id drop not null;
alter table public.inventory_reservations
  add constraint chk_reservation_holder check (
    (customer_id is not null and pickup_request_id is null)
    or (customer_id is null and pickup_request_id is not null)
  );

comment on column public.inventory_reservations.pickup_request_id is
  'Set instead of customer_id when this hold came from an anonymous kiosk pickup request rather than a staff-created reservation for a known customer.';

-- ---------------------------------------------------------------------------
-- kiosk_create_pickup_request: PUBLIC-origin write, service_role only. The
-- kiosk server endpoint validates/rate-limits, then calls this with the
-- trusted service_role key -- exactly the sell_submissions pattern.
-- ---------------------------------------------------------------------------
create or replace function public.kiosk_create_pickup_request(
  p_customer_name text,
  p_phone text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request_id uuid;
  v_item jsonb;
  v_inv_id uuid;
  v_qty integer;
  v_count integer := 0;
begin
  if current_user <> 'service_role' then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_customer_name is null or trim(p_customer_name) = '' then
    raise exception 'a name is required' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'add at least one card' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'too many items in one request' using errcode = 'P0009';
  end if;

  insert into public.pickup_requests (customer_name, phone)
  values (trim(p_customer_name), nullif(trim(coalesce(p_phone, '')), ''))
  returning id into v_request_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_inv_id := (v_item->>'inventory_item_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    if v_inv_id is null or v_qty is null or v_qty < 1 or v_qty > 20 then
      raise exception 'invalid item' using errcode = 'P0005';
    end if;

    declare
      v_inv public.inventory_items%rowtype;
      v_reserved integer;
      v_sellable integer;
    begin
      select * into v_inv from public.inventory_items where id = v_inv_id for update;
      if not found or v_inv.status = 'archived' then
        raise exception 'item no longer available' using errcode = 'P0002';
      end if;
      if v_inv.price_cents is null then
        raise exception 'item has no price: %', v_inv.card_name using errcode = 'P0003';
      end if;

      select coalesce(sum(r.quantity), 0)::int into v_reserved
      from public.inventory_reservations r
      where r.inventory_item_id = v_inv.id and r.status = 'active';

      v_sellable := greatest(0, v_inv.quantity - v_reserved);
      if v_sellable < v_qty then
        raise exception 'insufficient stock for %', v_inv.card_name using errcode = 'P0004';
      end if;

      insert into public.pickup_request_items (
        pickup_request_id, inventory_item_id, card_name, set_code, set_name,
        collector_number, condition, finish, image_url, quantity, unit_price_cents
      ) values (
        v_request_id, v_inv.id, v_inv.card_name, v_inv.set_code, v_inv.set_name,
        v_inv.collector_number, v_inv.condition, v_inv.finish, v_inv.image_url, v_qty, v_inv.price_cents
      );

      insert into public.inventory_reservations (
        inventory_item_id, pickup_request_id, quantity, status, note, reserved_by
      ) values (
        v_inv.id, v_request_id, v_qty, 'active', 'Kiosk pickup request', 'kiosk'
      );
      v_count := v_count + 1;
    end;
  end loop;

  return v_request_id;
end;
$function$;

comment on function public.kiosk_create_pickup_request is
  'Public-origin write, service_role only (see api/kiosk/submit.ts). Reserves each item (same sellable-quantity check every other stock path uses) and records the pickup request + its line items.';

-- ---------------------------------------------------------------------------
-- pos_cancel_pickup_request: staff releases the hold without a sale.
-- ---------------------------------------------------------------------------
create or replace function public.pos_cancel_pickup_request(
  p_pickup_request_id uuid,
  p_reason text default 'Cancelled at register'
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_staff() and current_user <> 'service_role' then
    raise exception 'Staff access required' using errcode = '42501';
  end if;

  update public.inventory_reservations
    set status = 'released', released_at = now(), released_by = p_reason
  where pickup_request_id = p_pickup_request_id and status = 'active';

  update public.pickup_requests
    set status = 'cancelled', cancelled_at = now()
  where id = p_pickup_request_id and status in ('waiting', 'ready');
end;
$function$;

-- ---------------------------------------------------------------------------
-- pos_complete_pickup_sale: the staff-only conversion of a fulfilled pickup
-- request into a real, payable order -- the equivalent of pos_create_sale but
-- sourced from pickup_request_items/their reservations instead of a
-- client-supplied item list. Prices are re-read live from inventory_items
-- (never trusted from the original request snapshot), matching every other
-- sale-creation path in this app.
-- ---------------------------------------------------------------------------
create or replace function public.pos_complete_pickup_sale(
  p_pickup_request_id uuid,
  p_customer_id uuid default null
)
returns table(
  order_id uuid,
  subtotal_cents integer,
  tax_cents integer,
  total_cents integer,
  amount_due_cents integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request public.pickup_requests%rowtype;
  v_subtotal integer := 0;
  v_tax integer := 0;
  v_total integer := 0;
  v_tax_bps integer := 0;
  v_order_id uuid;
  ri record;
begin
  if not public.is_staff() and current_user <> 'service_role' then
    raise exception 'Staff access required' using errcode = '42501';
  end if;

  select * into v_request from public.pickup_requests where id = p_pickup_request_id for update;
  if not found then
    raise exception 'pickup request not found' using errcode = 'P0006';
  end if;
  if v_request.status = 'completed' then
    raise exception 'this pickup request was already completed' using errcode = 'P0007';
  end if;
  if v_request.status = 'cancelled' then
    raise exception 'this pickup request was cancelled' using errcode = 'P0007';
  end if;

  select coalesce(sales_tax_bps, 0) into v_tax_bps from public.pos_settings where id = 1;

  insert into public.orders (
    user_id, customer_id, email, channel, shipping_method,
    subtotal_cents, shipping_cents, store_credit_used_cents,
    tax_cents, total_cents, amount_due_cents,
    status, payment_status, internal_notes
  ) values (
    null, p_customer_id, null, 'pos', null,
    0, 0, 0, 0, 0, 0,
    'pending_payment', 'unpaid',
    'Kiosk pickup for ' || v_request.customer_name
      || coalesce(' (' || v_request.phone || ')', '')
  ) returning id into v_order_id;

  for ri in select * from public.pickup_request_items where pickup_request_id = p_pickup_request_id
  loop
    declare
      v_inv public.inventory_items%rowtype;
      v_res public.inventory_reservations%rowtype;
      v_line integer;
    begin
      select * into v_inv from public.inventory_items where id = ri.inventory_item_id for update;
      if not found or v_inv.status = 'archived' then
        raise exception 'item no longer available: %', ri.card_name using errcode = 'P0002';
      end if;
      if v_inv.price_cents is null then
        raise exception 'item has no price: %', ri.card_name using errcode = 'P0003';
      end if;

      select * into v_res from public.inventory_reservations
        where pickup_request_id = p_pickup_request_id
          and inventory_item_id = ri.inventory_item_id
          and status = 'active'
        for update;
      if not found or v_res.quantity < ri.quantity then
        raise exception 'the hold for % is missing or was released -- someone may need to re-check stock', ri.card_name
          using errcode = 'P0008';
      end if;
      if v_inv.quantity < ri.quantity then
        raise exception 'insufficient physical stock for %', ri.card_name using errcode = 'P0004';
      end if;

      v_line := v_inv.price_cents * ri.quantity;
      v_subtotal := v_subtotal + v_line;

      insert into public.order_items (
        order_id, inventory_item_id, scryfall_id, set_code, collector_number,
        card_name, set_name, condition, finish, variant_type, image_url,
        quantity, unit_price_cents, line_total_cents
      ) values (
        v_order_id, v_inv.id, v_inv.scryfall_id, ri.set_code, ri.collector_number,
        ri.card_name, ri.set_name, ri.condition, ri.finish, v_inv.variant_type, ri.image_url,
        ri.quantity, v_inv.price_cents, v_line
      );

      update public.inventory_items set quantity = quantity - ri.quantity where id = v_inv.id;
      update public.inventory_reservations
        set status = 'fulfilled', released_at = now(), released_by = 'pos_complete_pickup_sale'
        where id = v_res.id;
    end;
  end loop;

  if v_subtotal = 0 then
    raise exception 'this pickup request has no items' using errcode = 'P0001';
  end if;

  v_tax := (v_subtotal * v_tax_bps) / 10000;
  v_total := v_subtotal + v_tax;

  update public.orders set
    subtotal_cents = v_subtotal,
    tax_cents = v_tax,
    total_cents = v_total,
    amount_due_cents = v_total
  where id = v_order_id;

  update public.pickup_requests
    set status = 'completed', completed_at = now(), order_id = v_order_id
  where id = p_pickup_request_id;

  return query select v_order_id, v_subtotal, v_tax, v_total, v_total;
end;
$function$;

comment on function public.pos_complete_pickup_sale is
  'Staff-only: converts a pulled/ready pickup request into a real pending order (subtotal/tax/total computed from LIVE inventory prices, never the original request snapshot), decrements stock, and releases the matching reservations as fulfilled. The caller collects payment next via the normal cash/Terminal flow, same as pos_create_sale.';
