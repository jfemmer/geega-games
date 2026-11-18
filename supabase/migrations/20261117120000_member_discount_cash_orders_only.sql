-- The member discount is for cash orders only.
--
-- A signed-in customer still gets MEMBER_DISCOUNT_PERCENT off their cards, but
-- not on an order that uses any store credit. Store credit already carries its
-- own bonus (trade-ins pay more in credit than in cash), so the two don't stack.
--
--   * Any credit used, however little, means no member discount on the whole
--     order. The checkout page shows the customer both totals so they can
--     choose (src/store/pages/CheckoutPage.tsx).
--   * Credit is now worked out first, capped at the undiscounted total (cards
--     + shipping), so a credit-paid order never "loses" the discount halfway.
--   * Sale and Deal prices are unchanged: they're the card's price, shown
--     everywhere, and apply however the order is paid.
--   * Guests can't use store credit, so guest orders are unchanged.
--   * In-person sales (POS, kiosk pickups) don't go through this function and
--     are unchanged.
--
-- Otherwise identical to 20261029120000_consignment_sales.sql (verified
-- against production's definition before this change).

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

  -- Store credit first, against the undiscounted total (cards + shipping):
  -- the member discount is for orders paid entirely by card, PayPal or Venmo.
  if p_uid is not null then
    v_credit_balance := public.store_credit_balance(p_uid);
    v_credit_used := least(
      greatest(coalesce(p_store_credit_requested_cents, 0), 0),
      greatest(v_credit_balance, 0), v_subtotal + v_shipping
    );
  end if;

  -- The member discount: signed in AND no store credit used. Off the cards
  -- that aren't consigned, rounded to the nearest cent (half up), after free
  -- shipping was decided on the full price.
  if p_uid is not null
     and v_credit_used = 0
     and not exists (select 1 from auth.users u where u.id = p_uid and u.is_anonymous) then
    v_discount := (((v_subtotal - v_consigned_subtotal)::bigint * c_member_discount_percent + 50) / 100)::integer;
  end if;

  v_total := v_subtotal - v_discount + v_shipping;
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
