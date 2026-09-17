-- Supports buying a real postage label (via EasyPost) directly from the
-- admin Orders page, instead of staff creating one in PayPal Shipping
-- Center / Word and pasting the tracking number back in manually.
--
-- tracking_number / tracking_carrier already exist and keep being the
-- source of truth for "Track My Order" — this just adds the extra metadata
-- a purchased label carries that a hand-typed tracking number never did.

alter table public.orders
  add column if not exists label_url text,
  add column if not exists postage_cost_cents integer,
  add column if not exists easypost_shipment_id text,
  add column if not exists shipping_service text,
  add column if not exists package_weight_oz numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_postage_cost_cents_check'
  ) then
    alter table public.orders
      add constraint orders_postage_cost_cents_check check (postage_cost_cents is null or postage_cost_cents >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'orders_package_weight_oz_check'
  ) then
    alter table public.orders
      add constraint orders_package_weight_oz_check check (package_weight_oz is null or package_weight_oz > 0);
  end if;
end$$;

comment on column public.orders.label_url is
  'Hosted PDF URL for a postage label purchased via EasyPost. Null for PWE orders (never a purchased label) and for tracked orders shipped with a hand-typed tracking number instead.';
comment on column public.orders.postage_cost_cents is
  'Actual postage cost charged by the carrier for a purchased label. Null unless label_url is set.';
comment on column public.orders.easypost_shipment_id is
  'EasyPost shipment id, kept for support/refund lookups. Null unless a label was purchased through EasyPost.';
comment on column public.orders.shipping_service is
  'Carrier service level of a purchased label (e.g. "First", "Priority"). Null unless label_url is set.';
comment on column public.orders.package_weight_oz is
  'Package weight used when purchasing the label (a fixed default for all tracked orders today, kept per-order for an audit trail and to allow a future per-order override).';
