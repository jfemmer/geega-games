-- Consignments, Phase 1: the foundation.
--
-- What this adds:
--   1. Consignors, consignments and consignment lots (a lot = identical copies
--      from one consignor on one consignment).
--   2. An explicit owner on every inventory row: 'business' or 'consigned'.
--      A consigned row points at its lot. Consigned copies always live on
--      their own inventory row, never merged with ours, so five copies of a
--      card can be two of ours (one row) and three of a consignor's (another).
--   3. Owner guards: a row's owner can't be changed in place, consigned rows
--      can only be created by the receiving flow, and admin_upsert_inventory
--      only ever tops up OUR rows.
--   4. Consigned stock is sale-only. Every trade path refuses it:
--        * trade_available() reports 0 free for a consigned row, which covers
--          trade_put_line, trade_short_lines, trade_reserve_core and
--          trade_reinstate;
--        * triggers refuse a consigned row on a trade line, a trade hold, and
--          a Trade Evaluator trade (trades.your_cards), whatever path writes it.
--   5. Consignment settings: effective-dated fee schedules per sales channel,
--      USPS insurance schedules and commission tiers (a schedule can't be
--      edited once it takes effect: add a new one), plus one row of estimator
--      and term settings. Seeded with the starting rates.
--   6. The payout math in SQL (commission, insurance), matching
--      src/store/lib/consignmentMath.ts, and consignment_estimator_settings()
--      for the payout estimator.
--
-- Nothing is listed, sold or paid here: agreements and signing (Phase 2),
-- receiving (Phase 3) and sales and payouts (Phase 4) build on this.
-- No existing row changes owner: every current inventory row becomes
-- 'business'. Run after 20261028030000. Safe to run more than once.
--
-- Error codes: GC001-GC009 ownership; GC010-GC019 settings; GT004 (the Trade
-- Center's "not available") for trade refusals, so existing API mapping
-- shows the message to the customer.

-- ============================================================ consignors

create table if not exists public.consignors (
  id uuid primary key default gen_random_uuid(),
  -- The customer account, once they have one. Invited customers get linked
  -- when they sign in to sign their agreement (Phase 2).
  user_id uuid unique references auth.users(id) on delete restrict,
  legal_name text not null check (char_length(btrim(legal_name)) between 2 and 200),
  email text not null check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and char_length(email) <= 254),
  phone text check (phone is null or char_length(btrim(phone)) between 7 and 30),
  address_line1 text check (address_line1 is null or char_length(address_line1) <= 200),
  address_line2 text check (address_line2 is null or char_length(address_line2) <= 200),
  city text check (city is null or char_length(city) <= 100),
  state_code text check (state_code is null or state_code ~ '^[A-Z]{2}$'),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  admin_notes text check (admin_notes is null or char_length(admin_notes) <= 4000),
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now()
);
create unique index if not exists consignors_email_idx on public.consignors (lower(email));
comment on table public.consignors is
  'People who consign cards to Geega Games. Written only by the API (service_role); staff read via RLS; a consignor reads their own record through my_* functions (Phase 2).';

create table if not exists public.consignments (
  id uuid primary key default gen_random_uuid(),
  consignment_number bigint generated always as identity (start with 1001) unique,
  consignor_id uuid not null references public.consignors(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'awaiting_signature', 'signed', 'inventory_received', 'active', 'terminated', 'closed')),
  -- Set only by the signing flow (Phase 2). Nothing can reach signed, received
  -- or active without it: an unsigned consignment can never be activated.
  signed_at timestamptz,
  -- The 90-day term starts when accepted cards are first posted (agreement 7.1).
  term_started_at timestamptz,
  initial_term_days integer not null default 90 check (initial_term_days between 1 and 3650),
  admin_notes text check (admin_notes is null or char_length(admin_notes) <= 4000),
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  constraint consignments_signed_before_active
    check (status not in ('signed', 'inventory_received', 'active') or signed_at is not null)
);
create index if not exists consignments_consignor_idx on public.consignments (consignor_id);
create index if not exists consignments_status_idx on public.consignments (status);
comment on table public.consignments is
  'One consignment (agreement + the cards under it). Shown to people as GG-C-<consignment_number>. Written only by the API (service_role).';

create table if not exists public.consignment_lots (
  id uuid primary key default gen_random_uuid(),
  consignment_id uuid not null references public.consignments(id) on delete restrict,
  scryfall_id uuid,
  oracle_id uuid,
  card_name text not null check (char_length(btrim(card_name)) between 1 and 200),
  set_code text not null,
  set_name text,
  collector_number text not null,
  condition public.card_condition,
  finish public.card_finish not null default 'nonfoil',
  variant_type text not null default '',
  language text not null default 'en',
  -- What the consignor said they sent, and what we accepted after inspection.
  -- Their numbers are never taken as accepted (agreement 2.5).
  quantity_submitted integer check (quantity_submitted is null or quantity_submitted between 1 and 9999),
  quantity_accepted integer not null default 0 check (quantity_accepted between 0 and 9999),
  status text not null default 'submitted'
    check (status in ('submitted', 'received', 'under_inspection', 'accepted', 'rejected', 'listed', 'reserved_for_sale', 'sold', 'returned')),
  list_price_cents integer check (list_price_cents is null or list_price_cents > 0),
  min_price_cents integer check (min_price_cents is null or min_price_cents > 0),
  internal_notes text check (internal_notes is null or char_length(internal_notes) <= 4000),
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  constraint consignment_lots_min_le_list check (min_price_cents is null or list_price_cents is null or min_price_cents <= list_price_cents)
);
create index if not exists consignment_lots_consignment_idx on public.consignment_lots (consignment_id);
comment on table public.consignment_lots is
  'Identical copies (printing, condition, finish, variant, language) from one consignor on one consignment. Its inventory row is the inventory_items row whose consignment_lot_id is this id.';

drop trigger if exists set_updated_at on public.consignors;
create trigger set_updated_at before update on public.consignors for each row execute function public.tg_set_updated_at();
drop trigger if exists set_updated_at on public.consignments;
create trigger set_updated_at before update on public.consignments for each row execute function public.tg_set_updated_at();
drop trigger if exists set_updated_at on public.consignment_lots;
create trigger set_updated_at before update on public.consignment_lots for each row execute function public.tg_set_updated_at();

-- signed_at is the signing flow's alone: no other write can set, move or clear it.
create or replace function public.tg_consignment_signed_at_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.signed_at is distinct from (case when tg_op = 'INSERT' then null else old.signed_at end)
     and coalesce(current_setting('geega.consignment_signing', true), '') <> 'on' then
    raise exception 'A consignment is marked signed only when the consignor signs the agreement.' using errcode = 'GC003';
  end if;
  return new;
end;
$$;
drop trigger if exists consignment_signed_at_guard on public.consignments;
create trigger consignment_signed_at_guard before insert or update on public.consignments
  for each row execute function public.tg_consignment_signed_at_guard();

alter table public.consignors enable row level security;
alter table public.consignments enable row level security;
alter table public.consignment_lots enable row level security;
revoke all on public.consignors, public.consignments, public.consignment_lots from anon, authenticated;
grant select on public.consignors, public.consignments, public.consignment_lots to authenticated;
drop policy if exists consignors_staff_read on public.consignors;
create policy consignors_staff_read on public.consignors for select to authenticated using (public.is_staff());
drop policy if exists consignments_staff_read on public.consignments;
create policy consignments_staff_read on public.consignments for select to authenticated using (public.is_staff());
drop policy if exists consignment_lots_staff_read on public.consignment_lots;
create policy consignment_lots_staff_read on public.consignment_lots for select to authenticated using (public.is_staff());

-- ============================================================ inventory ownership

alter table public.inventory_items
  add column if not exists ownership text not null default 'business',
  add column if not exists consignment_lot_id uuid;

alter table public.inventory_items drop constraint if exists inventory_items_ownership_check;
alter table public.inventory_items add constraint inventory_items_ownership_check
  check (ownership in ('business', 'consigned'));
alter table public.inventory_items drop constraint if exists inventory_items_consignment_lot_fkey;
alter table public.inventory_items add constraint inventory_items_consignment_lot_fkey
  foreign key (consignment_lot_id) references public.consignment_lots(id) on delete restrict;
alter table public.inventory_items drop constraint if exists inventory_items_consigned_has_lot;
alter table public.inventory_items add constraint inventory_items_consigned_has_lot
  check ((ownership = 'consigned') = (consignment_lot_id is not null));
create unique index if not exists inventory_items_consignment_lot_idx
  on public.inventory_items (consignment_lot_id) where consignment_lot_id is not null;
create index if not exists inventory_items_consigned_idx
  on public.inventory_items (ownership) where ownership = 'consigned';

comment on column public.inventory_items.ownership is
  'Who owns these copies: business (Geega Games) or consigned (a consignor; see consignment_lot_id). Consigned copies are sale-only: never traded. Changed only through an authorized, audited transfer.';
comment on column public.inventory_items.consignment_lot_id is
  'For consigned rows: the consignment lot these copies belong to. One inventory row per lot.';

-- The owner of a row is fixed: staff edits (RLS lets staff update rows), the
-- inventory editor, scans and imports can't flip it. Consigned rows are made
-- only by the receiving flow, and removed only by it.
create or replace function public.tg_inventory_ownership_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.ownership = 'consigned' and coalesce(current_setting('geega.consignment_write', true), '') <> 'on' then
      raise exception 'Consigned cards are added through Consignments > Receive Cards, not here.' using errcode = 'GC001';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.ownership = 'consigned' and coalesce(current_setting('geega.consignment_write', true), '') <> 'on' then
      raise exception 'Consigned cards belong to a consignor and can''t be deleted. Return them through Consignments.' using errcode = 'GC001';
    end if;
    return old;
  end if;
  if (new.ownership is distinct from old.ownership or new.consignment_lot_id is distinct from old.consignment_lot_id)
     and coalesce(current_setting('geega.ownership_transfer', true), '') <> 'on' then
    raise exception 'Who owns an inventory row can''t be changed here. Ownership changes go through an authorized, audited consignment transfer.' using errcode = 'GC002';
  end if;
  return new;
end;
$$;
drop trigger if exists inventory_ownership_guard on public.inventory_items;
create trigger inventory_ownership_guard before insert or update or delete on public.inventory_items
  for each row execute function public.tg_inventory_ownership_guard();

create or replace function public.inventory_is_consigned(p_inventory_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((select i.ownership = 'consigned' from public.inventory_items i where i.id = p_inventory_item_id), false);
$$;
revoke all on function public.inventory_is_consigned(uuid) from public, anon, authenticated;
grant execute on function public.inventory_is_consigned(uuid) to service_role;

-- Stock top-ups (Add Card, scans, imports, trade-ins) only ever merge into
-- OUR rows: a consigned row with the same printing and condition is never
-- matched, so our copies can't land on a consignor's row or the reverse.
-- Production's definition with one added condition (i.ownership = 'business').
create or replace function public.admin_upsert_inventory(
  p_scryfall_id uuid, p_oracle_id uuid, p_card_name text, p_set_code text, p_set_name text,
  p_collector_number text, p_rarity text, p_type_line text, p_image_url text,
  p_condition public.card_condition, p_finish public.card_finish, p_quantity integer, p_price_cents integer,
  p_cost_cents integer default null::integer, p_scryfall_price_cents integer default null::integer,
  p_storage_location text default null::text, p_sku text default null::text, p_notes text default null::text,
  p_variant_type text default ''::text, p_language text default 'en'::text,
  p_colors text[] default '{}'::text[], p_creature_types text[] default '{}'::text[],
  p_actor text default null::text, p_reason public.inventory_movement_reason default 'manual_add'::public.inventory_movement_reason
)
returns public.inventory_items
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.inventory_items;
  v_prev integer;
begin
  if not public.inventory_write_authorized() then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1';
  end if;

  select * into v_row
  from public.inventory_items i
  where i.status = 'active'
    and i.ownership = 'business'
    and i.condition = p_condition
    and i.finish = p_finish
    and coalesce(i.variant_type, '') = coalesce(p_variant_type, '')
    and coalesce(i.language, 'en') = coalesce(p_language, 'en')
    and (
      (p_scryfall_id is not null and i.scryfall_id = p_scryfall_id)
      or (p_scryfall_id is null and i.scryfall_id is null
          and i.set_code = p_set_code
          and i.collector_number = p_collector_number)
    )
  limit 1
  for update;

  if found then
    v_prev := v_row.quantity;
    update public.inventory_items
      set quantity = quantity + p_quantity,
          price_cents = coalesce(price_cents, p_price_cents),
          image_url = coalesce(image_url, p_image_url),
          scryfall_price_cents = coalesce(p_scryfall_price_cents, scryfall_price_cents)
      where id = v_row.id
      returning * into v_row;
  else
    insert into public.inventory_items (
      scryfall_id, oracle_id, card_name, set_code, set_name, collector_number,
      rarity, type_line, image_url, condition, finish, quantity, price_cents,
      cost_cents, scryfall_price_cents, storage_location, sku, notes,
      variant_type, language, colors, creature_types, status, ownership
    ) values (
      p_scryfall_id, p_oracle_id, p_card_name, p_set_code, p_set_name,
      p_collector_number, p_rarity, p_type_line, p_image_url, p_condition,
      p_finish, p_quantity, p_price_cents, p_cost_cents, p_scryfall_price_cents,
      p_storage_location, p_sku, p_notes, coalesce(p_variant_type, ''),
      coalesce(p_language, 'en'), coalesce(p_colors, '{}'),
      coalesce(p_creature_types, '{}'), 'active', 'business'
    )
    returning * into v_row;
    v_prev := 0;
  end if;

  insert into public.inventory_movements (
    inventory_item_id, card_name, delta, previous_quantity, resulting_quantity,
    reason, actor
  ) values (
    v_row.id, v_row.card_name, p_quantity, v_prev, v_row.quantity, p_reason, p_actor
  );
  return v_row;
end;
$function$;

-- ============================================================ consigned stock is never traded

-- How many of an inventory row a trade could take: 0 for consigned copies.
-- Every trade path that checks stock goes through here (trade_put_line,
-- trade_short_lines, trade_reserve_core, trade_reinstate).
-- Production's definition with one added condition (i.ownership <> 'business').
create or replace function public.trade_available(p_inventory_item_id uuid, p_trade_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when i.id is null or i.status <> 'active' or i.ownership <> 'business'
      or coalesce(public.trade_regular_price(i.price_cents, i.original_price_cents, i.is_deal), 0) <= 0 then 0
    else greatest(i.quantity - coalesce((
      select sum(r.quantity) from public.inventory_reservations r
      where r.inventory_item_id = i.id and r.status = 'active'
        and r.trade_request_id is distinct from p_trade_id
    ), 0), 0)::int
  end
  from (select 1) one
  left join public.inventory_items i on i.id = p_inventory_item_id;
$function$;

-- Last line of defence: whatever path writes it, no trade line, trade hold or
-- Trade Evaluator trade can name a consigned row.
create or replace function public.tg_trade_line_not_consigned()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_name text;
begin
  if new.inventory_item_id is null then
    return new;
  end if;
  select i.card_name into v_name from public.inventory_items i
    where i.id = new.inventory_item_id and i.ownership = 'consigned';
  if found then
    raise exception '% is a consigned card. Consigned cards are for sale only, not for trade.', v_name using errcode = 'GT004';
  end if;
  return new;
end;
$$;

create or replace function public.tg_trade_hold_not_consigned()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_name text;
begin
  if new.trade_request_id is null or new.status <> 'active' then
    return new;
  end if;
  select i.card_name into v_name from public.inventory_items i
    where i.id = new.inventory_item_id and i.ownership = 'consigned';
  if found then
    raise exception '% is a consigned card. Consigned cards can''t be held for a trade.', v_name using errcode = 'GT004';
  end if;
  return new;
end;
$$;

create or replace function public.tg_evaluator_trade_not_consigned()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_name text;
begin
  select i.card_name into v_name
  from jsonb_array_elements(coalesce(new.your_cards, '[]'::jsonb)) c
  join public.inventory_items i on i.id::text = c ->> 'inventoryItemId'
  where i.ownership = 'consigned'
  limit 1;
  if found then
    raise exception '% is a consigned card. Consigned cards are for sale only, not for trade.', v_name using errcode = 'GT004';
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.trade_request_items') is not null then
    execute 'drop trigger if exists trade_line_not_consigned on public.trade_request_items';
    execute 'create trigger trade_line_not_consigned before insert or update of inventory_item_id on public.trade_request_items
             for each row execute function public.tg_trade_line_not_consigned()';
  end if;
  if to_regclass('public.inventory_reservations') is not null
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'inventory_reservations' and column_name = 'trade_request_id') then
    execute 'drop trigger if exists trade_hold_not_consigned on public.inventory_reservations';
    execute 'create trigger trade_hold_not_consigned before insert or update on public.inventory_reservations
             for each row execute function public.tg_trade_hold_not_consigned()';
  end if;
  if to_regclass('public.trades') is not null then
    execute 'drop trigger if exists evaluator_trade_not_consigned on public.trades';
    execute 'create trigger evaluator_trade_not_consigned before insert or update of your_cards on public.trades
             for each row execute function public.tg_evaluator_trade_not_consigned()';
  end if;
end;
$$;

-- ============================================================ settings

-- Fee schedules by sales channel, effective-dated. The one in force at a time
-- is the newest with effective_from <= that time. Estimates use them; final
-- payouts use each sale's actual fees, and signed agreements keep a copy of
-- the schedule they were signed under (Phase 2), so a new schedule never
-- changes a past payout or a signed agreement.
create table if not exists public.consignment_fee_schedules (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('website', 'tcgplayer', 'ebay')),
  effective_from timestamptz not null,
  marketplace_bps integer not null check (marketplace_bps between 0 and 5000),
  marketplace_threshold_cents integer check (marketplace_threshold_cents is null or marketplace_threshold_cents > 0),
  marketplace_above_threshold_bps integer check (marketplace_above_threshold_bps is null or marketplace_above_threshold_bps between 0 and 5000),
  marketplace_base text not null default 'item' check (marketplace_base in ('item', 'item_shipping', 'item_shipping_tax')),
  per_order_cents integer not null default 0 check (per_order_cents between 0 and 10000),
  per_order_small_cents integer check (per_order_small_cents is null or per_order_small_cents between 0 and 10000),
  per_order_small_max_cents integer check (per_order_small_max_cents is null or per_order_small_max_cents > 0),
  processing_bps integer not null default 0 check (processing_bps between 0 and 2000),
  processing_fixed_cents integer not null default 0 check (processing_fixed_cents between 0 and 1000),
  processing_base text not null default 'item_shipping_tax' check (processing_base in ('item', 'item_shipping', 'item_shipping_tax')),
  source_note text check (source_note is null or char_length(source_note) <= 1000),
  created_at timestamptz not null default now(),
  created_by text,
  unique (channel, effective_from),
  check ((marketplace_threshold_cents is null) = (marketplace_above_threshold_bps is null)),
  check ((per_order_small_cents is null) = (per_order_small_max_cents is null))
);
comment on table public.consignment_fee_schedules is
  'What each sales channel charges, for estimates and agreement disclosures. Effective-dated; locked once in effect. Written only by the API (service_role).';

create table if not exists public.consignment_insurance_schedules (
  id uuid primary key default gen_random_uuid(),
  effective_from timestamptz not null unique,
  service text not null default 'USPS Ground Advantage',
  included_coverage_cents integer not null check (included_coverage_cents >= 0),
  -- Ascending [{ "maxValueCents": 20000, "premiumCents": 450 }, ...] by total package value.
  brackets jsonb not null,
  -- Above the last bracket: + step_premium_cents per step_cents (or part of one).
  step_cents integer not null check (step_cents > 0),
  step_premium_cents integer not null check (step_premium_cents >= 0),
  max_insurable_cents integer not null check (max_insurable_cents > 0),
  source_url text,
  source_note text check (source_note is null or char_length(source_note) <= 1000),
  created_at timestamptz not null default now(),
  created_by text
);
comment on table public.consignment_insurance_schedules is
  'Published carrier insurance rates for estimates. Actual premiums come from the label. Effective-dated; locked once in effect.';

create table if not exists public.consignment_commission_schedules (
  id uuid primary key default gen_random_uuid(),
  effective_from timestamptz not null unique,
  -- [{ "maxPriceCents": 15000, "rateBps": 2000 }, { "maxPriceCents": null, "rateBps": 1000 }]
  tiers jsonb not null,
  source_note text check (source_note is null or char_length(source_note) <= 1000),
  created_at timestamptz not null default now(),
  created_by text
);
comment on table public.consignment_commission_schedules is
  'Commission tiers offered in NEW agreements. A signed agreement keeps the tiers it was signed with.';

create table if not exists public.consignment_settings (
  id boolean primary key default true check (id),
  -- Typical USPS Ground Advantage postage for one card, labelled as an estimate.
  default_postage_cents integer not null default 500 check (default_postage_cents between 0 and 10000),
  -- What a buyer typically pays on a one-card order, per channel:
  -- { "website": { "shippingCents": 550, "freeShippingAtCents": 7500, "salesTaxBps": 0 }, ... }
  -- Sales tax matters because some channels charge fees on it (eBay); our own
  -- checkout doesn't charge it, the marketplaces collect it.
  buyer_terms jsonb not null default '{}'::jsonb check (jsonb_typeof(buyer_terms) = 'object'),
  -- Estimator only: whether the insurance toggle starts on. Never changes anyone's election.
  estimator_insurance_default boolean not null default false,
  min_card_value_cents integer not null default 0 check (min_card_value_cents >= 0),
  initial_term_days integer not null default 90 check (initial_term_days between 1 and 3650),
  inspection_days integer not null default 3 check (inspection_days between 0 and 60),
  payout_methods text[] not null default array['paypal', 'venmo', 'zelle', 'check']
    check (payout_methods <@ array['paypal', 'venmo', 'zelle', 'check', 'ach', 'store_credit'] and cardinality(payout_methods) >= 1),
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.consignment_settings is
  'One row: estimator defaults, minimum card value, term, inspection period and payout methods for NEW agreements. Written only by the API.';
drop trigger if exists set_updated_at on public.consignment_settings;
create trigger set_updated_at before update on public.consignment_settings for each row execute function public.tg_set_updated_at();

-- A schedule that has taken effect is history: it can't be edited or removed.
-- A new one can start now or later, never in the past.
create or replace function public.tg_consignment_schedule_lock()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.effective_from <= now() then
    raise exception 'This schedule is already in effect, so it can''t be changed or removed. Add a new schedule that starts later.' using errcode = 'GC010';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.effective_from < now() - interval '5 minutes'
     and coalesce(current_setting('geega.schedule_seed', true), '') <> 'on' then
    raise exception 'A schedule can start now or later, not in the past.' using errcode = 'GC011';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Tier and bracket lists must be well formed: ascending, positive, one open top tier.
create or replace function public.consignment_valid_tiers(p_tiers jsonb)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select jsonb_typeof(p_tiers) = 'array'
    and jsonb_array_length(p_tiers) between 1 and 10
    and not exists (
      select 1 from jsonb_array_elements(p_tiers) t
      where jsonb_typeof(t -> 'rateBps') <> 'number'
        or (t ->> 'rateBps')::numeric not between 0 and 5000
        or (t ->> 'rateBps')::numeric <> trunc((t ->> 'rateBps')::numeric)
        or (t -> 'maxPriceCents' is not null and jsonb_typeof(t -> 'maxPriceCents') not in ('number', 'null'))
        or (jsonb_typeof(t -> 'maxPriceCents') = 'number' and (t ->> 'maxPriceCents')::numeric <= 0)
    )
    and (select count(*) from jsonb_array_elements(p_tiers) t where jsonb_typeof(t -> 'maxPriceCents') = 'number')
        = jsonb_array_length(p_tiers) - 1
    and (select count(distinct (t ->> 'maxPriceCents')) from jsonb_array_elements(p_tiers) t where jsonb_typeof(t -> 'maxPriceCents') = 'number')
        = jsonb_array_length(p_tiers) - 1;
$$;

create or replace function public.consignment_valid_brackets(p_brackets jsonb)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select jsonb_typeof(p_brackets) = 'array'
    and jsonb_array_length(p_brackets) between 1 and 40
    and not exists (
      select 1 from jsonb_array_elements(p_brackets) b
      where jsonb_typeof(b -> 'maxValueCents') <> 'number' or jsonb_typeof(b -> 'premiumCents') <> 'number'
        or (b ->> 'maxValueCents')::numeric <= 0 or (b ->> 'premiumCents')::numeric < 0
        or (b ->> 'maxValueCents')::numeric <> trunc((b ->> 'maxValueCents')::numeric)
        or (b ->> 'premiumCents')::numeric <> trunc((b ->> 'premiumCents')::numeric)
    )
    and (select count(distinct (b ->> 'maxValueCents')) from jsonb_array_elements(p_brackets) b) = jsonb_array_length(p_brackets);
$$;

alter table public.consignment_commission_schedules drop constraint if exists consignment_commission_schedules_tiers_check;
alter table public.consignment_commission_schedules add constraint consignment_commission_schedules_tiers_check
  check (public.consignment_valid_tiers(tiers));
alter table public.consignment_insurance_schedules drop constraint if exists consignment_insurance_schedules_brackets_check;
alter table public.consignment_insurance_schedules add constraint consignment_insurance_schedules_brackets_check
  check (public.consignment_valid_brackets(brackets));

drop trigger if exists schedule_lock on public.consignment_fee_schedules;
create trigger schedule_lock before insert or update or delete on public.consignment_fee_schedules
  for each row execute function public.tg_consignment_schedule_lock();
drop trigger if exists schedule_lock on public.consignment_insurance_schedules;
create trigger schedule_lock before insert or update or delete on public.consignment_insurance_schedules
  for each row execute function public.tg_consignment_schedule_lock();
drop trigger if exists schedule_lock on public.consignment_commission_schedules;
create trigger schedule_lock before insert or update or delete on public.consignment_commission_schedules
  for each row execute function public.tg_consignment_schedule_lock();

alter table public.consignment_fee_schedules enable row level security;
alter table public.consignment_insurance_schedules enable row level security;
alter table public.consignment_commission_schedules enable row level security;
alter table public.consignment_settings enable row level security;
revoke all on public.consignment_fee_schedules, public.consignment_insurance_schedules,
  public.consignment_commission_schedules, public.consignment_settings from anon, authenticated;
grant select on public.consignment_fee_schedules, public.consignment_insurance_schedules,
  public.consignment_commission_schedules, public.consignment_settings to authenticated;
drop policy if exists fee_schedules_staff_read on public.consignment_fee_schedules;
create policy fee_schedules_staff_read on public.consignment_fee_schedules for select to authenticated using (public.is_staff());
drop policy if exists insurance_schedules_staff_read on public.consignment_insurance_schedules;
create policy insurance_schedules_staff_read on public.consignment_insurance_schedules for select to authenticated using (public.is_staff());
drop policy if exists commission_schedules_staff_read on public.consignment_commission_schedules;
create policy commission_schedules_staff_read on public.consignment_commission_schedules for select to authenticated using (public.is_staff());
drop policy if exists consignment_settings_staff_read on public.consignment_settings;
create policy consignment_settings_staff_read on public.consignment_settings for select to authenticated using (public.is_staff());

-- Starting rates. Estimates only, and every one is editable by adding a new
-- schedule. Sources:
--   website: card processing at Stripe's standard US online rate, 2.9% + $0.30
--            on the whole charge. Confirm against the account's actual pricing.
--   TCGplayer: the published seller estimate given by the owner: 10.75%
--            commission, 2.5% + $0.30 processing. Account programs may differ.
--   eBay: trading-card final value fee for sellers without a Store, 13.25% of
--         the total sale up to $7,500 per item and 2.35% above, plus $0.30 per
--         order ($0.40 over $10). The total includes shipping and sales tax,
--         and payment processing is included (ebay.com/help, Store selling fees, id 4809).
--   USPS insurance: the owner's Ground Advantage estimate table, effective
--         2026-10-04 (pe.usps.com/text/dmm300/Notice123.htm).
do $$
begin
  perform set_config('geega.schedule_seed', 'on', true);

  insert into public.consignment_fee_schedules
    (channel, effective_from, marketplace_bps, marketplace_threshold_cents, marketplace_above_threshold_bps, marketplace_base,
     per_order_cents, per_order_small_cents, per_order_small_max_cents, processing_bps, processing_fixed_cents, processing_base, source_note, created_by)
  values
    ('website', '2026-10-01 00:00:00-05', 0, null, null, 'item', 0, null, null, 290, 30, 'item_shipping_tax',
     'Card processing at Stripe''s standard US online rate (2.9% + $0.30). Confirm against the account''s pricing.', 'migration'),
    ('tcgplayer', '2026-10-01 00:00:00-05', 1075, null, null, 'item_shipping', 0, null, null, 250, 30, 'item_shipping_tax',
     'TCGplayer standard seller estimate: 10.75% commission, 2.5% + $0.30 processing. Account programs, Pro and fee caps may differ.', 'migration'),
    ('ebay', '2026-10-01 00:00:00-05', 1325, 750000, 235, 'item_shipping_tax', 40, 30, 1000, 0, 0, 'item_shipping_tax',
     'eBay trading cards, no Store: 13.25% up to $7,500 per item, 2.35% above; $0.40 per order ($0.30 at $10 or less). Charged on the total incl. shipping and sales tax; processing included.', 'migration')
  on conflict (channel, effective_from) do nothing;

  insert into public.consignment_insurance_schedules
    (effective_from, service, included_coverage_cents, brackets, step_cents, step_premium_cents, max_insurable_cents, source_url, source_note, created_by)
  values
    ('2026-10-04 00:00:00-05', 'USPS Ground Advantage', 10000,
     '[{"maxValueCents":10000,"premiumCents":0},{"maxValueCents":20000,"premiumCents":450},{"maxValueCents":30000,"premiumCents":455},{"maxValueCents":40000,"premiumCents":605},{"maxValueCents":50000,"premiumCents":755},{"maxValueCents":60000,"premiumCents":905}]'::jsonb,
     10000, 150, 500000,
     'https://pe.usps.com/text/dmm300/Notice123.htm',
     'Estimate table for Ground Advantage with $100 included coverage. Actual premium is what USPS charges when the label is bought.', 'migration')
  on conflict (effective_from) do nothing;

  insert into public.consignment_commission_schedules (effective_from, tiers, source_note, created_by)
  values ('2026-10-01 00:00:00-05',
          '[{"maxPriceCents":15000,"rateBps":2000},{"maxPriceCents":null,"rateBps":1000}]'::jsonb,
          '20% of the Net Sale Amount for a card sold at $150.00 or less; 10% at $150.01 or more.', 'migration')
  on conflict (effective_from) do nothing;

  -- Website: the checkout's own tracked shipping ($5.50, free at $75) and no
  -- sales tax. TCGplayer and eBay: no buyer shipping assumed until staff set
  -- what the shop charges there (so the estimate errs low), 7% average tax.
  insert into public.consignment_settings (id, buyer_terms)
  values (true, '{"website":{"shippingCents":550,"freeShippingAtCents":7500,"salesTaxBps":0},"tcgplayer":{"shippingCents":0,"freeShippingAtCents":null,"salesTaxBps":700},"ebay":{"shippingCents":0,"freeShippingAtCents":null,"salesTaxBps":700}}'::jsonb)
  on conflict (id) do nothing;

  perform set_config('geega.schedule_seed', '', true);
end;
$$;

-- ============================================================ payout math (mirrors consignmentMath.ts)

-- amount × bps / 10000, nearest cent, halves up.
create or replace function public.consignment_apply_bps(p_amount_cents bigint, p_bps integer)
returns integer
language sql
immutable
set search_path to ''
as $$
  select case
    when p_amount_cents is null or p_bps is null then 0
    when p_amount_cents * p_bps >= 0 then floor((p_amount_cents * p_bps + 5000) / 10000.0)::int
    else -floor((-(p_amount_cents * p_bps) + 5000) / 10000.0)::int
  end;
$$;

-- The commission rate for one card, chosen by its Final Selling Price.
create or replace function public.consignment_commission_rate_bps(p_final_price_cents integer, p_tiers jsonb)
returns integer
language sql
immutable
set search_path to ''
as $$
  select coalesce(
    (select (t ->> 'rateBps')::int
       from jsonb_array_elements(p_tiers) t
      where jsonb_typeof(t -> 'maxPriceCents') <> 'number' or p_final_price_cents <= (t ->> 'maxPriceCents')::int
      order by case when jsonb_typeof(t -> 'maxPriceCents') = 'number' then (t ->> 'maxPriceCents')::int end asc nulls last
      limit 1),
    0);
$$;

-- Commission on a Net Sale Amount (0 when there's nothing left after expenses).
create or replace function public.consignment_commission_cents(p_final_price_cents integer, p_net_sale_cents integer, p_tiers jsonb)
returns integer
language sql
immutable
set search_path to ''
as $$
  select case when coalesce(p_net_sale_cents, 0) <= 0 then 0
    else public.consignment_apply_bps(p_net_sale_cents, public.consignment_commission_rate_bps(p_final_price_cents, p_tiers)) end;
$$;

-- Additional insurance for a whole package by its total value, under one schedule.
create or replace function public.consignment_insurance_premium(p_package_value_cents integer, p_schedule_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  s public.consignment_insurance_schedules%rowtype;
  v_value integer := greatest(coalesce(p_package_value_cents, 0), 0);
  v_insured integer;
  v_premium integer;
  v_last_max integer;
  v_last_premium integer;
begin
  select * into s from public.consignment_insurance_schedules where id = p_schedule_id;
  if not found then
    raise exception 'That insurance schedule isn''t there.' using errcode = 'GC012';
  end if;
  if v_value <= s.included_coverage_cents then
    return jsonb_build_object('premiumCents', 0, 'includedOnly', true, 'needsManualReview', false, 'coveredValueCents', v_value);
  end if;
  v_insured := least(v_value, s.max_insurable_cents);
  select (b ->> 'premiumCents')::int into v_premium
    from jsonb_array_elements(s.brackets) b
   where v_insured <= (b ->> 'maxValueCents')::int
   order by (b ->> 'maxValueCents')::int
   limit 1;
  if v_premium is null then
    select (b ->> 'maxValueCents')::int, (b ->> 'premiumCents')::int into v_last_max, v_last_premium
      from jsonb_array_elements(s.brackets) b
     order by (b ->> 'maxValueCents')::int desc
     limit 1;
    v_premium := coalesce(v_last_premium, 0)
      + ceil((v_insured - coalesce(v_last_max, s.included_coverage_cents))::numeric / s.step_cents)::int * s.step_premium_cents;
  end if;
  return jsonb_build_object(
    'premiumCents', v_premium,
    'includedOnly', v_premium = 0,
    'needsManualReview', v_value > s.max_insurable_cents,
    'coveredValueCents', v_insured
  );
end;
$$;

-- Everything the payout estimator needs, as of a moment: the fee schedule per
-- channel, the insurance schedule, commission tiers and estimator settings.
-- Rates are public information (they're in the agreement), so anyone may read
-- the current ones; nothing personal is returned.
create or replace function public.consignment_estimator_settings(p_at timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'asOf', p_at,
    'channels', coalesce((
      select jsonb_object_agg(f.channel, jsonb_build_object(
        'id', f.id,
        'channel', f.channel,
        'effectiveFrom', f.effective_from,
        'marketplaceBps', f.marketplace_bps,
        'marketplaceThresholdCents', f.marketplace_threshold_cents,
        'marketplaceAboveThresholdBps', f.marketplace_above_threshold_bps,
        'marketplaceBase', f.marketplace_base,
        'perOrderCents', f.per_order_cents,
        'perOrderSmallCents', f.per_order_small_cents,
        'perOrderSmallMaxCents', f.per_order_small_max_cents,
        'processingBps', f.processing_bps,
        'processingFixedCents', f.processing_fixed_cents,
        'processingBase', f.processing_base,
        'sourceNote', f.source_note))
      from (
        select distinct on (channel) * from public.consignment_fee_schedules
        where effective_from <= p_at order by channel, effective_from desc
      ) f), '{}'::jsonb),
    'insurance', (
      select jsonb_build_object(
        'id', i.id,
        'effectiveFrom', i.effective_from,
        'service', i.service,
        'includedCoverageCents', i.included_coverage_cents,
        'brackets', i.brackets,
        'stepCents', i.step_cents,
        'stepPremiumCents', i.step_premium_cents,
        'maxInsurableCents', i.max_insurable_cents,
        'sourceUrl', i.source_url)
      from public.consignment_insurance_schedules i
      where i.effective_from <= p_at order by i.effective_from desc limit 1),
    'commission', (
      select jsonb_build_object('id', c.id, 'effectiveFrom', c.effective_from, 'tiers', c.tiers)
      from public.consignment_commission_schedules c
      where c.effective_from <= p_at order by c.effective_from desc limit 1),
    'settings', (
      select jsonb_build_object(
        'defaultPostageCents', s.default_postage_cents,
        'buyerTerms', s.buyer_terms,
        'estimatorInsuranceDefault', s.estimator_insurance_default,
        'minCardValueCents', s.min_card_value_cents,
        'initialTermDays', s.initial_term_days,
        'inspectionDays', s.inspection_days,
        'payoutMethods', to_jsonb(s.payout_methods))
      from public.consignment_settings s where s.id)
  );
$$;

revoke all on function public.consignment_apply_bps(bigint, integer) from public;
revoke all on function public.consignment_commission_rate_bps(integer, jsonb) from public;
revoke all on function public.consignment_commission_cents(integer, integer, jsonb) from public;
revoke all on function public.consignment_insurance_premium(integer, uuid) from public, anon, authenticated;
revoke all on function public.consignment_estimator_settings(timestamptz) from public;
grant execute on function public.consignment_apply_bps(bigint, integer) to authenticated, service_role;
grant execute on function public.consignment_commission_rate_bps(integer, jsonb) to authenticated, service_role;
grant execute on function public.consignment_commission_cents(integer, integer, jsonb) to authenticated, service_role;
grant execute on function public.consignment_insurance_premium(integer, uuid) to service_role;
grant execute on function public.consignment_estimator_settings(timestamptz) to anon, authenticated, service_role;
