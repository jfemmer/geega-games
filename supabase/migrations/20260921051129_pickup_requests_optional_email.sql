-- Adds an optional email to kiosk pickup requests so a customer can be
-- emailed when their pickup is marked ready (previously only phone was
-- collected, and nothing notified them at all — see
-- api/_lib/pickupEmails.ts). Purely optional and additive: a request with no
-- email behaves exactly as before (no email sent, everything else unchanged).

begin;

alter table public.pickup_requests add column if not exists email text;

-- Adding a new parameter changes the function's argument-type signature, so
-- CREATE OR REPLACE would create a second overload rather than replacing
-- this one (the same overload-ambiguity trap fixed earlier for
-- checkout_create_order) — drop the old 3-arg signature explicitly first.
drop function if exists public.kiosk_create_pickup_request(text, text, jsonb);

create function public.kiosk_create_pickup_request(
  p_customer_name text,
  p_phone text,
  p_items jsonb,
  p_email text default null
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

  insert into public.pickup_requests (customer_name, phone, email)
  values (
    trim(p_customer_name),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_email, '')), '')
  )
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

revoke all on function public.kiosk_create_pickup_request(text, text, jsonb, text) from public;
grant execute on function public.kiosk_create_pickup_request(text, text, jsonb, text) to service_role;

commit;
