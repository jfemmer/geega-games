-- The most different cards one online order may have, as a store setting.
--
-- checkout_place_order_core refused any order with more than 100 different
-- cards (a fixed number in the function), and the checkout page only said
-- "Checkout could not be completed", so a customer with a 121-card cart could
-- never get past checkout. Now:
--
--   store_settings.max_order_lines   the limit, 1–1000, set by staff on the
--                                     admin Checkout Settings page
--                                     (api/admin/checkout-settings.ts).
--                                     Starts at 500.
--   checkout_place_order_core         reads it; the error names both numbers
--                                     ('too many items: 121 different cards,
--                                     limit 100') so the API can tell the
--                                     customer exactly what to do.
--   store_ordering_status()           also returns it, so the cart and the
--                                     checkout page can warn before checkout.
--   admin_cart_size_summary()         the biggest signed-in cart and how many
--                                     are over a limit, for the settings page.
--
-- "Different cards" counts inventory lines, not copies: four copies of one
-- card count once. Copies per line stay capped at 99 as before.
--
-- checkout_place_order_core is otherwise identical to
-- 20261117120000_member_discount_cash_orders_only.sql (verified against
-- production's definition before this change). store_ordering_status() is
-- otherwise identical to 20261019050000_yard_sale_mode.sql; adding a column
-- to what it returns means dropping and recreating it (in this one
-- transaction). Its two callers, checkout_create_order and
-- checkout_create_guest_order, only read `paused`. Safe to run more than once.

alter table public.store_settings
  add column if not exists max_order_lines integer not null default 500
    check (max_order_lines between 1 and 1000);

comment on column public.store_settings.max_order_lines is
  'The most different cards (inventory lines, not copies) one online order may have. Set on the admin Checkout Settings page.';

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
  v_max_lines integer;
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

  -- The most different cards one order may have: staff set it on the admin
  -- Checkout Settings page (store_settings.max_order_lines).
  select count(distinct (e->>'inventory_item_id')) into v_lines from jsonb_array_elements(p_items) e;
  select st.max_order_lines into v_max_lines from public.store_settings st where st.id;
  v_max_lines := coalesce(v_max_lines, 500);
  if v_lines > v_max_lines then
    -- api/checkout/create-payment-intent.ts reads the two numbers back out.
    raise exception 'too many items: % different cards, limit %', v_lines, v_max_lines using errcode = 'P0006';
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

-- ---------------------------------------------------------------------------
-- store_ordering_status(): now also the order-size limit.

drop function if exists public.store_ordering_status();

create function public.store_ordering_status()
returns table (paused boolean, message text, paused_until timestamptz, max_order_lines integer)
language sql
stable
security definer
set search_path to ''
as $$
  with vacation as (
    select
      st.orders_paused and (st.orders_paused_until is null or now() < st.orders_paused_until) as on_now,
      st.orders_paused_message as message,
      st.orders_paused_until as until,
      st.max_order_lines as max_lines
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
    end,
    coalesce(v.max_lines, 500)
  from (select 1) as one
  left join vacation v on true
  left join sale s on true;
$$;

revoke all on function public.store_ordering_status() from public;
grant execute on function public.store_ordering_status() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- For the settings page: how big signed-in customers' carts are right now.
-- (Guests' carts live in their browsers, so they aren't counted.)

create or replace function public.admin_cart_size_summary(p_limit integer)
returns table (largest_lines integer, carts_over_limit integer)
language sql
stable
set search_path to 'public'
as $$
  select coalesce(max(c.lines), 0)::integer,
         (count(*) filter (where c.lines > p_limit))::integer
  from (
    select count(distinct ci.inventory_item_id) as lines
    from public.cart_items ci
    group by ci.cart_id
  ) c;
$$;

revoke all on function public.admin_cart_size_summary(integer) from public, anon, authenticated;
grant execute on function public.admin_cart_size_summary(integer) to service_role;
