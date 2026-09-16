-- Bug fix: pos_create_sale (and the new kiosk/pickup functions in the same
-- migration batch) checked `current_user <> 'service_role'` as a bypass for
-- the server's service-role calls. That's wrong inside a SECURITY DEFINER
-- function -- Postgres swaps current_user to the FUNCTION OWNER ('postgres'
-- here) for the duration of the call, so that check can never be true no
-- matter who actually invoked it. The correct check (already used correctly
-- elsewhere in this codebase, e.g. admin_create_reservation) is
-- auth.role() = 'service_role', which reads the JWT-derived session GUC and
-- survives the ownership switch. Without this fix, every /api/admin?
-- resource=pos call (which authenticates as service_role, not a staff JWT)
-- would fail with "Staff access required" -- verified failing, then passing
-- after this fix, directly against the database before touching any code
-- that calls it.

create or replace function public.pos_create_sale(
  p_items jsonb,
  p_customer_id uuid default null,
  p_notes text default null
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
  v_subtotal integer := 0;
  v_tax integer := 0;
  v_total integer := 0;
  v_tax_bps integer := 0;
  v_order_id uuid;
  v_customer_email text;
  v_item jsonb;
  v_inv_id uuid;
  v_qty integer;
begin
  if not (public.is_staff() or auth.role() = 'service_role') then
    raise exception 'Staff access required' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a sale needs at least one item' using errcode = 'P0001';
  end if;

  if p_customer_id is not null then
    select email into v_customer_email from public.customers where id = p_customer_id;
    if v_customer_email is null then
      raise exception 'customer not found' using errcode = 'P0006';
    end if;
  end if;

  select coalesce(sales_tax_bps, 0) into v_tax_bps from public.pos_settings where id = 1;

  insert into public.orders (
    user_id, customer_id, email, channel, shipping_method,
    subtotal_cents, shipping_cents, store_credit_used_cents,
    tax_cents, total_cents, amount_due_cents,
    status, payment_status, internal_notes
  ) values (
    null, p_customer_id, v_customer_email, 'pos', null,
    0, 0, 0,
    0, 0, 0,
    'pending_payment', 'unpaid', nullif(trim(coalesce(p_notes, '')), '')
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_inv_id := (v_item->>'inventory_item_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    if v_inv_id is null or v_qty is null or v_qty < 1 then
      raise exception 'invalid line item' using errcode = 'P0005';
    end if;

    declare
      v_inv public.inventory_items%rowtype;
      v_unit integer;
      v_line integer;
      v_reserved integer;
      v_sellable integer;
    begin
      select * into v_inv from public.inventory_items where id = v_inv_id for update;
      if not found then
        raise exception 'item no longer available' using errcode = 'P0002';
      end if;
      if v_inv.status = 'archived' then
        raise exception 'item no longer available: %', v_inv.card_name using errcode = 'P0002';
      end if;
      if v_inv.price_cents is null then
        raise exception 'item has no price: %', v_inv.card_name using errcode = 'P0003';
      end if;

      select coalesce(sum(res.quantity), 0)::int into v_reserved
      from public.inventory_reservations res
      where res.inventory_item_id = v_inv.id and res.status = 'active';

      v_sellable := greatest(0, v_inv.quantity - v_reserved);
      if v_sellable < v_qty then
        raise exception 'insufficient stock for % (sellable %, need %)',
          v_inv.card_name, v_sellable, v_qty using errcode = 'P0004';
      end if;

      v_unit := v_inv.price_cents;
      v_line := v_unit * v_qty;
      v_subtotal := v_subtotal + v_line;

      insert into public.order_items (
        order_id, inventory_item_id, scryfall_id, set_code, collector_number,
        card_name, set_name, condition, finish, variant_type, image_url,
        quantity, unit_price_cents, line_total_cents
      ) values (
        v_order_id, v_inv.id, v_inv.scryfall_id, v_inv.set_code, v_inv.collector_number,
        v_inv.card_name, v_inv.set_name, v_inv.condition, v_inv.finish, v_inv.variant_type, v_inv.image_url,
        v_qty, v_unit, v_line
      );

      update public.inventory_items set quantity = quantity - v_qty where id = v_inv.id;
    end;
  end loop;

  if v_subtotal = 0 then
    raise exception 'a sale needs at least one priced item' using errcode = 'P0001';
  end if;

  v_tax := (v_subtotal * v_tax_bps) / 10000;
  v_total := v_subtotal + v_tax;

  update public.orders set
    subtotal_cents = v_subtotal,
    tax_cents = v_tax,
    total_cents = v_total,
    amount_due_cents = v_total
  where id = v_order_id;

  return query select v_order_id, v_subtotal, v_tax, v_total, v_total;
end;
$function$;

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
begin
  if auth.role() <> 'service_role' then
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
    end;
  end loop;

  return v_request_id;
end;
$function$;

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
  if not (public.is_staff() or auth.role() = 'service_role') then
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
  if not (public.is_staff() or auth.role() = 'service_role') then
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

-- Match admin_create_reservation's convention: these are only ever called
-- from a staff-guarded Vercel Function using the service_role key, never
-- directly from the browser, so restrict EXECUTE accordingly rather than
-- leaving Postgres's default PUBLIC grant in place.
revoke all on function public.pos_create_sale(jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.pos_create_sale(jsonb, uuid, text) to service_role;

revoke all on function public.kiosk_create_pickup_request(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.kiosk_create_pickup_request(text, text, jsonb) to service_role;

revoke all on function public.pos_cancel_pickup_request(uuid, text) from public, anon, authenticated;
grant execute on function public.pos_cancel_pickup_request(uuid, text) to service_role;

revoke all on function public.pos_complete_pickup_sale(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pos_complete_pickup_sale(uuid, uuid) to service_role;
