-- General "notify me when this card is back in stock" subscriptions, for any
-- card — distinct from deck_stock_notifications, which only fires for cards
-- inside a saved deck. This one is a direct, explicit, email-only opt-in
-- (no account required), primarily surfaced on /shop/card/:slug for a
-- currently out-of-stock card.
--
-- No RLS policy is added: every access goes through service_role from
-- api/stock-alerts/subscribe.ts (write) and api/stock-alerts/process.ts
-- (read + write), exactly like newsletter_subscribers and
-- deck_stock_notifications' own worker. Default-deny is correct here.

begin;

create table public.card_stock_subscriptions (
  id uuid primary key default gen_random_uuid(),
  oracle_id uuid not null,
  card_name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  unique (oracle_id, email)
);

create index card_stock_subscriptions_pending_idx
  on public.card_stock_subscriptions (oracle_id)
  where notified_at is null;

alter table public.card_stock_subscriptions enable row level security;

commit;
