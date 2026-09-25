-- Guest checkout.
--
-- Until now checkout_create_order required a signed-in customer and read the
-- items from their server cart. Guests (whose cart lives in their browser)
-- could not buy at all -- the storefront sent them to /login.
--
-- This splits the order-building logic into one internal core function, so
-- signed-in and guest checkout share the exact same pricing, stock locking,
-- sellable-stock revalidation, shipping rules and hold semantics:
--
--   checkout_place_order_core(...)   internal, NOT callable by any client role
--   checkout_create_order(...)       signed-in (unchanged signature/behaviour):
--                                    auth + vacation check, cart -> items,
--                                    cancels this customer's stale holds,
--                                    store credit, empties the cart when a
--                                    store-credit order is paid on the spot.
--   checkout_create_guest_order(...) service_role only (called by
--                                    /api/checkout/create-payment-intent):
--                                    vacation check, validated email + address,
--                                    items supplied by the server from the
--                                    browser cart, no store credit, user_id null.
--
-- The server re-prices every line from inventory_items; the browser only ever
-- supplies inventory ids and quantities.

-- Online orders no longer require an account -- only an email to reach the
-- buyer and a shipping method. (POS/kiosk orders were never constrained.)
alter table public.orders drop constraint if exists chk_online_requires_identity;
alter table public.orders add constraint chk_online_requires_identity
  check (channel <> 'online' or (email is not null and shipping_method is not null));

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
  v_shipping integer := 0;
  v_total integer := 0;
  v_credit_balance integer := 0;
  v_credit_used integer := 0;
  v_amount_due integer := 0;
  v_order_id uuid;
  v_lines integer;
  r record;
  c_tracked_cents constant integer := 550;
  c_pwe_cents constant integer := 150;
  c_free_tracked_threshold constant integer := 8500;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'cart is empty' using errcode = 'P0001';
  end if;

  select count(distinct (e->>'inventory_item_id')) into v_lines from jsonb_array_elements(p_items) e;
  if v_lines > 100 then
    raise exception 'too many items' using errcode = 'P0006';
  end if;

  insert into public.orders (
    user_id, email, shipping_method,
    subtotal_cents, shipping_cents, discount_cents,
    store_credit_used_cents, total_cents, amount_due_cents,
    ship_recipient, ship_line1, ship_line2, ship_city, ship_state, ship_postal_code, ship_country,
    status, payment_status
  ) values (
    p_uid, p_email, p_shipping_method, 0, 0, 0, 0, 0, 0,
    p_ship_recipient, p_ship_line1, p_ship_line2, p_ship_city, p_ship_state, p_ship_postal_code, p_ship_country,
    'pending_payment', 'unpaid'
  ) returning id into v_order_id;

  -- Same lock order as before (by inventory id) so concurrent checkouts
  -- can't deadlock; duplicate ids from the browser are summed.
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

  return query select v_order_id, v_subtotal, v_shipping, v_total, v_credit_used, v_amount_due;
end;
$function$;

revoke all on function public.checkout_place_order_core(
  uuid, text, jsonb, public.shipping_method, integer, text, text, text, text, text, text, text
) from public, anon, authenticated;

-- Signed-in checkout: same signature and behaviour as before.
create or replace function public.checkout_create_order(
  p_shipping_method public.shipping_method,
  p_store_credit_requested_cents integer default 0,
  p_ship_recipient text default null,
  p_ship_line1 text default null,
  p_ship_line2 text default null,
  p_ship_city text default null,
  p_ship_state text default null,
  p_ship_postal_code text default null,
  p_ship_country text default 'US',
  p_guest_email text default null
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
  v_uid uuid := auth.uid();
  v_email text;
  v_cart_id uuid;
  v_items jsonb;
  v_prior uuid;
  v_result record;
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

  select coalesce(
    jsonb_agg(jsonb_build_object('inventory_item_id', ci.inventory_item_id, 'quantity', ci.quantity)),
    '[]'::jsonb
  ) into v_items
  from public.cart_items ci
  where ci.cart_id = v_cart_id;

  select * into v_result from public.checkout_place_order_core(
    v_uid, v_email, v_items, p_shipping_method, p_store_credit_requested_cents,
    p_ship_recipient, p_ship_line1, p_ship_line2, p_ship_city, p_ship_state,
    p_ship_postal_code, p_ship_country
  );

  if v_result.amount_due_cents = 0 then
    delete from public.cart_items where cart_id = v_cart_id;
  end if;

  return query select v_result.order_id, v_result.subtotal_cents, v_result.shipping_cents,
    v_result.total_cents, v_result.store_credit_used_cents, v_result.amount_due_cents;
end;
$function$;

-- Guest checkout. service_role only: the API validates the request, rate
-- limits it, and issues the guest's signed order token.
create or replace function public.checkout_create_guest_order(
  p_email text,
  p_items jsonb,
  p_shipping_method public.shipping_method,
  p_ship_recipient text,
  p_ship_line1 text,
  p_ship_line2 text,
  p_ship_city text,
  p_ship_state text,
  p_ship_postal_code text,
  p_ship_country text default 'US'
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
  v_email text := lower(nullif(trim(p_email), ''));
begin
  if exists (select 1 from public.store_ordering_status() s where s.paused) then
    raise exception 'orders paused' using errcode = 'P0005';
  end if;
  if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'guest email required' using errcode = 'P0008';
  end if;
  if nullif(trim(p_ship_recipient), '') is null
     or nullif(trim(p_ship_line1), '') is null
     or nullif(trim(p_ship_city), '') is null
     or nullif(trim(p_ship_state), '') is null
     or nullif(trim(p_ship_postal_code), '') is null then
    raise exception 'shipping address required' using errcode = 'P0009';
  end if;

  return query select * from public.checkout_place_order_core(
    null, v_email, p_items, p_shipping_method, 0,
    trim(p_ship_recipient), trim(p_ship_line1), nullif(trim(p_ship_line2), ''),
    trim(p_ship_city), trim(p_ship_state), trim(p_ship_postal_code),
    coalesce(nullif(trim(p_ship_country), ''), 'US')
  );
end;
$function$;

revoke all on function public.checkout_create_guest_order(
  text, jsonb, public.shipping_method, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.checkout_create_guest_order(
  text, jsonb, public.shipping_method, text, text, text, text, text, text, text
) to service_role;

-- Attaching a guest order / sell submission to the account that just proved
-- it owns it (the API verifies the signed claim token first). Only ever fills
-- an EMPTY user_id -- never moves a record from one account to another.
create or replace function public.claim_guest_record(p_kind text, p_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer := 0;
begin
  if p_kind = 'order' then
    update public.orders set user_id = p_user_id
    where id = p_id and user_id is null;
    get diagnostics v_count = row_count;
  elsif p_kind = 'sell' then
    update public.sell_submissions set user_id = p_user_id
    where id = p_id and user_id is null;
    get diagnostics v_count = row_count;
  else
    raise exception 'unknown claim kind';
  end if;
  return v_count > 0
    or (p_kind = 'order' and exists (select 1 from public.orders where id = p_id and user_id = p_user_id))
    or (p_kind = 'sell' and exists (select 1 from public.sell_submissions where id = p_id and user_id = p_user_id));
end;
$function$;

revoke all on function public.claim_guest_record(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_guest_record(text, uuid, uuid) to service_role;
