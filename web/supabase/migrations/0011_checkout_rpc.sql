-- =============================================================================
-- 0011_checkout_rpc.sql
-- The atomic checkout function + payment reconciliation.
--
-- checkout_create_order():
--   * SECURITY DEFINER, self-guards to the current authenticated user.
--   * Re-prices every line from inventory_items (server-authoritative).
--   * Computes shipping from centralized rules (tracked/pwe, free >= $85).
--   * Applies store credit = min(requested, balance, total).
--   * ATOMICALLY decrements inventory with row locks (no oversell, no race).
--   * Writes order + order_items + a store_credit 'order_spend' ledger row.
--   * Clears the cart.
--   * Returns the new order id + amounts so the server can create the
--     provider PaymentIntent/PayPal order for amount_due_cents.
--   Runs in a single transaction: any failure rolls the whole thing back
--     (no partial orders).
--
-- Shipping constants (CENTS): tracked 550, pwe 150, free tracked >= 8500.
--
-- Payment is NOT marked paid here. Only mark_order_paid() (called by verified
-- webhook/capture, server service role) can do that.
-- =============================================================================

create or replace function public.checkout_create_order(
  p_shipping_method shipping_method,
  p_store_credit_requested_cents integer default 0,
  p_ship_recipient text default null,
  p_ship_line1 text default null,
  p_ship_line2 text default null,
  p_ship_city text default null,
  p_ship_state text default null,
  p_ship_postal_code text default null,
  p_ship_country text default 'US'
)
returns table (
  order_id uuid,
  subtotal_cents integer,
  shipping_cents integer,
  total_cents integer,
  store_credit_used_cents integer,
  amount_due_cents integer
)
language plpgsql
security definer
set search_path = public
as $$
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
  r record;
  -- Centralized shipping constants (keep in sync with lib/domain/shipping.ts).
  c_tracked_cents constant integer := 550;
  c_pwe_cents constant integer := 150;
  c_free_tracked_threshold constant integer := 8500;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select email into v_email from auth.users where id = v_uid;

  select id into v_cart_id from public.carts where user_id = v_uid;
  if v_cart_id is null then
    raise exception 'cart is empty' using errcode = 'P0001';
  end if;

  -- Create the order shell early so order_items can reference it.
  insert into public.orders (
    user_id, email, shipping_method,
    subtotal_cents, shipping_cents, discount_cents,
    store_credit_used_cents, total_cents, amount_due_cents,
    ship_recipient, ship_line1, ship_line2, ship_city, ship_state, ship_postal_code, ship_country,
    status, payment_status
  ) values (
    v_uid, v_email, p_shipping_method,
    0, 0, 0, 0, 0, 0,
    p_ship_recipient, p_ship_line1, p_ship_line2, p_ship_city, p_ship_state, p_ship_postal_code, p_ship_country,
    'pending_payment', 'unpaid'
  )
  returning id into v_order_id;

  -- Walk cart lines, LOCK each inventory row, validate stock, reprice, decrement.
  for r in
    select ci.quantity as qty, ci.inventory_item_id as inv_id
    from public.cart_items ci
    where ci.cart_id = v_cart_id
    order by ci.inventory_item_id   -- deterministic lock order avoids deadlocks
  loop
    declare
      v_inv public.inventory_items%rowtype;
      v_unit integer;
      v_line integer;
    begin
      select * into v_inv
      from public.inventory_items
      where id = r.inv_id
      for update;    -- row lock: serializes concurrent checkouts of the same SKU

      if not found then
        raise exception 'item no longer available' using errcode = 'P0002';
      end if;

      if v_inv.price_cents is null then
        raise exception 'item has no price: %', v_inv.card_name using errcode = 'P0003';
      end if;

      if v_inv.quantity < r.qty then
        raise exception 'insufficient stock for % (have %, need %)',
          v_inv.card_name, v_inv.quantity, r.qty using errcode = 'P0004';
      end if;

      v_unit := v_inv.price_cents;
      v_line := v_unit * r.qty;
      v_subtotal := v_subtotal + v_line;

      -- Snapshot identity + price into order_items.
      insert into public.order_items (
        order_id, inventory_item_id, scryfall_id, set_code, collector_number,
        card_name, set_name, condition, finish, variant_type, image_url,
        quantity, unit_price_cents, line_total_cents
      ) values (
        v_order_id, v_inv.id, v_inv.scryfall_id, v_inv.set_code, v_inv.collector_number,
        v_inv.card_name, v_inv.set_name, v_inv.condition, v_inv.finish, v_inv.variant_type, v_inv.image_url,
        r.qty, v_unit, v_line
      );

      -- Atomic decrement (row is locked).
      update public.inventory_items
        set quantity = quantity - r.qty
        where id = v_inv.id;
    end;
  end loop;

  if v_subtotal = 0 then
    raise exception 'cart is empty' using errcode = 'P0001';
  end if;

  -- Shipping (centralized).
  if p_shipping_method = 'tracked' then
    v_shipping := case when v_subtotal >= c_free_tracked_threshold then 0 else c_tracked_cents end;
  elsif p_shipping_method = 'pwe' then
    v_shipping := c_pwe_cents;
  end if;

  v_total := v_subtotal + v_shipping;

  -- Store credit = min(requested, balance, total).
  v_credit_balance := public.store_credit_balance(v_uid);
  v_credit_used := least(
    greatest(coalesce(p_store_credit_requested_cents, 0), 0),
    greatest(v_credit_balance, 0),
    v_total
  );
  v_amount_due := v_total - v_credit_used;

  -- Record the spend in the ledger (negative). Balance is guaranteed >= 0
  -- because v_credit_used <= balance.
  if v_credit_used > 0 then
    insert into public.store_credit_transactions
      (user_id, amount_cents, type, reason, reference_type, reference_id)
    values
      (v_uid, -v_credit_used, 'order_spend', 'Checkout', 'order', v_order_id);
  end if;

  -- Finalize order money fields.
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

  -- Clear cart.
  delete from public.cart_items where cart_id = v_cart_id;

  return query
    select v_order_id, v_subtotal, v_shipping, v_total, v_credit_used, v_amount_due;
end;
$$;

comment on function public.checkout_create_order is
  'Atomic checkout: reprices from inventory, locks+decrements stock, applies credit, writes order+items+ledger, clears cart. Single transaction; no partial orders, no oversell. Does NOT mark card payments paid.';

-- ---------------------------------------------------------------------------
-- mark_order_paid(): called ONLY by the server service role from a verified
-- Stripe webhook or PayPal capture. Idempotent by design (no-op if already paid).
-- Attaches the provider + reference. This is the ONLY path to payment_status='paid'
-- for card/paypal orders.
-- ---------------------------------------------------------------------------
create or replace function public.mark_order_paid(
  p_order_id uuid,
  p_provider payment_provider,
  p_reference text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
    set payment_status = 'paid',
        payment_provider = p_provider,
        payment_reference = p_reference,
        paid_at = coalesce(paid_at, now()),
        status = case when status = 'pending_payment' then 'paid' else status end
  where id = p_order_id
    and payment_status <> 'paid';   -- idempotent: already-paid orders untouched
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_unpaid_order(): safe rollback for an abandoned/expired unpaid order.
-- Restores inventory and refunds any store credit spent. Server/admin only.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_unpaid_order(p_order_id uuid, p_reason text default 'cancelled')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  oi record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found';
  end if;
  if v_order.payment_status = 'paid' then
    raise exception 'cannot cancel a paid order via this function';
  end if;

  -- Restore stock.
  for oi in select * from public.order_items where order_id = p_order_id loop
    if oi.inventory_item_id is not null then
      update public.inventory_items
        set quantity = quantity + oi.quantity
        where id = oi.inventory_item_id;
    end if;
  end loop;

  -- Refund store credit if any was spent.
  if v_order.store_credit_used_cents > 0 then
    insert into public.store_credit_transactions
      (user_id, amount_cents, type, reason, reference_type, reference_id)
    values
      (v_order.user_id, v_order.store_credit_used_cents, 'order_refund', p_reason, 'order', p_order_id);
  end if;

  update public.orders
    set status = 'cancelled', cancelled_at = now()
    where id = p_order_id;
end;
$$;
