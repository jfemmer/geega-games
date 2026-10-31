-- Trade Center: tell shoppers why a card is held for a trade, and let them
-- ask to be emailed if that copy comes back.
--
-- Since 20261031070000_trade_hold_from_sending.sql, a trade holds our cards
-- from the moment it's sent, so a shopper can find a card (on its page, in
-- their cart, at checkout) that they can't buy because a trade is holding it.
-- This adds:
--
--   trade_held_copies(p_oracle_id, p_ids)
--     Public. The copies of a card (by oracle id) or the cart lines (by
--     inventory item id) that a trade is holding: what the copy is, how many
--     are held and how many can still be bought. Counts only: nothing about
--     the trade or who sent it.
--
--   trade_hold_watchers
--     Server-only (RLS on, no policies, no grants): "email me if this copy is
--     released". One row per copy and email. Written by
--     api/stock-alerts/hold-watch.ts, drained by api/stock-alerts/process.ts.
--
--   trade_hold_watchers_due(p_limit)
--     Server-only. The watchers with something to do:
--       released  the copy can be bought again: email once, mark notified;
--       gone      the copy is gone (the trade went through, it was archived or
--                 sold) with nothing holding it: close quietly;
--       expired   still held after 120 days: close quietly.
--     Watchers whose copy is still held are left alone. armed_at is when the
--     shopper (last) asked, so asking again after an email gets a new one. A copy held by a
--     shopper's checkout or a pickup counts as held, so a checkout that
--     lapses can still release it to a watcher.
--
-- Safe to run more than once.

create table if not exists public.trade_hold_watchers (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  card_name text not null,
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  closed_at timestamptz,
  closed_reason text check (closed_reason is null or closed_reason in ('gone', 'expired')),
  unique (inventory_item_id, email)
);

create index if not exists trade_hold_watchers_pending_idx
  on public.trade_hold_watchers (created_at)
  where notified_at is null and closed_at is null;

alter table public.trade_hold_watchers enable row level security;
revoke all on table public.trade_hold_watchers from public, anon, authenticated;

comment on table public.trade_hold_watchers is
  'Shoppers who asked to be emailed if a copy held for a trade is released (server-only).';

-- ------------------------------------------------------------ trade_held_copies

create or replace function public.trade_held_copies(p_oracle_id uuid default null, p_ids uuid[] default null)
returns table(
  id uuid, card_name text, set_code text, set_name text, collector_number text,
  condition public.card_condition, finish public.card_finish, variant_type text, image_url text,
  price_cents integer, held_quantity integer, sellable_quantity integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with items as (
    select i.*
    from public.inventory_items i
    where i.status = 'active'
      and (
        (p_oracle_id is not null and i.oracle_id = p_oracle_id)
        or (p_ids is not null and cardinality(p_ids) <= 500 and i.id = any(p_ids))
      )
  ),
  res as (
    select r.inventory_item_id,
           coalesce(sum(r.quantity) filter (where r.trade_request_id is not null), 0)::int as trade_qty,
           sum(r.quantity)::int as all_qty
    from public.inventory_reservations r
    join items on items.id = r.inventory_item_id
    where r.status = 'active'
    group by r.inventory_item_id
  )
  select i.id, i.card_name, i.set_code, i.set_name, i.collector_number,
         i.condition, i.finish, i.variant_type, i.image_url,
         public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal, i.ownership),
         least(res.trade_qty, greatest(i.quantity, 0))::int,
         greatest(i.quantity - res.all_qty, 0)::int
  from items i
  join res on res.inventory_item_id = i.id
  where res.trade_qty > 0 and i.quantity > 0
  order by i.set_name nulls last, i.collector_number, i.condition, i.finish;
$$;

revoke all on function public.trade_held_copies(uuid, uuid[]) from public;
grant execute on function public.trade_held_copies(uuid, uuid[]) to anon, authenticated, service_role;

-- ------------------------------------------------------------ trade_hold_watchers_due

create or replace function public.trade_hold_watchers_due(p_limit integer default 50)
returns table(
  id uuid, inventory_item_id uuid, email text, card_name text, set_name text,
  condition public.card_condition, finish public.card_finish, state text, armed_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with pending as (
    select w.*
    from public.trade_hold_watchers w
    where w.notified_at is null and w.closed_at is null
  ),
  res as (
    select r.inventory_item_id, sum(r.quantity)::int as all_qty
    from public.inventory_reservations r
    join pending p on p.inventory_item_id = r.inventory_item_id
    where r.status = 'active'
    group by r.inventory_item_id
  ),
  states as (
    select p.id, p.inventory_item_id, p.email, coalesce(i.card_name, p.card_name) as card_name,
           i.set_name, i.condition, i.finish, p.created_at,
           case
             when i.id is null or i.status <> 'active' then 'gone'
             when i.quantity - coalesce(res.all_qty, 0) > 0 then 'released'
             when coalesce(res.all_qty, 0) = 0 then 'gone'
             when p.created_at < now() - interval '120 days' then 'expired'
             else 'held'
           end as state
    from pending p
    left join public.inventory_items i on i.id = p.inventory_item_id
    left join res on res.inventory_item_id = p.inventory_item_id
  )
  select s.id, s.inventory_item_id, s.email, s.card_name, s.set_name, s.condition, s.finish, s.state, s.created_at
  from states s
  where s.state <> 'held'
  order by s.created_at
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.trade_hold_watchers_due(integer) from public, anon, authenticated;
grant execute on function public.trade_hold_watchers_due(integer) to service_role;
