-- Shipping follow-up: delivered emails for tracked orders and a "should have
-- arrived" check-in for Plain White Envelope orders. The worker is
-- api/shipping-updates/process.ts (logic in api/_lib/shippingUpdates.ts).

-- The EasyPost tracker for a shipped order (made with every label bought in
-- the admin; created by the worker for a tracking number typed in by hand),
-- the carrier's latest status (pre_transit, in_transit, out_for_delivery,
-- delivered, return_to_sender, failure, error…), and when the worker last
-- looked. Shown to staff on the order; customers can read their own orders
-- already, and none of this is sensitive.
alter table public.orders
  add column if not exists easypost_tracker_id text,
  add column if not exists tracking_status text,
  add column if not exists tracking_checked_at timestamptz;

comment on column public.orders.easypost_tracker_id is
  'EasyPost tracker id for delivery updates (see api/_lib/shippingUpdates.ts).';
comment on column public.orders.tracking_status is
  'Latest carrier status from EasyPost, e.g. in_transit, delivered, return_to_sender, or error when the number could not be tracked.';
comment on column public.orders.tracking_checked_at is
  'When the shipping-updates worker last checked this order''s tracking.';

-- The worker only ever looks at shipped orders.
create index if not exists orders_shipped_at_awaiting_delivery_idx
  on public.orders (shipped_at)
  where status = 'shipped';

-- Hourly, at :25 (off the top of the hour, when the other jobs run).
select cron.schedule(
  'geega-shipping-updates-worker',
  '25 * * * *',
  $cmd$
    select extensions.http_post(
      'https://geega-games.vercel.app/api/shipping-updates/process',
      '{}',
      'application/json'
    );
  $cmd$
);
