-- Checkout holds: stop "Continue to payment" from permanently eating stock
-- and emptying the cart when the customer never pays.
--
-- Before this migration, checkout_create_order (called when the customer
-- clicks "Continue to payment") decremented inventory_items.quantity AND
-- deleted every cart_items row, for an order that is only pending_payment.
-- Nothing ever undid that for an order that was never paid, so an abandoned
-- payment step removed the cards from the store for good and lost the cart.
--
-- New model: the payment step places a time-limited HOLD.
--   * checkout_create_order still decrements stock (so two customers can
--     never pay for the same last copy), but no longer clears the cart
--     unless the order is fully paid on the spot (store credit).
--   * The cart is cleared by mark_order_paid, i.e. only once payment
--     actually succeeds.
--   * An unpaid hold is released by cancel_unpaid_order — by the
--     /api/checkout/expire-holds worker after 30 minutes (scheduled below),
--     or immediately when the same customer starts checkout again (so they
--     never block themselves). The server cancels any Stripe PaymentIntent
--     before releasing, see api/_lib/checkoutHolds.ts.
--   * cart_item_availability() lets the cart count the caller's OWN held
--     quantity as available, so reloading during/after the payment step no
--     longer prunes the held items from the cart as "sold out".

-- 1. Restocking a released hold is not a fresh listing --------------------------
-- inventory_storefront_lifecycle treats quantity 0 -> >0 as a relist: it
-- resets storefront_listed_at (the aged-inventory clock) and drops any aged
-- deal price. A card coming back from an abandoned checkout must keep both,
-- so the relist logic is skipped while geega.stock_restore is on (set only
-- by cancel_unpaid_order below, transaction-local).
create or replace function public.inventory_storefront_lifecycle()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  relisted boolean := false;
begin
  if tg_op = 'INSERT' then
    new.storefront_listed_at := coalesce(new.storefront_listed_at, now());
    return new;
  end if;

  if coalesce(current_setting('geega.stock_restore', true), '') = 'on' then
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
$function$;

-- 2. cancel_unpaid_order: idempotent + never releases an in-flight payment -----
-- Previously a second call on the same order restocked (and refunded store
-- credit) twice. Now: already-cancelled is a no-op, and only an order still
-- pending_payment with no payment in progress can be released.
create or replace function public.cancel_unpaid_order(p_order_id uuid, p_reason text default 'cancelled'::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  oi record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status = 'cancelled' then return; end if;
  if v_order.payment_status = 'paid' then
    raise exception 'cannot cancel a paid order via this function';
  end if;
  if v_order.payment_status = 'processing' then
    raise exception 'cannot cancel an order whose payment is processing';
  end if;
  if v_order.status <> 'pending_payment' then
    raise exception 'cannot cancel an order in status %', v_order.status;
  end if;

  perform set_config('geega.stock_restore', 'on', true);
  for oi in select * from public.order_items where order_id = p_order_id loop
    if oi.inventory_item_id is not null then
      update public.inventory_items set quantity = quantity + oi.quantity where id = oi.inventory_item_id;
    end if;
  end loop;
  perform set_config('geega.stock_restore', 'off', true);

  if v_order.store_credit_used_cents > 0 then
    insert into public.store_credit_transactions
      (user_id, amount_cents, type, reason, reference_type, reference_id)
    values (v_order.user_id, v_order.store_credit_used_cents, 'order_refund', p_reason, 'order', p_order_id);
  end if;
  update public.orders set status = 'cancelled', cancelled_at = now() where id = p_order_id;
end;
$function$;

-- 3. mark_order_paid: clear the cart on payment; handle a late payment ----------
-- (a) On the transition to paid, remove the purchased quantities from the
--     buyer's cart (online orders only) — this is now the ONLY place an
--     online checkout clears the cart.
-- (b) A payment that lands after the hold was released (e.g. a Stripe
--     payment confirmed seconds before the expiry worker ran) must not leave
--     a paid order with its stock already back on sale. If every item is
--     still sellable, the hold is re-taken and the order proceeds as paid;
--     otherwise it stays cancelled and is flagged in internal_notes for a
--     refund.
create or replace function public.mark_order_paid(p_order_id uuid, p_provider payment_provider, p_reference text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_cart_id uuid;
  v_ok boolean := true;
  oi record;
  v_sellable integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.payment_status = 'paid' then return; end if;

  if v_order.status = 'cancelled' then
    if v_order.store_credit_used_cents > 0 then
      v_ok := false; -- the credit was refunded on cancel; resolve by hand
    else
      for oi in
        select * from public.order_items
        where order_id = p_order_id and inventory_item_id is not null
        order by inventory_item_id
      loop
        select greatest(0, i.quantity - coalesce((
                 select sum(r.quantity) from public.inventory_reservations r
                 where r.inventory_item_id = i.id and r.status = 'active'), 0))::int
          into v_sellable
          from public.inventory_items i where i.id = oi.inventory_item_id for update;
        if coalesce(v_sellable, 0) < oi.quantity then v_ok := false; end if;
      end loop;
    end if;

    if v_ok then
      for oi in
        select * from public.order_items
        where order_id = p_order_id and inventory_item_id is not null
      loop
        update public.inventory_items set quantity = quantity - oi.quantity where id = oi.inventory_item_id;
      end loop;
      update public.orders
        set status = 'paid', cancelled_at = null,
            internal_notes = concat_ws(E'\n', internal_notes,
              'Payment arrived after the checkout hold expired; stock was re-reserved automatically.')
        where id = p_order_id;
    else
      update public.orders
        set internal_notes = concat_ws(E'\n', internal_notes,
              'PAID AFTER CANCELLATION — items were no longer available. Refund this payment ('
              || p_provider::text || ' ' || coalesce(p_reference, '') || ').')
        where id = p_order_id;
    end if;
  end if;

  update public.orders
    set payment_status = 'paid', payment_provider = p_provider, payment_reference = p_reference,
        paid_at = coalesce(paid_at, now()),
        status = case when status = 'pending_payment' then 'paid' else status end
  where id = p_order_id;

  if v_order.channel = 'online' and v_order.user_id is not null then
    select id into v_cart_id from public.carts where user_id = v_order.user_id;
    if v_cart_id is not null then
      -- cart_items.quantity must stay > 0: drop fully-bought lines, then
      -- reduce any line the customer had more of than they bought.
      delete from public.cart_items ci
        using (select inventory_item_id, sum(quantity)::int qty from public.order_items
               where order_id = p_order_id and inventory_item_id is not null
               group by inventory_item_id) x
        where ci.cart_id = v_cart_id and ci.inventory_item_id = x.inventory_item_id
          and ci.quantity <= x.qty;
      update public.cart_items ci
        set quantity = ci.quantity - x.qty
        from (select inventory_item_id, sum(quantity)::int qty from public.order_items
              where order_id = p_order_id and inventory_item_id is not null
              group by inventory_item_id) x
        where ci.cart_id = v_cart_id and ci.inventory_item_id = x.inventory_item_id;
    end if;
  end if;
end;
$function$;

-- 4. checkout_create_order: keep the cart; one open hold per customer ---------
-- Differences from 20260920030423 (otherwise identical):
--   * First releases the caller's own earlier unpaid online holds that have
--     no payment started (payment_reference is null). Holds WITH a Stripe
--     PaymentIntent are released by the server beforehand (it must cancel
--     the PaymentIntent first); this covers the direct-RPC path and caps any
--     one account at a single open hold.
--   * Only deletes cart_items when the order is paid immediately (amount due
--     0, store credit). Otherwise the cart is cleared by mark_order_paid.
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

-- 5. Cart availability that counts the caller's own hold -----------------------
-- Same columns as inventory_public, for the given ids, but quantity is the
-- public sellable stock PLUS whatever the calling customer is holding in
-- their own open checkout. For anon callers (no hold possible) it's exactly
-- inventory_public. Reveals nothing about other customers' holds.
create or replace function public.cart_item_availability(p_ids uuid[])
 returns table (
   id uuid, card_name text, set_code text, set_name text,
   condition card_condition, finish card_finish, image_url text,
   price_cents integer, quantity integer, variant_type text
 )
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
         public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal),
         (greatest(i.quantity - coalesce(res.reserved_qty, 0), 0) + coalesce(held.qty, 0))::int,
         i.variant_type
  from public.inventory_items i
  join ids on ids.id = i.id
  left join res on res.inventory_item_id = i.id
  left join held on held.inventory_item_id = i.id
  where i.status = 'active'
    and greatest(i.quantity - coalesce(res.reserved_qty, 0), 0) + coalesce(held.qty, 0) > 0;
$function$;

revoke all on function public.cart_item_availability(uuid[]) from public;
grant execute on function public.cart_item_availability(uuid[]) to anon, authenticated, service_role;

-- 6. Release abandoned holds every 5 minutes ------------------------------------
-- The worker (api/checkout/expire-holds.ts) cancels each stale order's Stripe
-- PaymentIntent before releasing it, which SQL can't do — hence HTTP, the
-- same pattern as the other workers.
select cron.schedule(
  'geega-checkout-hold-expiry-worker',
  '*/5 * * * *',
  $cmd$
    select extensions.http_post(
      'https://geega-games.vercel.app/api/checkout/expire-holds',
      '{}',
      'application/json'
    );
  $cmd$
);
