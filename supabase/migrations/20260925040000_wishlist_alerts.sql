-- Wishlist alerts: email a signed-in customer when a card on their wishlist
--   * comes back in stock (restock),
--   * gets cheaper (price_drop: cheapest sellable copy drops >= 5% and >= $0.25),
--   * goes on a deal (deal: manual/aged/flawed deal or a storewide sale).
--
-- Design, mirroring deck_stock_notifications:
--   1. customer_wishlist_items keeps a snapshot of what the customer last
--      "saw" (last_in_stock / last_price_cents / last_on_deal), seeded at
--      add time so saving a card never alerts about the state it's already in.
--   2. wishlist_alert_scan() (service_role only) compares every wishlisted
--      card with live inventory, queues one wishlist_alert_events row per
--      change for customers with alerts on, and re-baselines every snapshot.
--   3. /api/wishlist-alerts/process runs the scan, then emails each customer
--      ONE digest of their unsent events (at most one digest per 3 hours per
--      customer, so a restock burst doesn't become an email storm).
-- Prices are the storefront's effective prices (deals + storewide sale) over
-- SELLABLE quantity (physical minus active checkout holds), same as search.

alter table public.profiles
  add column if not exists wishlist_alerts boolean not null default true;

comment on column public.profiles.wishlist_alerts is
  'Email me when a wishlisted card is restocked, drops in price, or goes on a deal. Default on; toggled under Account > Notifications.';

alter table public.customer_wishlist_items
  add column if not exists last_in_stock boolean,
  add column if not exists last_price_cents integer,
  add column if not exists last_on_deal boolean,
  add column if not exists last_checked_at timestamptz;

-- Live storefront state of a card (by oracle_id): sellable at all, cheapest
-- effective price, any copy on a deal. Internal helper; not granted to clients.
create or replace function public.wishlist_card_state(p_oracle_id uuid)
returns table(in_stock boolean, min_price_cents integer, on_deal boolean)
language sql
stable
security definer
set search_path = public
as $$
  with sellable as (
    select
      public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal) as price_cents,
      (i.is_deal
        or public.storefront_effective_discount_percent(i.price_cents, i.original_price_cents, i.is_deal) is not null
      ) as on_deal
    from public.inventory_items i
    where i.oracle_id = p_oracle_id
      and i.status = 'active'
      and i.quantity - coalesce((
            select sum(r.quantity)::int from public.inventory_reservations r
            where r.inventory_item_id = i.id and r.status = 'active'
          ), 0) > 0
  )
  select
    count(*) > 0,
    min(price_cents),
    coalesce(bool_or(on_deal), false)
  from sellable;
$$;

revoke all on function public.wishlist_card_state(uuid) from public, anon, authenticated;

-- Seed the snapshot when a card is saved.
create or replace function public.wishlist_item_seed_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  select * into s from public.wishlist_card_state(new.oracle_id);
  new.last_in_stock := coalesce(s.in_stock, false);
  new.last_price_cents := s.min_price_cents;
  new.last_on_deal := coalesce(s.on_deal, false);
  new.last_checked_at := now();
  return new;
end;
$$;

drop trigger if exists wishlist_item_seed_snapshot_trg on public.customer_wishlist_items;
create trigger wishlist_item_seed_snapshot_trg
  before insert on public.customer_wishlist_items
  for each row execute function public.wishlist_item_seed_snapshot();

-- Backfill existing wishlist rows.
update public.customer_wishlist_items w
set (last_in_stock, last_price_cents, last_on_deal, last_checked_at) = (
  select coalesce(s.in_stock, false), s.min_price_cents, coalesce(s.on_deal, false), now()
  from public.wishlist_card_state(w.oracle_id) s
)
where w.last_checked_at is null;

create table if not exists public.wishlist_alert_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wishlist_item_id uuid references public.customer_wishlist_items(id) on delete cascade,
  oracle_id uuid not null,
  card_name text not null,
  kind text not null check (kind in ('restock', 'price_drop', 'deal')),
  price_cents integer,
  previous_price_cents integer,
  created_at timestamptz not null default now(),
  email_sent_at timestamptz,
  email_error text
);

create index if not exists wishlist_alert_events_pending_idx
  on public.wishlist_alert_events (user_id, created_at)
  where email_sent_at is null and email_error is null;

create index if not exists wishlist_alert_events_sent_idx
  on public.wishlist_alert_events (user_id, email_sent_at desc)
  where email_sent_at is not null;

-- Service-role only (the worker), like deck_stock_notifications' queue.
alter table public.wishlist_alert_events enable row level security;

create or replace function public.wishlist_alert_scan()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  queued integer := 0;
begin
  with current_state as (
    select
      w.id, w.user_id, w.oracle_id, w.card_name,
      w.last_in_stock, w.last_price_cents, w.last_on_deal,
      s.in_stock, s.min_price_cents, s.on_deal,
      coalesce(p.wishlist_alerts, true) as alerts_on
    from public.customer_wishlist_items w
    cross join lateral public.wishlist_card_state(w.oracle_id) s
    left join public.profiles p on p.id = w.user_id
  ),
  changes as (
    select c.*,
      case
        when c.in_stock and not coalesce(c.last_in_stock, false) then 'restock'
        when c.in_stock and c.on_deal and not coalesce(c.last_on_deal, false) then 'deal'
        when c.in_stock and coalesce(c.last_in_stock, false)
             and c.last_price_cents is not null and c.min_price_cents is not null
             and c.min_price_cents <= c.last_price_cents - 25
             and c.min_price_cents <= floor(c.last_price_cents * 0.95)
          then 'price_drop'
      end as kind
    from current_state c
  ),
  inserted as (
    insert into public.wishlist_alert_events
      (user_id, wishlist_item_id, oracle_id, card_name, kind, price_cents, previous_price_cents)
    select user_id, id, oracle_id, card_name, kind, min_price_cents,
           case when kind = 'price_drop' then last_price_cents end
    from changes
    where kind is not null and alerts_on
    returning 1
  ),
  rebaselined as (
    update public.customer_wishlist_items w
    set last_in_stock = c.in_stock,
        last_price_cents = c.min_price_cents,
        last_on_deal = c.on_deal,
        last_checked_at = now()
    from changes c
    where w.id = c.id
    returning 1
  )
  select (select count(*) from inserted) into queued;

  return queued;
end;
$$;

revoke all on function public.wishlist_alert_scan() from public, anon, authenticated;
grant execute on function public.wishlist_alert_scan() to service_role;

-- Every 15 minutes; the worker itself enforces the per-customer 3h spacing.
select cron.schedule(
  'geega-wishlist-alert-worker',
  '*/15 * * * *',
  $cmd$
    select extensions.http_post(
      'https://geega-games.vercel.app/api/wishlist-alerts/process',
      '{}',
      'application/json'
    );
  $cmd$
);
