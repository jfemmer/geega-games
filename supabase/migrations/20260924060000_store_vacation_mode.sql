-- Vacation mode: let staff pause online ordering with a customer-facing
-- message, optionally until a given time (after which ordering reopens by
-- itself, so a forgotten switch can't keep the store closed).
--
--   * store_settings: a single-row table (id is always true). Staff-only; the
--     server writes it through /api/admin/store-status with the service role.
--   * store_ordering_status(): the public, read-only view of it that the
--     storefront uses for the banner and to turn checkout off.
--   * checkout_create_order: refuses new orders while paused (P0005). The
--     register (pos_create_sale) and kiosk pickup requests are unaffected.

create table if not exists public.store_settings (
  id boolean primary key default true check (id),
  orders_paused boolean not null default false,
  orders_paused_message text not null default
    'We''re away for a bit and not taking orders right now. You can still browse and add cards to your cart — checkout reopens as soon as we''re back.',
  orders_paused_until timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check (char_length(orders_paused_message) between 1 and 500)
);

insert into public.store_settings (id) values (true) on conflict (id) do nothing;

alter table public.store_settings enable row level security;
revoke all on table public.store_settings from anon, authenticated;

create index if not exists store_settings_updated_by_idx on public.store_settings (updated_by);

create or replace function public.store_ordering_status()
returns table (paused boolean, message text, paused_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.orders_paused and (s.orders_paused_until is null or now() < s.orders_paused_until),
    s.orders_paused_message,
    s.orders_paused_until
  from public.store_settings s
  where s.id;
$$;

revoke all on function public.store_ordering_status() from public;
grant execute on function public.store_ordering_status() to anon, authenticated, service_role;

-- Same as 20260924050000 plus the paused check right after authentication.
create or replace function public.checkout_create_order(p_shipping_method shipping_method, p_store_credit_requested_cents integer DEFAULT 0, p_ship_recipient text DEFAULT NULL::text, p_ship_line1 text DEFAULT NULL::text, p_ship_line2 text DEFAULT NULL::text, p_ship_city text DEFAULT NULL::text, p_ship_state text DEFAULT NULL::text, p_ship_postal_code text DEFAULT NULL::text, p_ship_country text DEFAULT 'US'::text, p_guest_email text DEFAULT NULL::text)
 RETURNS TABLE(order_id uuid, subtotal_cents integer, shipping_cents integer, total_cents integer, store_credit_used_cents integer, amount_due_cents integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_cart_id uuid;
  v_subtotal integer := 0;
  v_shipping integer := 0;
  v_total integer := 0;
  v_credit_balance integer := 0;
  v_credit_used integer := 0;
  v_amount_due integer := 0;
  v_order_id uuid;
  v_prior uuid;
  r record;
  c_tracked_cents constant integer := 550;
  c_pwe_cents constant integer := 150;
  c_free_tracked_threshold constant integer := 8500;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- Vacation mode: no new online orders while the store is paused. Checked
  -- here (not only in the UI) so a stale tab or a direct API call can't
  -- slip an order through. Holds created before the pause can still be paid.
  if exists (select 1 from public.store_ordering_status() s where s.paused) then
    raise exception 'orders paused' using errcode = 'P0005';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    v_email := nullif(trim(p_guest_email), '');
  end if;
  select id into v_cart_id from public.carts where user_id = v_uid;
  if v_cart_id is null then
    raise exception 'cart is empty' using errcode = 'P0001';
  end if;

  for v_prior in
    select o.id from public.orders o
    where o.user_id = v_uid and o.channel = 'online'
      and o.status = 'pending_payment' and o.payment_status = 'unpaid'
      and o.payment_reference is null
  loop
    perform public.cancel_unpaid_order(v_prior, 'Replaced by a new checkout');
  end loop;

  insert into public.orders (
    user_id, email, shipping_method,
    subtotal_cents, shipping_cents, discount_cents,
    store_credit_used_cents, total_cents, amount_due_cents,
    ship_recipient, ship_line1, ship_line2, ship_city, ship_state, ship_postal_code, ship_country,
    status, payment_status
  ) values (
    v_uid, v_email, p_shipping_method, 0, 0, 0, 0, 0, 0,
    p_ship_recipient, p_ship_line1, p_ship_line2, p_ship_city, p_ship_state, p_ship_postal_code, p_ship_country,
    'pending_payment', 'unpaid'
  ) returning id into v_order_id;

  for r in
    select ci.quantity as qty, ci.inventory_item_id as inv_id
    from public.cart_items ci
    where ci.cart_id = v_cart_id
    order by ci.inventory_item_id
  loop
    declare
      v_inv public.inventory_items%rowtype;
      v_unit integer;
      v_line integer;
      v_reserved integer;
      v_sellable integer;
    begin
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

      v_unit := public.storefront_effective_price(v_inv.price_cents, v_inv.original_price_cents, v_inv.is_deal);
      v_line := v_unit * r.qty;
      v_subtotal := v_subtotal + v_line;

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

  if p_shipping_method = 'tracked' then
    v_shipping := case when v_subtotal >= c_free_tracked_threshold then 0 else c_tracked_cents end;
  elsif p_shipping_method = 'pwe' then
    v_shipping := c_pwe_cents;
  end if;

  v_total := v_subtotal + v_shipping;
  v_credit_balance := public.store_credit_balance(v_uid);
  v_credit_used := least(
    greatest(coalesce(p_store_credit_requested_cents, 0), 0),
    greatest(v_credit_balance, 0), v_total
  );
  v_amount_due := v_total - v_credit_used;

  if v_credit_used > 0 then
    insert into public.store_credit_transactions
      (user_id, amount_cents, type, reason, reference_type, reference_id)
    values (v_uid, -v_credit_used, 'order_spend', 'Checkout', 'order', v_order_id);
  end if;

  update public.orders set
    subtotal_cents = v_subtotal,
    shipping_cents = v_shipping,
    store_credit_used_cents = v_credit_used,
    total_cents = v_total,
    amount_due_cents = v_amount_due,
    payment_provider = case when v_amount_due = 0 then 'store_credit'::payment_provider else null end,
    payment_status = (case when v_amount_due = 0 then 'paid' else 'unpaid' end)::payment_status,
    status = (case when v_amount_due = 0 then 'paid' else 'pending_payment' end)::order_status,
    paid_at = case when v_amount_due = 0 then now() else null end
  where id = v_order_id;

  if v_amount_due = 0 then
    delete from public.cart_items where cart_id = v_cart_id;
  end if;

  return query select v_order_id, v_subtotal, v_shipping, v_total, v_credit_used, v_amount_due;
end;
$function$;
