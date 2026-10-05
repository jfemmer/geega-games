-- Orders ship within the United States only.
--
-- Until now nothing checked where an order was going. The checkout form had a
-- free-text "Country" box, the server passed whatever it was sent straight
-- through, and a signed-in customer could call checkout_create_order directly
-- with any address at all (or none). Nobody had ordered from abroad yet: all
-- 18 online orders are US addresses.
--
-- "The United States" means every address the Postal Service treats as
-- domestic: the 50 states, Washington, D.C., the five territories (American
-- Samoa, Guam, Northern Mariana Islands, Puerto Rico, US Virgin Islands) and
-- military mail (APO/FPO/DPO: AA, AE, AP).
--
-- Three layers, strictest last:
--   1. The checkout and saved-address forms offer only those places.
--   2. /api/checkout/create-payment-intent refuses anything else.
--   3. This file. checkout_place_order_core, which every online order goes
--      through (signed-in and guest), refuses a missing or non-US address
--      before it creates anything, and stores what it accepts tidied: state
--      as its USPS code, ZIP as 12345 or 12345-6789, country 'US'. A
--      constraint on orders then keeps any other code path, now or later,
--      from storing a destination outside the US.
--
-- The list of places below is the same as US_REGIONS in
-- src/store/lib/usAddress.ts; tests/usAddress.test.ts fails if they differ.

-- 1. "Missouri", " mo ", "MO" -> 'MO'. Anything that isn't a US state,
--    territory or military region -> null. Names are compared without periods
--    or commas and in upper case, so "Washington, D.C." matches.
create or replace function public.us_state_code(p_state text)
returns text
language sql
immutable
parallel safe
set search_path to ''
as $function$
  select r.code
  from (values
    ('AL', 'ALABAMA'),
    ('AK', 'ALASKA'),
    ('AZ', 'ARIZONA'),
    ('AR', 'ARKANSAS'),
    ('CA', 'CALIFORNIA'),
    ('CO', 'COLORADO'),
    ('CT', 'CONNECTICUT'),
    ('DE', 'DELAWARE'),
    ('DC', 'DISTRICT OF COLUMBIA'),
    ('DC', 'WASHINGTON DC'),
    ('FL', 'FLORIDA'),
    ('GA', 'GEORGIA'),
    ('HI', 'HAWAII'),
    ('ID', 'IDAHO'),
    ('IL', 'ILLINOIS'),
    ('IN', 'INDIANA'),
    ('IA', 'IOWA'),
    ('KS', 'KANSAS'),
    ('KY', 'KENTUCKY'),
    ('LA', 'LOUISIANA'),
    ('ME', 'MAINE'),
    ('MD', 'MARYLAND'),
    ('MA', 'MASSACHUSETTS'),
    ('MI', 'MICHIGAN'),
    ('MN', 'MINNESOTA'),
    ('MS', 'MISSISSIPPI'),
    ('MO', 'MISSOURI'),
    ('MT', 'MONTANA'),
    ('NE', 'NEBRASKA'),
    ('NV', 'NEVADA'),
    ('NH', 'NEW HAMPSHIRE'),
    ('NJ', 'NEW JERSEY'),
    ('NM', 'NEW MEXICO'),
    ('NY', 'NEW YORK'),
    ('NC', 'NORTH CAROLINA'),
    ('ND', 'NORTH DAKOTA'),
    ('OH', 'OHIO'),
    ('OK', 'OKLAHOMA'),
    ('OR', 'OREGON'),
    ('PA', 'PENNSYLVANIA'),
    ('RI', 'RHODE ISLAND'),
    ('SC', 'SOUTH CAROLINA'),
    ('SD', 'SOUTH DAKOTA'),
    ('TN', 'TENNESSEE'),
    ('TX', 'TEXAS'),
    ('UT', 'UTAH'),
    ('VT', 'VERMONT'),
    ('VA', 'VIRGINIA'),
    ('WA', 'WASHINGTON'),
    ('WV', 'WEST VIRGINIA'),
    ('WI', 'WISCONSIN'),
    ('WY', 'WYOMING'),
    ('AS', 'AMERICAN SAMOA'),
    ('GU', 'GUAM'),
    ('MP', 'NORTHERN MARIANA ISLANDS'),
    ('MP', 'COMMONWEALTH OF THE NORTHERN MARIANA ISLANDS'),
    ('PR', 'PUERTO RICO'),
    ('VI', 'US VIRGIN ISLANDS'),
    ('VI', 'VIRGIN ISLANDS'),
    ('VI', 'UNITED STATES VIRGIN ISLANDS'),
    ('AA', 'ARMED FORCES AMERICAS'),
    ('AE', 'ARMED FORCES EUROPE'),
    ('AP', 'ARMED FORCES PACIFIC')
  ) as r(code, name)
  where upper(btrim(regexp_replace(regexp_replace(coalesce(p_state, ''), '[.,]', '', 'g'), '[[:space:]]+', ' ', 'g')))
        in (r.code, r.name)
  limit 1
$function$;

-- 2. '63101', '63101-1234', '631011234', '63101 1234' -> '63101' or
--    '63101-1234'. Anything else (a Canadian or UK postcode, say) -> null.
create or replace function public.us_zip(p_zip text)
returns text
language sql
immutable
parallel safe
set search_path to ''
as $function$
  select case
    when z ~ '^[0-9]{5}$' then z
    when z ~ '^[0-9]{5}[- ]?[0-9]{4}$' then left(z, 5) || '-' || right(z, 4)
  end
  from (select btrim(coalesce(p_zip, '')) as z) s
$function$;

-- 3. Is this the United States, however it's written? A blank counts: the
--    forms have no country field and orders.ship_country defaults to 'US'.
create or replace function public.is_us_country(p_country text)
returns boolean
language sql
immutable
parallel safe
set search_path to ''
as $function$
  select upper(btrim(regexp_replace(regexp_replace(coalesce(p_country, ''), '[.,]', '', 'g'), '[[:space:]]+', ' ', 'g')))
         in ('', 'US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA')
$function$;

grant execute on function public.us_state_code(text) to anon, authenticated, service_role;
grant execute on function public.us_zip(text) to anon, authenticated, service_role;
grant execute on function public.is_us_country(text) to anon, authenticated, service_role;

-- 4. The order function: the same as in 20261002200000_free_shipping_at_75.sql
--    (prices, stock holds and free shipping are untouched) except that it now
--    refuses a missing or non-US address first, and stores the address tidied.
--    Refusals: 'shipping address required' (P0009, as the guest checkout
--    already raised) and 'us shipping only' (P0010, new).
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
  -- The method the order ships by: what was asked for, unless free shipping
  -- upgrades it to tracked (below).
  v_method public.shipping_method := p_shipping_method;
  -- Where the order ships, the way it is stored: USPS state code and ZIP.
  v_ship_state text;
  v_ship_zip text;
  r record;
  c_tracked_cents constant integer := 550;
  c_pwe_cents constant integer := 150;
  c_free_shipping_threshold constant integer := 7500;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'cart is empty' using errcode = 'P0001';
  end if;

  select count(distinct (e->>'inventory_item_id')) into v_lines from jsonb_array_elements(p_items) e;
  if v_lines > 100 then
    raise exception 'too many items' using errcode = 'P0006';
  end if;

  -- Orders ship within the United States only (see the top of this file).
  -- Checked before anything is created, so a refused address leaves no
  -- order behind and holds no stock.
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

  if v_subtotal >= c_free_shipping_threshold then
    -- $75 or more: free, and tracked, with nothing for the customer to pick.
    v_method := 'tracked';
    v_shipping := 0;
  elsif p_shipping_method = 'tracked' then
    v_shipping := c_tracked_cents;
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
    shipping_method = v_method,
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

-- Unchanged: only the server (service role) may call this directly.
revoke all on function public.checkout_place_order_core(
  uuid, text, jsonb, public.shipping_method, integer, text, text, text, text, text, text, text
) from public, anon, authenticated;

-- 5. Nothing else may store a destination outside the US either. In-store
--    (POS) sales have no shipping address and pass as they are. State names
--    are accepted as well as codes because earlier orders say "Missouri".
alter table public.orders
  add constraint chk_orders_ship_within_us check (
    (ship_country is null or ship_country = 'US')
    and (ship_state is null or public.us_state_code(ship_state) is not null)
    and (ship_postal_code is null or public.us_zip(ship_postal_code) is not null)
  );
