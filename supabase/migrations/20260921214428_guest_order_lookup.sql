-- Anti-enumeration guest order lookup: requires an EXACT email match AND the
-- 8-hex-char order-number prefix (the same "#XXXXXXXX" shown on confirmation
-- emails and in orderNumber() throughout the account area) together — either
-- alone is not enough to resolve a row. Returns the same field set already
-- exposed to a signed-in customer viewing their own order (see OrderDetail /
-- OrderItem in AccountPages.tsx) and nothing more: no internal_notes,
-- label_url, postage_cost_cents, easypost_shipment_id, payment_reference,
-- customer_id, user_id, or channel.
create or replace function public.guest_order_lookup(p_order_number text, p_email text)
returns jsonb
language sql
stable
security definer
set search_path = 'public'
as $function$
  select jsonb_build_object(
    'id', o.id,
    'order_number', '#' || upper(left(o.id::text, 8)),
    'created_at', o.created_at,
    'status', o.status,
    'payment_status', o.payment_status,
    'subtotal_cents', o.subtotal_cents,
    'shipping_cents', o.shipping_cents,
    'store_credit_used_cents', o.store_credit_used_cents,
    'total_cents', o.total_cents,
    'amount_due_cents', o.amount_due_cents,
    'shipping_method', o.shipping_method,
    'tracking_carrier', o.tracking_carrier,
    'tracking_number', o.tracking_number,
    'paid_at', o.paid_at,
    'packed_at', o.packed_at,
    'ready_at', o.ready_at,
    'shipped_at', o.shipped_at,
    'delivered_at', o.delivered_at,
    'ship_recipient', o.ship_recipient,
    'ship_line1', o.ship_line1,
    'ship_line2', o.ship_line2,
    'ship_city', o.ship_city,
    'ship_state', o.ship_state,
    'ship_postal_code', o.ship_postal_code,
    'ship_country', o.ship_country,
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', oi.id,
            'card_name', oi.card_name,
            'set_code', oi.set_code,
            'set_name', oi.set_name,
            'collector_number', oi.collector_number,
            'condition', oi.condition,
            'finish', oi.finish,
            'variant_type', oi.variant_type,
            'quantity', oi.quantity,
            'unit_price_cents', oi.unit_price_cents,
            'line_total_cents', oi.line_total_cents,
            'image_url', oi.image_url
          )
          order by oi.card_name
        )
        from public.order_items oi
        where oi.order_id = o.id
      ),
      '[]'::jsonb
    )
  )
  from public.orders o
  where o.email is not null
    and lower(o.email) = lower(trim(p_email))
    and left(o.id::text, 8) = lower(regexp_replace(trim(p_order_number), '^#', ''))
  limit 1;
$function$;

revoke all on function public.guest_order_lookup(text, text) from public;
grant execute on function public.guest_order_lookup(text, text) to anon, authenticated, service_role;
