-- Push notifications for the installable admin app ("Geega Admin").
--
-- staff_push_subscriptions: one row per staff device that turned on
-- notifications (a Web Push subscription: the push service endpoint plus the
-- keys that encrypt payloads for that device), with which kinds of events it
-- wants. Written and read only by the API with the service_role key
-- (api/admin/push.ts subscribes/unsubscribes, api/_lib/staffPush.ts sends),
-- so there is no grant or policy for anon/authenticated at all.
--
-- staff_push_log: one row per event that was pushed, keyed by the event
-- (e.g. 'order:<id>'). Inserting first and sending only if the insert won
-- makes a push exactly-once even when the Stripe webhook and the PayPal
-- capture both report the same order, or Stripe retries a webhook.

create table if not exists public.staff_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 10 and 1000),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  kinds text[] not null
    default array['order', 'buying_lead', 'offer_response', 'partner_lead', 'pickup']::text[]
    check (kinds <@ array['order', 'buying_lead', 'offer_response', 'partner_lead', 'pickup']::text[]),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz
);

comment on table public.staff_push_subscriptions is
  'Admin app push subscriptions, one per staff device. service_role only (api/admin/push.ts, api/_lib/staffPush.ts).';

create index if not exists staff_push_subscriptions_user_id_idx
  on public.staff_push_subscriptions (user_id);

alter table public.staff_push_subscriptions enable row level security;
revoke all on public.staff_push_subscriptions from anon, authenticated;

create table if not exists public.staff_push_log (
  event_key text primary key check (char_length(event_key) between 1 and 200),
  kind text not null check (char_length(kind) <= 40),
  created_at timestamptz not null default now()
);

comment on table public.staff_push_log is
  'Dedupe log for admin push notifications: an event is pushed only by whoever inserts its key first. Pruned after 60 days by api/_lib/staffPush.ts.';

create index if not exists staff_push_log_created_at_idx
  on public.staff_push_log (created_at);

alter table public.staff_push_log enable row level security;
revoke all on public.staff_push_log from anon, authenticated;
