-- 20260901000001_newsletter_and_email_deliveries
--
-- Adds the marketing-list + transactional-email tracking foundation.
-- Purely additive: no existing table, policy, or data is modified here.
--
-- Conventions reused from the existing schema:
--   * uuid primary keys (gen_random_uuid)
--   * citext for case-insensitive uniqueness (extension already installed)
--   * timestamptz columns, tg_set_updated_at() trigger for updated_at
--   * is_staff() for staff read access
--   * RLS ON with NO anon/authenticated write access; all writes go through
--     the service_role key used only by server-side Vercel Functions.

begin;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'subscriber_status') then
    create type public.subscriber_status as enum (
      'pending',      -- signed up, confirmation email sent, not yet confirmed
      'active',       -- confirmed double opt-in
      'unsubscribed', -- user opted out
      'bounced',      -- hard bounce reported by Resend
      'complained',   -- marked as spam
      'suppressed'    -- globally suppressed (do not contact)
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'email_delivery_status') then
    create type public.email_delivery_status as enum (
      'queued',
      'sent',
      'delivered',
      'bounced',
      'complained',
      'delivery_delayed',
      'suppressed',
      'failed',
      'canceled'
    );
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- newsletter_subscribers
-- ---------------------------------------------------------------------------
create table if not exists public.newsletter_subscribers (
  id                        uuid primary key default gen_random_uuid(),
  email                     citext not null,
  status                    public.subscriber_status not null default 'pending',
  source                    text not null default 'storefront',
  -- Only a hash of the confirmation token is stored, never the token itself.
  confirmation_token_hash   text,
  confirmation_sent_at      timestamptz,
  confirmation_expires_at   timestamptz,
  confirmed_at              timestamptz,
  unsubscribed_at           timestamptz,
  -- Secret used to build tamper-proof unsubscribe links without a second lookup
  -- table. Rotatable per-row; never exposed to the browser.
  unsubscribe_token_hash    text,
  last_bounce_reason        text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint newsletter_subscribers_email_key unique (email)
);

comment on table public.newsletter_subscribers is
  'Marketing email list. Double opt-in. Server-only access via service_role.';

create index if not exists newsletter_subscribers_status_idx
  on public.newsletter_subscribers (status);

create index if not exists newsletter_subscribers_confirmation_token_hash_idx
  on public.newsletter_subscribers (confirmation_token_hash)
  where confirmation_token_hash is not null;

create index if not exists newsletter_subscribers_unsubscribe_token_hash_idx
  on public.newsletter_subscribers (unsubscribe_token_hash)
  where unsubscribe_token_hash is not null;

drop trigger if exists set_updated_at on public.newsletter_subscribers;
create trigger set_updated_at
  before update on public.newsletter_subscribers
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- email_deliveries
-- ---------------------------------------------------------------------------
create table if not exists public.email_deliveries (
  id                uuid primary key default gen_random_uuid(),
  email_type        text not null,                 -- e.g. 'confirm_subscription'
  subscriber_id     uuid references public.newsletter_subscribers(id) on delete set null,
  order_id          uuid references public.orders(id) on delete set null,
  to_email          citext not null,
  resend_email_id   text,                          -- id returned by Resend
  -- Application-level idempotency key. UNIQUE guarantees a given logical email
  -- (e.g. order-confirmation-<order-id>) is only ever recorded/sent once.
  idempotency_key   text not null,
  status            public.email_delivery_status not null default 'queued',
  error_detail      text,                          -- safe, non-secret error text
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  delivered_at      timestamptz,
  bounced_at        timestamptz,
  complained_at     timestamptz,
  suppressed_at     timestamptz,
  failed_at         timestamptz,
  updated_at        timestamptz not null default now(),
  constraint email_deliveries_idempotency_key_key unique (idempotency_key)
);

comment on table public.email_deliveries is
  'Transactional/marketing email send + webhook status log. Server-only access.';

create index if not exists email_deliveries_resend_email_id_idx
  on public.email_deliveries (resend_email_id)
  where resend_email_id is not null;

create index if not exists email_deliveries_subscriber_id_idx
  on public.email_deliveries (subscriber_id);

create index if not exists email_deliveries_order_id_idx
  on public.email_deliveries (order_id);

drop trigger if exists set_updated_at on public.email_deliveries;
create trigger set_updated_at
  before update on public.email_deliveries
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Both tables are server-only. The service_role key BYPASSES RLS, so the
-- Vercel Functions retain full access. We deliberately create NO anon /
-- authenticated policies, so the browser (anon/publishable key) can neither
-- read nor write. Staff may read for support/debugging via is_staff().
-- ---------------------------------------------------------------------------
alter table public.newsletter_subscribers enable row level security;
alter table public.email_deliveries       enable row level security;

-- Staff read-only visibility (optional support tooling). No write policies.
drop policy if exists newsletter_subscribers_staff_select on public.newsletter_subscribers;
create policy newsletter_subscribers_staff_select
  on public.newsletter_subscribers
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists email_deliveries_staff_select on public.email_deliveries;
create policy email_deliveries_staff_select
  on public.email_deliveries
  for select
  to authenticated
  using (public.is_staff());

-- ---------------------------------------------------------------------------
-- Lock down table privileges: revoke everything from anon/authenticated so the
-- browser roles cannot touch these tables even if a policy is added later by
-- mistake. service_role keeps full access (it is granted separately and
-- bypasses RLS regardless).
-- ---------------------------------------------------------------------------
revoke all on public.newsletter_subscribers from anon, authenticated;
revoke all on public.email_deliveries       from anon, authenticated;

-- Staff SELECT policies still need the base SELECT privilege to be meaningful.
grant select on public.newsletter_subscribers to authenticated;
grant select on public.email_deliveries       to authenticated;

commit;
