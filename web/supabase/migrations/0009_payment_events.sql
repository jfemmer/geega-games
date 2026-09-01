-- =============================================================================
-- 0009_payment_events.sql
-- Idempotency ledger for provider webhook/capture events (Stripe + PayPal).
-- The webhook handler inserts the event id BEFORE acting; a duplicate insert
-- (unique violation) means "already processed" -> no-op. This prevents double
-- processing (e.g. double 'paid', double refund) on provider retries.
-- Written only by server-side service role. No client access.
-- =============================================================================

create table if not exists public.payment_events (
  id           uuid primary key default gen_random_uuid(),
  provider     payment_provider not null,
  event_id     text not null,        -- provider's event id
  event_type   text not null,
  order_id     uuid references public.orders(id) on delete set null,
  payload      jsonb,
  processed_at timestamptz not null default now(),
  unique (provider, event_id)
);

create index if not exists idx_payment_events_order on public.payment_events(order_id);

comment on table public.payment_events is
  'Idempotency guard for provider webhooks. Unique (provider,event_id) makes retries no-ops.';
