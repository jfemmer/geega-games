-- Consignments, Phase 5: payout timing, holds, adjustments, shipment
-- insurance, shipping claims, returns of unsold cards and the end of a
-- consignment. Agreement sections 5, 6 and 7.
--
--   Payout timing   The buyer inspection period starts the calendar day after
--                   delivery and ends at 11:59 p.m. Central on its last day
--                   (6.1); proceeds are due the next business day (6.2).
--                   payable_at / payout_due_on follow that rule.
--   Holds           A reported problem holds only that card's proceeds (6.4):
--                   consignment_sale_holds. An open hold blocks settling and paying.
--   Adjustments     Documented refunds, chargebacks, claim payments and
--                   corrections (5.4, 6.5, 6.6): consignment_adjustments, paid
--                   (or recovered) through payouts alongside sales.
--   Shipments       One record per website order holding consigned cards: the
--                   package value, whether additional insurance is needed and
--                   what was bought (5.3, 5.6). Each sale keeps the consignor's
--                   insurance election at the time it sold (5.2).
--   Claims          Lost or damaged packages (5.4, 5.5): consignment_shipping_claims.
--   Returns         Unsold (and declined) cards back to the consignor (7.4):
--                   consignment_returns with their lines, through Requested ->
--                   Removed from sale -> Awaiting shipping payment -> Ready to
--                   ship -> Shipped -> Delivered; and closing a consignment.
--
-- Run after 20261029120000. Safe to run more than once.
-- Error codes: GC080-GC099.

-- ============================================================ payout timing (6.1, 6.2)

-- When a delivered card's proceeds become due: the start of the day after the
-- last inspection day, Central Time.
create or replace function public.consignment_payable_at(p_delivered_at timestamptz, p_inspection_days integer)
returns timestamptz
language sql
stable
set search_path to ''
as $$
  select case when p_delivered_at is null then null
    else (((p_delivered_at at time zone 'America/Chicago')::date + coalesce(p_inspection_days, 3) + 1)::timestamp at time zone 'America/Chicago') end;
$$;

-- The business day payment is initiated: the due day, or Monday when it falls on a weekend.
create or replace function public.consignment_payout_due_on(p_payable_at timestamptz)
returns date
language sql
stable
set search_path to ''
as $$
  select case extract(isodow from d) when 6 then d + 2 when 7 then d + 1 else d end
  from (select (p_payable_at at time zone 'America/Chicago')::date as d) x
  where p_payable_at is not null;
$$;

alter table public.consignment_sales
  add column if not exists payout_due_on date,
  -- The consignor's additional-insurance election when the card sold (5.2).
  add column if not exists insurance_elected boolean,
  -- TCGplayer/eBay: when the marketplace released the funds to us (6.2).
  add column if not exists funds_released_at timestamptz,
  -- A copy lost (or destroyed) in shipping: gone, not back in stock.
  add column if not exists lost boolean not null default false,
  add column if not exists claim_id uuid;

-- Existing open and settled sales move to the rule.
do $$
begin
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_sales
    set payable_at = public.consignment_payable_at(delivered_at, inspection_days),
        payout_due_on = public.consignment_payout_due_on(public.consignment_payable_at(delivered_at, inspection_days))
    where delivered_at is not null and status in ('open', 'settled');
  update public.consignment_sales s
    set insurance_elected = coalesce((public.consignment_current_elections(s.consignment_id) ->> 'additionalInsurance')::boolean, false)
    where s.insurance_elected is null;
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- ============================================================ holds (6.4)

create table if not exists public.consignment_sale_holds (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.consignment_sales(id) on delete restrict,
  consignment_id uuid not null references public.consignments(id) on delete restrict,
  source text not null check (source in ('buyer_report', 'dispute', 'chargeback', 'claim', 'other')),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  claim_id uuid,
  opened_at timestamptz not null default now(),
  opened_by text,
  resolved_at timestamptz,
  resolved_by text,
  resolution text check (resolution is null or char_length(resolution) <= 500),
  constraint consignment_sale_holds_resolved check ((resolved_at is null) = (resolution is null))
);
create index if not exists consignment_sale_holds_sale_idx on public.consignment_sale_holds (sale_id) where resolved_at is null;
create index if not exists consignment_sale_holds_consignment_idx on public.consignment_sale_holds (consignment_id);

-- ============================================================ adjustments (5.4, 6.5, 6.6)

create table if not exists public.consignment_adjustments (
  id uuid primary key default gen_random_uuid(),
  consignment_id uuid not null references public.consignments(id) on delete restrict,
  sale_id uuid references public.consignment_sales(id) on delete restrict,
  kind text not null check (kind in ('claim_payment', 'reversal', 'chargeback', 'refund_costs', 'return_shipping', 'correction', 'goodwill')),
  -- Positive: owed to the consignor. Negative: recovered from them.
  amount_cents integer not null check (amount_cents <> 0 and abs(amount_cents) <= 100000000),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  claim_id uuid,
  payout_id uuid references public.consignment_payouts(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by text,
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 500),
  voided_by text,
  constraint consignment_adjustments_void check ((voided_at is null) = (void_reason is null)),
  constraint consignment_adjustments_void_unpaid check (voided_at is null or payout_id is null)
);
create index if not exists consignment_adjustments_consignment_idx on public.consignment_adjustments (consignment_id);

alter table public.consignment_payouts add column if not exists adjustment_count integer not null default 0;
alter table public.consignment_payouts drop constraint if exists consignment_payouts_sale_count_check;
alter table public.consignment_payouts add constraint consignment_payouts_sale_count_check check (sale_count >= 0);
alter table public.consignment_payouts drop constraint if exists consignment_payouts_has_items;
alter table public.consignment_payouts add constraint consignment_payouts_has_items check (sale_count + adjustment_count >= 1);

-- ============================================================ shipments and insurance (5.3, 5.6)

create table if not exists public.consignment_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  -- Every card in the package, ours and every consignor's (5.3).
  declared_value_cents integer not null check (declared_value_cents >= 0),
  included_coverage_cents integer not null default 0 check (included_coverage_cents >= 0),
  max_insurable_cents integer,
  -- A consignor in the package approved additional insurance and the package
  -- is worth more than the included coverage.
  insurance_needed boolean not null default false,
  -- Worth more than the carrier insures: review before shipping (5.3).
  over_limit boolean not null default false,
  estimated_premium_cents integer check (estimated_premium_cents is null or estimated_premium_cents >= 0),
  insured_value_cents integer check (insured_value_cents is null or insured_value_cents >= 0),
  insurance_premium_cents integer check (insurance_premium_cents is null or insurance_premium_cents >= 0),
  insurance_source text check (insurance_source is null or char_length(insurance_source) <= 100),
  insurance_recorded_at timestamptz,
  insurance_recorded_by text,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- What a package needs, worked out from its cards and the elections of the
-- consignors in it (consignment sales already recorded for the order).
create or replace function public.consignment_refresh_shipment(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_value integer;
  v_ins public.consignment_insurance_schedules%rowtype;
  v_any_elected boolean;
  v_premium jsonb;
  v_id uuid;
begin
  if not exists (select 1 from public.consignment_sales where order_id = p_order_id) then
    return null;
  end if;
  select coalesce(sum(line_total_cents), 0)::int into v_value from public.order_items where order_id = p_order_id;
  select * into v_ins from public.consignment_insurance_schedules where effective_from <= now() order by effective_from desc limit 1;
  select coalesce(bool_or(insurance_elected), false) into v_any_elected
    from public.consignment_sales where order_id = p_order_id and status <> 'cancelled';
  if v_ins.id is not null then
    v_premium := public.consignment_insurance_premium(v_value, v_ins.id);
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  insert into public.consignment_shipments (order_id, declared_value_cents, included_coverage_cents, max_insurable_cents,
    insurance_needed, over_limit, estimated_premium_cents)
  values (p_order_id, v_value, coalesce(v_ins.included_coverage_cents, 0), v_ins.max_insurable_cents,
    v_any_elected and v_value > coalesce(v_ins.included_coverage_cents, 0),
    v_ins.max_insurable_cents is not null and v_value > v_ins.max_insurable_cents,
    case when v_any_elected then (v_premium ->> 'premiumCents')::int end)
  on conflict (order_id) do update set
    declared_value_cents = excluded.declared_value_cents,
    included_coverage_cents = excluded.included_coverage_cents,
    max_insurable_cents = excluded.max_insurable_cents,
    insurance_needed = excluded.insurance_needed,
    over_limit = excluded.over_limit,
    estimated_premium_cents = excluded.estimated_premium_cents,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Staff record the additional insurance bought for a package (premium and
-- value covered). It becomes a Transaction Expense for the consignors in the
-- package who approved insurance, by each card's share (4.5, 5.3).
create or replace function public.consignment_record_insurance(p_order_id uuid, p_insured_value_cents integer, p_premium_cents integer, p_source text, p_notes text, p_actor text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  sh public.consignment_shipments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into sh from public.consignment_shipments where order_id = p_order_id for update;
  if not found then
    raise exception 'That order has no consigned cards.' using errcode = 'GC080';
  end if;
  if p_premium_cents is null or p_premium_cents < 0 or p_insured_value_cents is null or p_insured_value_cents < 0 then
    raise exception 'Enter the premium and the value insured.' using errcode = 'GC045';
  end if;
  if exists (select 1 from public.consignment_sales where order_id = p_order_id and status in ('settled', 'paid')) then
    raise exception 'A sale in this package is already settled. Reopen it first.' using errcode = 'GC081';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_shipments set
    insured_value_cents = p_insured_value_cents, insurance_premium_cents = p_premium_cents,
    insurance_source = nullif(btrim(p_source), ''), notes = nullif(btrim(p_notes), ''),
    insurance_recorded_at = now(), insurance_recorded_by = p_actor, updated_at = now()
  where id = sh.id;
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- ============================================================ shipping claims (5.4, 5.5)

create table if not exists public.consignment_shipping_claims (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  shipment_id uuid references public.consignment_shipments(id) on delete restrict,
  kind text not null check (kind in ('lost', 'damaged')),
  status text not null default 'open' check (status in ('open', 'filed', 'approved', 'denied', 'paid', 'closed')),
  -- Snapshot of the shipment when the claim was opened.
  carrier text,
  tracking_number text,
  shipment_value_cents integer,
  insured_value_cents integer,
  insurance_premium_cents integer,
  insurance_elected_summary text,
  claim_number text check (claim_number is null or char_length(claim_number) <= 100),
  filed_at timestamptz,
  customer_refund_status text not null default 'none' check (customer_refund_status in ('none', 'pending', 'refunded')),
  reimbursement_cents integer check (reimbursement_cents is null or reimbursement_cents >= 0),
  reimbursed_at timestamptz,
  -- carrier_loss: 5.4 (sale reversed, claim payment settled as the sale);
  -- our_responsibility: 5.5 (consignor paid as if it sold).
  outcome text check (outcome is null or outcome in ('carrier_loss', 'our_responsibility')),
  notes text check (notes is null or char_length(notes) <= 2000),
  opened_at timestamptz not null default now(),
  opened_by text,
  closed_at timestamptz,
  closed_by text,
  constraint consignment_claims_closed check ((status = 'closed') = (closed_at is not null and outcome is not null))
);
create index if not exists consignment_claims_order_idx on public.consignment_shipping_claims (order_id);
create unique index if not exists consignment_claims_one_open on public.consignment_shipping_claims (order_id) where status <> 'closed';

-- ============================================================ returns (7.4)

create table if not exists public.consignment_returns (
  id uuid primary key default gen_random_uuid(),
  consignment_id uuid not null references public.consignments(id) on delete restrict,
  return_number integer not null,
  requested_by text not null check (requested_by in ('consignor', 'staff')),
  -- The consignor ends the Agreement with this return (7.3).
  ends_consignment boolean not null default false,
  status text not null default 'requested'
    check (status in ('requested', 'removed_from_sale', 'awaiting_shipping_payment', 'ready_to_ship', 'shipped', 'delivered', 'cancelled')),
  shipping_cost_cents integer check (shipping_cost_cents is null or shipping_cost_cents >= 0),
  -- We pay return shipping when we ended the Agreement without cause (7.4(3)).
  we_pay_shipping boolean not null default false,
  shipping_paid_at timestamptz,
  carrier text check (carrier is null or char_length(carrier) <= 60),
  tracking_number text check (tracking_number is null or char_length(tracking_number) <= 60),
  insured_value_cents integer check (insured_value_cents is null or insured_value_cents >= 0),
  shipped_at timestamptz,
  delivered_at timestamptz,
  note text check (note is null or char_length(note) <= 1000),
  requested_at timestamptz not null default now(),
  requested_actor text,
  approved_at timestamptz,
  approved_by text,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  unique (consignment_id, return_number)
);
create index if not exists consignment_returns_consignment_idx on public.consignment_returns (consignment_id);

create table if not exists public.consignment_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.consignment_returns(id) on delete restrict,
  lot_id uuid not null references public.consignment_lots(id) on delete restrict,
  -- 'accepted': unsold accepted copies; 'rejected': copies we declined (2.5).
  pool text not null check (pool in ('accepted', 'rejected')),
  quantity integer not null check (quantity between 1 and 9999),
  unique (return_id, lot_id, pool)
);
create index if not exists consignment_return_lines_lot_idx on public.consignment_return_lines (lot_id);

-- ============================================================ guards and RLS

drop trigger if exists consignment_guard on public.consignment_sale_holds;
create trigger consignment_guard before insert or update or delete on public.consignment_sale_holds
  for each row execute function public.tg_consignment_ledger_guard();
drop trigger if exists consignment_guard on public.consignment_adjustments;
create trigger consignment_guard before insert or update or delete on public.consignment_adjustments
  for each row execute function public.tg_consignment_ledger_guard();
drop trigger if exists consignment_guard on public.consignment_shipments;
create trigger consignment_guard before insert or update or delete on public.consignment_shipments
  for each row execute function public.tg_consignment_ledger_guard();
drop trigger if exists consignment_guard on public.consignment_shipping_claims;
create trigger consignment_guard before insert or update or delete on public.consignment_shipping_claims
  for each row execute function public.tg_consignment_ledger_guard();
drop trigger if exists consignment_guard on public.consignment_returns;
create trigger consignment_guard before insert or update or delete on public.consignment_returns
  for each row execute function public.tg_consignment_ledger_guard();
drop trigger if exists consignment_guard on public.consignment_return_lines;
create trigger consignment_guard before insert or update or delete on public.consignment_return_lines
  for each row execute function public.tg_consignment_ledger_guard();

alter table public.consignment_sale_holds enable row level security;
alter table public.consignment_adjustments enable row level security;
alter table public.consignment_shipments enable row level security;
alter table public.consignment_shipping_claims enable row level security;
alter table public.consignment_returns enable row level security;
alter table public.consignment_return_lines enable row level security;
revoke all on public.consignment_sale_holds, public.consignment_adjustments, public.consignment_shipments,
  public.consignment_shipping_claims, public.consignment_returns, public.consignment_return_lines from anon, authenticated;
grant select on public.consignment_sale_holds, public.consignment_adjustments, public.consignment_shipments,
  public.consignment_shipping_claims, public.consignment_returns, public.consignment_return_lines to authenticated;
drop policy if exists staff_read on public.consignment_sale_holds;
create policy staff_read on public.consignment_sale_holds for select to authenticated using (public.is_staff());
drop policy if exists staff_read on public.consignment_adjustments;
create policy staff_read on public.consignment_adjustments for select to authenticated using (public.is_staff());
drop policy if exists staff_read on public.consignment_shipments;
create policy staff_read on public.consignment_shipments for select to authenticated using (public.is_staff());
drop policy if exists staff_read on public.consignment_shipping_claims;
create policy staff_read on public.consignment_shipping_claims for select to authenticated using (public.is_staff());
drop policy if exists staff_read on public.consignment_returns;
create policy staff_read on public.consignment_returns for select to authenticated using (public.is_staff());
drop policy if exists staff_read on public.consignment_return_lines;
create policy staff_read on public.consignment_return_lines for select to authenticated using (public.is_staff());

alter table public.consignment_lot_events drop constraint if exists consignment_lot_events_event_check;
alter table public.consignment_lot_events add constraint consignment_lot_events_event_check
  check (event in ('received', 'inspection_started', 'accepted', 'rejected', 'reopened',
                   'listed', 'unlisted', 'price_changed', 'sold', 'sale_cancelled',
                   'lost_in_shipping', 'return_pulled', 'returned', 'return_cancelled'));

-- ============================================================ lot quantities, now with returns and losses

-- Copies of a lot: accepted, on the website, in an unpaid checkout, sold
-- (or lost in shipping after selling), on their way back to the consignor,
-- and what's left unlisted. Declined copies are counted separately.
drop function if exists public.consignment_lot_quantities_all(uuid);
drop function if exists public.consignment_lot_quantities(uuid);
create function public.consignment_lot_quantities(p_lot_id uuid)
returns table(accepted integer, on_sale integer, pending integer, sold integer, unlisted integer,
              returning_accepted integer, rejected integer, returning_rejected integer)
language sql
stable
security definer
set search_path to ''
as $$
  with l as (select * from public.consignment_lots where id = p_lot_id),
  inv as (select coalesce(sum(i.quantity), 0)::int as q from public.inventory_items i where i.consignment_lot_id = p_lot_id),
  pend as (
    select coalesce(sum(oi.quantity), 0)::int as q
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.inventory_items i on i.id = oi.inventory_item_id
    where i.consignment_lot_id = p_lot_id and o.status = 'pending_payment' and o.payment_status <> 'paid'),
  s as (select coalesce(sum(cs.quantity), 0)::int as q from public.consignment_sales cs
        where cs.lot_id = p_lot_id and (cs.status <> 'cancelled' or cs.lost)),
  ret as (
    select coalesce(sum(rl.quantity) filter (where rl.pool = 'accepted'), 0)::int as acc,
           coalesce(sum(rl.quantity) filter (where rl.pool = 'rejected'), 0)::int as rej
    from public.consignment_return_lines rl
    join public.consignment_returns r on r.id = rl.return_id
    where rl.lot_id = p_lot_id and r.status not in ('requested', 'cancelled'))
  select l.quantity_accepted, inv.q, pend.q, s.q,
         greatest(l.quantity_accepted - inv.q - pend.q - s.q - ret.acc, 0),
         ret.acc, l.quantity_rejected, ret.rej
  from l, inv, pend, s, ret;
$$;

create function public.consignment_lot_quantities_all(p_consignment_id uuid)
returns table(lot_id uuid, accepted integer, on_sale integer, pending integer, sold integer, unlisted integer,
              returning_accepted integer, rejected integer, returning_rejected integer)
language sql
stable
security definer
set search_path to ''
as $$
  select l.id, q.accepted, q.on_sale, q.pending, q.sold, q.unlisted, q.returning_accepted, q.rejected, q.returning_rejected
  from public.consignment_lots l
  cross join lateral public.consignment_lot_quantities(l.id) q
  where l.consignment_id = p_consignment_id and l.status in ('accepted', 'listed', 'sold', 'returned', 'rejected');
$$;
revoke all on function public.consignment_lot_quantities(uuid) from public, anon, authenticated;
revoke all on function public.consignment_lot_quantities_all(uuid) from public, anon, authenticated;
grant execute on function public.consignment_lot_quantities(uuid) to service_role;
grant execute on function public.consignment_lot_quantities_all(uuid) to service_role;

-- 'listed' while any copy is on the website or in a checkout; once nothing is
-- left unlisted either: 'sold' if any copy sold, else 'returned'; otherwise 'accepted'.
create or replace function public.consignment_refresh_lot_status(p_lot_id uuid, p_actor text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  l public.consignment_lots%rowtype;
  q record;
  v_to text;
begin
  select * into l from public.consignment_lots where id = p_lot_id for update;
  if not found or l.status not in ('accepted', 'listed', 'sold', 'returned') then
    return l.status;
  end if;
  select * into q from public.consignment_lot_quantities(p_lot_id);
  v_to := case when q.on_sale + q.pending > 0 then 'listed'
               when q.unlisted > 0 then 'accepted'
               when q.sold > 0 then 'sold'
               when q.returning_accepted > 0 then 'returned'
               else 'accepted' end;
  if v_to <> l.status then
    perform set_config('geega.consignment_write', 'on', true);
    update public.consignment_lots set status = v_to where id = l.id;
  end if;
  return v_to;
end;
$$;

-- ============================================================ sales: timing, insurance election, funds

create or replace function public.consignment_mark_sale_delivered(p_sale_id uuid, p_delivered_at timestamptz, p_actor text)
returns timestamptz
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.consignment_sales%rowtype;
  v_payable timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into s from public.consignment_sales where id = p_sale_id for update;
  if not found then
    raise exception 'That sale isn''t there.' using errcode = 'GC062';
  end if;
  if s.status <> 'open' then
    raise exception 'Only open sales can be changed.' using errcode = 'GC063';
  end if;
  if p_delivered_at is null or p_delivered_at < s.sold_at or p_delivered_at > now() + interval '1 hour' then
    raise exception 'Delivery must be after the sale and not in the future.' using errcode = 'GC045';
  end if;
  v_payable := public.consignment_payable_at(p_delivered_at, s.inspection_days);
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_sales
    set delivered_at = p_delivered_at, payable_at = v_payable, payout_due_on = public.consignment_payout_due_on(v_payable),
        notes = concat_ws(E'\n', notes, 'Delivery recorded by ' || coalesce(p_actor, 'staff') || '.')
    where id = s.id;
  perform set_config('geega.consignment_write', '', true);
  return v_payable;
end;
$$;

-- TCGplayer and eBay: the marketplace released the money to us (6.2).
create or replace function public.consignment_mark_funds_released(p_sale_id uuid, p_released_at timestamptz, p_actor text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.consignment_sales%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into s from public.consignment_sales where id = p_sale_id for update;
  if not found then
    raise exception 'That sale isn''t there.' using errcode = 'GC062';
  end if;
  if s.channel = 'website' then
    raise exception 'Website sales are paid through our checkout.' using errcode = 'GC063';
  end if;
  if s.status <> 'open' then
    raise exception 'Only open sales can be changed.' using errcode = 'GC063';
  end if;
  if p_released_at is null or p_released_at < s.sold_at or p_released_at > now() + interval '1 hour' then
    raise exception 'The release date must be after the sale and not in the future.' using errcode = 'GC045';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_sales set funds_released_at = p_released_at where id = s.id;
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- Settlement as before, now also refused while a hold is open (6.4) or, on
-- TCGplayer/eBay, before the marketplace released the funds (6.2).
create or replace function public.consignment_settle_sale(
  p_sale_id uuid,
  p_marketplace_fee_cents integer,
  p_processing_fee_cents integer,
  p_postage_cents integer,
  p_insurance_cents integer,
  p_other_expense_cents integer,
  p_other_expense_note text,
  p_detail jsonb,
  p_actor text
) returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.consignment_sales%rowtype;
  v_expenses bigint;
  v_net integer;
  v_rate integer;
  v_commission integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into s from public.consignment_sales where id = p_sale_id for update;
  if not found then
    raise exception 'That sale isn''t there.' using errcode = 'GC062';
  end if;
  if s.status <> 'open' then
    raise exception 'Only open sales can be settled.' using errcode = 'GC063';
  end if;
  if exists (select 1 from public.consignment_sale_holds h where h.sale_id = s.id and h.resolved_at is null) then
    raise exception 'This sale is on hold. Resolve the hold first.' using errcode = 'GC082';
  end if;
  if s.delivered_at is null or s.payable_at is null then
    raise exception 'Record delivery first. The buyer''s inspection period starts the day after the card is delivered.' using errcode = 'GC064';
  end if;
  if now() < s.payable_at then
    raise exception 'The buyer''s inspection period ends %.', to_char((s.payable_at - interval '1 minute') at time zone 'America/Chicago', 'Mon FMDD at FMHH12:MI AM') || ' Central' using errcode = 'GC064';
  end if;
  if s.channel <> 'website' and s.funds_released_at is null then
    raise exception 'Record when % released the funds first.', case s.channel when 'ebay' then 'eBay' else 'TCGplayer' end using errcode = 'GC064';
  end if;
  if least(coalesce(p_marketplace_fee_cents, 0), coalesce(p_processing_fee_cents, 0), coalesce(p_postage_cents, 0),
           coalesce(p_insurance_cents, 0), coalesce(p_other_expense_cents, 0)) < 0 then
    raise exception 'Expenses can''t be negative.' using errcode = 'GC045';
  end if;
  if coalesce(p_insurance_cents, 0) > 0 and not coalesce(s.insurance_elected, false) then
    raise exception 'The consignor declined additional insurance for this sale, so it can''t be charged to them.' using errcode = 'GC045';
  end if;
  if coalesce(p_other_expense_cents, 0) > 0 and coalesce(btrim(p_other_expense_note), '') = '' then
    raise exception 'Say what the other expense is (it must be one the consignor approved in writing).' using errcode = 'GC045';
  end if;

  v_expenses := coalesce(p_marketplace_fee_cents, 0)::bigint + coalesce(p_processing_fee_cents, 0) + coalesce(p_postage_cents, 0)
              + coalesce(p_insurance_cents, 0) + coalesce(p_other_expense_cents, 0);
  v_net := greatest(s.gross_cents - v_expenses, 0)::int;
  v_rate := public.consignment_commission_rate_bps(s.unit_price_cents, s.commission_tiers);
  v_commission := public.consignment_commission_cents(s.unit_price_cents, v_net, s.commission_tiers);

  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_sales set
    marketplace_fee_cents = coalesce(p_marketplace_fee_cents, 0),
    processing_fee_cents = coalesce(p_processing_fee_cents, 0),
    postage_cents = coalesce(p_postage_cents, 0),
    insurance_cents = coalesce(p_insurance_cents, 0),
    other_expense_cents = coalesce(p_other_expense_cents, 0),
    other_expense_note = nullif(btrim(p_other_expense_note), ''),
    net_sale_cents = v_net,
    commission_rate_bps = v_rate,
    commission_cents = v_commission,
    payout_cents = v_net - v_commission,
    settlement_detail = p_detail,
    settled_at = now(),
    settled_by = p_actor,
    status = 'settled'
  where id = s.id;
  perform set_config('geega.consignment_write', '', true);
  return v_net - v_commission;
end;
$$;

-- TCGplayer/eBay sales keep the insurance election in force when they sold.
create or replace function public.tg_consignment_sale_defaults()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.insurance_elected is null then
    new.insurance_elected := coalesce((public.consignment_current_elections(new.consignment_id) ->> 'additionalInsurance')::boolean, false);
  end if;
  if new.delivered_at is not null and new.payable_at is null then
    new.payable_at := public.consignment_payable_at(new.delivered_at, new.inspection_days);
  end if;
  if new.payable_at is not null then
    new.payout_due_on := public.consignment_payout_due_on(new.payable_at);
  end if;
  return new;
end;
$$;
drop trigger if exists consignment_sale_defaults on public.consignment_sales;
create trigger consignment_sale_defaults before insert or update on public.consignment_sales
  for each row execute function public.tg_consignment_sale_defaults();

-- Website orders -> sales, as in 20261029120000 with: the inspection period
-- by the 6.1 rule, the package's shipment record kept up to date, and sales
-- under a shipping claim left for the claim to resolve when the order is
-- cancelled or refunded.
create or replace function public.tg_consignment_order_sync()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  oi record;
  s record;
  v_terms jsonb;
  v_lots uuid[] := '{}';
  v_lot uuid;
  v_cancel boolean;
  v_payable timestamptz;
begin
  if new.channel is distinct from 'online' then
    return new;
  end if;
  v_cancel := new.status in ('cancelled', 'refunded') and old.status not in ('cancelled', 'refunded');

  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' and new.status not in ('cancelled', 'refunded') then
    for oi in
      select o_i.id, o_i.quantity, o_i.unit_price_cents, i.id as inv_id, i.consignment_lot_id, l.consignment_id
      from public.order_items o_i
      join public.inventory_items i on i.id = o_i.inventory_item_id
      join public.consignment_lots l on l.id = i.consignment_lot_id
      where o_i.order_id = new.id and i.ownership = 'consigned'
    loop
      v_terms := public.consignment_signed_terms(oi.consignment_id);
      perform set_config('geega.consignment_write', 'on', true);
      insert into public.consignment_sales (
        consignment_id, lot_id, inventory_item_id, channel, order_id, order_item_id, quantity, unit_price_cents,
        sold_at, inspection_days, commission_tiers, created_by
      ) values (
        oi.consignment_id, oi.consignment_lot_id, oi.inv_id, 'website', new.id, oi.id, oi.quantity, oi.unit_price_cents,
        coalesce(new.paid_at, now()), coalesce((v_terms ->> 'inspectionDays')::int, 3),
        coalesce(v_terms -> 'commissionTiers', '[{"maxPriceCents": 15000, "rateBps": 2000}, {"maxPriceCents": null, "rateBps": 1000}]'::jsonb),
        'website order'
      ) on conflict (order_item_id) do nothing;
      insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
      select l.id, l.consignment_id, 'sold', l.status, l.status,
             jsonb_build_object('channel', 'website', 'quantity', oi.quantity, 'unitPriceCents', oi.unit_price_cents, 'orderId', new.id), 'website order'
      from public.consignment_lots l where l.id = oi.consignment_lot_id;
      v_lots := array_append(v_lots, oi.consignment_lot_id);
    end loop;
    perform public.consignment_refresh_shipment(new.id);
  end if;

  if new.shipped_at is distinct from old.shipped_at then
    perform set_config('geega.consignment_write', 'on', true);
    update public.consignment_sales set shipped_at = new.shipped_at where order_id = new.id and status = 'open';
  end if;

  if new.delivered_at is not null and new.delivered_at is distinct from old.delivered_at and not v_cancel then
    perform set_config('geega.consignment_write', 'on', true);
    update public.consignment_sales
      set delivered_at = new.delivered_at, payable_at = public.consignment_payable_at(new.delivered_at, inspection_days)
      where order_id = new.id and status = 'open';
  end if;

  if v_cancel then
    for s in select * from public.consignment_sales where order_id = new.id and status <> 'cancelled' for update loop
      perform set_config('geega.consignment_write', 'on', true);
      if exists (select 1 from public.consignment_shipping_claims c where c.order_id = new.id and c.status <> 'closed') then
        -- The shipping claim decides what happens to these sales (5.4, 5.5).
        continue;
      elsif s.status = 'paid' then
        update public.consignment_sales
          set flag = 'Order ' || new.status::text || ' after this sale was paid out. Record an adjustment if the agreement allows recovering it (6.5, 6.6).'
          where id = s.id;
      else
        update public.consignment_sales set
          status = 'cancelled', cancelled_at = now(), cancel_reason = 'Order ' || new.status::text,
          net_sale_cents = null, commission_rate_bps = null, commission_cents = null, payout_cents = null, settled_at = null, settled_by = null,
          restocked = (new.shipped_at is null and s.inventory_item_id is not null)
        where id = s.id;
        if new.shipped_at is null and s.inventory_item_id is not null then
          update public.inventory_items set quantity = quantity + s.quantity where id = s.inventory_item_id;
        end if;
        insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
        select l.id, l.consignment_id, 'sale_cancelled', l.status, l.status,
               jsonb_build_object('saleId', s.id, 'orderId', new.id, 'restocked', new.shipped_at is null), 'website order'
        from public.consignment_lots l where l.id = s.lot_id;
        v_lots := array_append(v_lots, s.lot_id);
      end if;
    end loop;
    perform public.consignment_refresh_shipment(new.id);
  end if;

  foreach v_lot in array v_lots loop
    perform public.consignment_refresh_lot_status(v_lot, 'website order');
  end loop;
  perform set_config('geega.consignment_write', '', true);
  return new;
end;
$$;

-- ============================================================ holds

create or replace function public.consignment_open_hold(p_sale_id uuid, p_source text, p_reason text, p_actor text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.consignment_sales%rowtype;
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into s from public.consignment_sales where id = p_sale_id for update;
  if not found then
    raise exception 'That sale isn''t there.' using errcode = 'GC062';
  end if;
  if s.status not in ('open', 'settled') then
    raise exception 'Only unpaid sales can be held. For a paid sale, record an adjustment.' using errcode = 'GC063';
  end if;
  if coalesce(btrim(p_reason), '') = '' or char_length(btrim(p_reason)) < 3 then
    raise exception 'Say what the problem is. The consignor is told the reason (6.4).' using errcode = 'GC045';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  insert into public.consignment_sale_holds (sale_id, consignment_id, source, reason, opened_by)
  values (s.id, s.consignment_id, p_source, btrim(p_reason), p_actor) returning id into v_id;
  perform set_config('geega.consignment_write', '', true);
  return v_id;
end;
$$;

create or replace function public.consignment_release_hold(p_hold_id uuid, p_resolution text, p_actor text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  h public.consignment_sale_holds%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into h from public.consignment_sale_holds where id = p_hold_id for update;
  if not found or h.resolved_at is not null then
    raise exception 'That hold isn''t open.' using errcode = 'GC083';
  end if;
  if h.source = 'claim' then
    raise exception 'This hold belongs to a shipping claim. Close the claim instead.' using errcode = 'GC083';
  end if;
  if coalesce(btrim(p_resolution), '') = '' then
    raise exception 'Say how it was resolved.' using errcode = 'GC045';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_sale_holds set resolved_at = now(), resolved_by = p_actor, resolution = btrim(p_resolution) where id = h.id;
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- ============================================================ adjustments

create or replace function public.consignment_add_adjustment(p_consignment_id uuid, p_sale_id uuid, p_kind text, p_amount_cents integer, p_reason text, p_actor text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.consignments where id = p_consignment_id) then
    raise exception 'That consignment isn''t there.' using errcode = 'GC041';
  end if;
  if p_sale_id is not null and not exists (select 1 from public.consignment_sales where id = p_sale_id and consignment_id = p_consignment_id) then
    raise exception 'That sale isn''t part of this consignment.' using errcode = 'GC062';
  end if;
  if p_amount_cents is null or p_amount_cents = 0 then
    raise exception 'Enter an amount (negative to recover money from the consignor).' using errcode = 'GC045';
  end if;
  if coalesce(btrim(p_reason), '') = '' or char_length(btrim(p_reason)) < 3 then
    raise exception 'Document the reason. The consignor sees it on their statement.' using errcode = 'GC045';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  insert into public.consignment_adjustments (consignment_id, sale_id, kind, amount_cents, reason, created_by)
  values (p_consignment_id, p_sale_id, p_kind, p_amount_cents, btrim(p_reason), p_actor) returning id into v_id;
  perform set_config('geega.consignment_write', '', true);
  return v_id;
end;
$$;

create or replace function public.consignment_void_adjustment(p_adjustment_id uuid, p_reason text, p_actor text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  a public.consignment_adjustments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into a from public.consignment_adjustments where id = p_adjustment_id for update;
  if not found or a.voided_at is not null then
    raise exception 'That adjustment isn''t open.' using errcode = 'GC084';
  end if;
  if a.payout_id is not null then
    raise exception 'That adjustment is in a payout. Void the payout first.' using errcode = 'GC084';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why it is void.' using errcode = 'GC045';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_adjustments set voided_at = now(), void_reason = btrim(p_reason), voided_by = p_actor where id = a.id;
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- ============================================================ payouts: sales and adjustments together

drop function if exists public.consignment_record_payout(uuid, uuid[], text, text, timestamptz, text, text);
create function public.consignment_record_payout(
  p_consignment_id uuid,
  p_sale_ids uuid[],
  p_adjustment_ids uuid[],
  p_method text,
  p_reference text,
  p_paid_at timestamptz,
  p_note text,
  p_actor text
) returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_methods text[];
  v_sales uuid[] := array(select distinct unnest(coalesce(p_sale_ids, '{}')));
  v_adjs uuid[] := array(select distinct unnest(coalesce(p_adjustment_ids, '{}')));
  v_count integer;
  v_adj_count integer;
  v_amount bigint;
  v_adj_amount bigint;
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if cardinality(v_sales) + cardinality(v_adjs) = 0 then
    raise exception 'Choose the sales and adjustments this payout covers.' using errcode = 'GC045';
  end if;
  select payout_methods into v_methods from public.consignment_settings where id;
  if p_method is null or not (p_method = any(coalesce(v_methods, '{}'))) then
    raise exception 'Choose a payout method you offer.' using errcode = 'GC045';
  end if;
  if p_paid_at is null or p_paid_at > now() + interval '1 day' then
    raise exception 'Enter when it was paid.' using errcode = 'GC045';
  end if;
  perform 1 from public.consignment_sales where id = any(v_sales) for update;
  perform 1 from public.consignment_adjustments where id = any(v_adjs) for update;
  select count(*), coalesce(sum(payout_cents), 0) into v_count, v_amount
  from public.consignment_sales s
  where s.id = any(v_sales) and s.consignment_id = p_consignment_id and s.status = 'settled'
    and not exists (select 1 from public.consignment_sale_holds h where h.sale_id = s.id and h.resolved_at is null);
  if v_count <> cardinality(v_sales) then
    raise exception 'Every sale in a payout must be settled, unpaid, not on hold and from this consignment.' using errcode = 'GC065';
  end if;
  select count(*), coalesce(sum(amount_cents), 0) into v_adj_count, v_adj_amount
  from public.consignment_adjustments
  where id = any(v_adjs) and consignment_id = p_consignment_id and payout_id is null and voided_at is null;
  if v_adj_count <> cardinality(v_adjs) then
    raise exception 'Every adjustment in a payout must be open and from this consignment.' using errcode = 'GC065';
  end if;
  if v_amount + v_adj_amount < 0 then
    raise exception 'These come to less than $0. Leave the recovery for a later payout, or invoice the consignor.' using errcode = 'GC085';
  end if;

  perform set_config('geega.consignment_write', 'on', true);
  insert into public.consignment_payouts (consignment_id, amount_cents, sale_count, adjustment_count, method, reference, paid_at, note, created_by)
  values (p_consignment_id, v_amount + v_adj_amount, v_count, v_adj_count, p_method, nullif(btrim(p_reference), ''), p_paid_at, nullif(btrim(p_note), ''), p_actor)
  returning id into v_id;
  update public.consignment_sales set status = 'paid', payout_id = v_id where id = any(v_sales);
  update public.consignment_adjustments set payout_id = v_id where id = any(v_adjs);
  perform set_config('geega.consignment_write', '', true);
  return v_id;
end;
$$;

create or replace function public.consignment_void_payout(p_payout_id uuid, p_reason text, p_actor text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  p public.consignment_payouts%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into p from public.consignment_payouts where id = p_payout_id for update;
  if not found then
    raise exception 'That payout isn''t there.' using errcode = 'GC066';
  end if;
  if p.voided_at is not null then
    raise exception 'That payout is already void.' using errcode = 'GC066';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the payout is void.' using errcode = 'GC045';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_payouts set voided_at = now(), void_reason = btrim(p_reason), voided_by = p_actor where id = p.id;
  update public.consignment_sales set status = 'settled', payout_id = null where payout_id = p.id;
  update public.consignment_adjustments set payout_id = null where payout_id = p.id;
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- ============================================================ shipping claims

-- Open a claim for a website order's package: snapshot what was shipped and
-- insured, and hold every unpaid consigned sale in it.
create or replace function public.consignment_open_claim(p_order_id uuid, p_kind text, p_notes text, p_actor text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  o public.orders%rowtype;
  sh public.consignment_shipments%rowtype;
  v_id uuid;
  s record;
  v_summary text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_kind not in ('lost', 'damaged') then
    raise exception 'Choose lost or damaged.' using errcode = 'GC045';
  end if;
  select * into o from public.orders where id = p_order_id;
  if not found or not exists (select 1 from public.consignment_sales where order_id = p_order_id) then
    raise exception 'That order has no consigned cards.' using errcode = 'GC080';
  end if;
  if o.shipped_at is null then
    raise exception 'That order hasn''t shipped.' using errcode = 'GC086';
  end if;
  if exists (select 1 from public.consignment_shipping_claims where order_id = p_order_id and status <> 'closed') then
    raise exception 'This order already has an open claim.' using errcode = 'GC086';
  end if;
  select * into sh from public.consignment_shipments where order_id = p_order_id;
  select string_agg(distinct case when cs.insurance_elected then 'approved' else 'declined' end, ' / ') into v_summary
    from public.consignment_sales cs where cs.order_id = p_order_id and cs.status <> 'cancelled';

  perform set_config('geega.consignment_write', 'on', true);
  insert into public.consignment_shipping_claims (order_id, shipment_id, kind, carrier, tracking_number, shipment_value_cents,
    insured_value_cents, insurance_premium_cents, insurance_elected_summary, notes, opened_by)
  values (o.id, sh.id, p_kind, o.tracking_carrier, o.tracking_number, sh.declared_value_cents,
    sh.insured_value_cents, sh.insurance_premium_cents, v_summary, nullif(btrim(p_notes), ''), p_actor)
  returning id into v_id;
  for s in select id, consignment_id from public.consignment_sales where order_id = o.id and status in ('open', 'settled') loop
    insert into public.consignment_sale_holds (sale_id, consignment_id, source, reason, claim_id, opened_by)
    values (s.id, s.consignment_id, 'claim',
            'Package reported ' || p_kind || ' in shipping. We''re handling it with the carrier (agreement 5.4).', v_id, p_actor);
    update public.consignment_sales set claim_id = v_id where id = s.id;
  end loop;
  perform set_config('geega.consignment_write', '', true);
  return v_id;
end;
$$;

create or replace function public.consignment_update_claim(
  p_claim_id uuid, p_status text, p_claim_number text, p_filed_at timestamptz, p_customer_refund_status text,
  p_reimbursement_cents integer, p_reimbursed_at timestamptz, p_notes text, p_actor text
) returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  c public.consignment_shipping_claims%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into c from public.consignment_shipping_claims where id = p_claim_id for update;
  if not found then
    raise exception 'That claim isn''t there.' using errcode = 'GC087';
  end if;
  if c.status = 'closed' then
    raise exception 'That claim is closed.' using errcode = 'GC087';
  end if;
  if p_status is not null and p_status not in ('open', 'filed', 'approved', 'denied', 'paid') then
    raise exception 'Choose a claim status. Close a claim with its outcome.' using errcode = 'GC045';
  end if;
  if p_reimbursement_cents is not null and p_reimbursement_cents < 0 then
    raise exception 'The reimbursement can''t be negative.' using errcode = 'GC045';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_shipping_claims set
    status = coalesce(p_status, status),
    claim_number = coalesce(nullif(btrim(p_claim_number), ''), claim_number),
    filed_at = coalesce(p_filed_at, filed_at),
    customer_refund_status = coalesce(p_customer_refund_status, customer_refund_status),
    reimbursement_cents = coalesce(p_reimbursement_cents, reimbursement_cents),
    reimbursed_at = coalesce(p_reimbursed_at, reimbursed_at),
    notes = coalesce(nullif(btrim(p_notes), ''), notes)
  where id = c.id;
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- Close a claim with its outcome:
--   our_responsibility (5.5): the holds end and the sales settle as sold.
--   carrier_loss (5.4): each consigned sale is reversed with no Commission;
--     a copy lost stays gone, a damaged copy returned to us goes back to the
--     consignor's unlisted stock; any claim payment for a card (up to its
--     Final Selling Price) is settled to the consignor as if it sold, as an
--     adjustment net of Commission. A sale already paid out is recovered by
--     an adjustment.
-- p_allocations: [{ "saleId": uuid, "claimPaymentCents": int, "returnedDamaged": bool }]
create or replace function public.consignment_close_claim(p_claim_id uuid, p_outcome text, p_allocations jsonb, p_note text, p_actor text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  c public.consignment_shipping_claims%rowtype;
  s public.consignment_sales%rowtype;
  a jsonb;
  v_payment integer;
  v_returned boolean;
  v_total integer := 0;
  v_net integer;
  v_lots uuid[] := '{}';
  v_lot uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into c from public.consignment_shipping_claims where id = p_claim_id for update;
  if not found or c.status = 'closed' then
    raise exception 'That claim isn''t open.' using errcode = 'GC087';
  end if;
  if p_outcome not in ('carrier_loss', 'our_responsibility') then
    raise exception 'Choose the outcome.' using errcode = 'GC045';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Note how the claim ended. It''s kept with the claim.' using errcode = 'GC045';
  end if;

  perform set_config('geega.consignment_write', 'on', true);
  if p_outcome = 'carrier_loss' then
    if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
      raise exception 'Say what happened to each card.' using errcode = 'GC045';
    end if;
    for s in select * from public.consignment_sales where order_id = c.order_id and status <> 'cancelled' for update loop
      a := null;
      select x into a from jsonb_array_elements(p_allocations) x where x ->> 'saleId' = s.id::text limit 1;
      if a is null then
        raise exception 'Say what happened to %.', (select card_name from public.consignment_lots where id = s.lot_id) using errcode = 'GC045';
      end if;
      v_payment := coalesce((a ->> 'claimPaymentCents')::int, 0);
      v_returned := coalesce((a ->> 'returnedDamaged')::boolean, false);
      if v_payment < 0 or v_payment > s.gross_cents then
        raise exception 'A card''s claim payment must be between $0 and what it sold for.' using errcode = 'GC045';
      end if;
      v_total := v_total + v_payment;

      if s.status = 'paid' then
        insert into public.consignment_adjustments (consignment_id, sale_id, kind, amount_cents, reason, claim_id, created_by)
        values (s.consignment_id, s.id, 'reversal', -s.payout_cents,
                'Sale reversed: package ' || c.kind || ' in shipping (agreement 5.4).', c.id, p_actor);
      else
        update public.consignment_sales set
          status = 'cancelled', cancelled_at = now(), lost = not v_returned, restocked = false,
          cancel_reason = 'Package ' || c.kind || ' in shipping' || case when v_returned then ', card returned damaged' else '' end || ' (agreement 5.4)',
          net_sale_cents = null, commission_rate_bps = null, commission_cents = null, payout_cents = null, settled_at = null, settled_by = null
        where id = s.id;
      end if;
      if v_payment > 0 then
        v_net := v_payment - public.consignment_commission_cents(s.unit_price_cents, v_payment, s.commission_tiers);
        if v_net > 0 then
          insert into public.consignment_adjustments (consignment_id, sale_id, kind, amount_cents, reason, claim_id, created_by)
          values (s.consignment_id, s.id, 'claim_payment', v_net,
                  'Carrier claim payment of $' || to_char(v_payment / 100.0, 'FM999999990.00') || ' settled as the sale, less Commission (agreement 5.4).', c.id, p_actor);
        end if;
      end if;
      insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
      select l.id, l.consignment_id, 'lost_in_shipping', l.status, l.status,
             jsonb_build_object('saleId', s.id, 'claimId', c.id, 'returnedDamaged', v_returned, 'claimPaymentCents', v_payment), p_actor
      from public.consignment_lots l where l.id = s.lot_id;
      v_lots := array_append(v_lots, s.lot_id);
    end loop;
    if c.reimbursement_cents is not null and v_total > c.reimbursement_cents then
      raise exception 'The claim payments you allocated ($%) are more than the carrier paid ($%).',
        to_char(v_total / 100.0, 'FM999999990.00'), to_char(c.reimbursement_cents / 100.0, 'FM999999990.00') using errcode = 'GC045';
    end if;
  end if;

  if p_outcome = 'our_responsibility' then
    -- Paid as if it sold (5.5): no buyer inspection is coming, so it can be
    -- settled now.
    update public.consignment_sales set delivered_at = coalesce(delivered_at, now()), payable_at = now()
      where claim_id = c.id and status = 'open';
  end if;
  update public.consignment_sale_holds set resolved_at = now(), resolved_by = p_actor,
    resolution = case p_outcome when 'our_responsibility' then 'Claim closed: Geega Games is responsible (agreement 5.5); the sale is paid as sold.'
                                else 'Claim closed: carrier loss (agreement 5.4).' end
    where claim_id = c.id and resolved_at is null;
  update public.consignment_shipping_claims set status = 'closed', outcome = p_outcome, closed_at = now(), closed_by = p_actor,
    notes = concat_ws(E'\n', notes, btrim(p_note)) where id = c.id;
  foreach v_lot in array v_lots loop
    perform public.consignment_refresh_lot_status(v_lot, p_actor);
  end loop;
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- ============================================================ returns

-- What can still go back for each lot: unlisted and free website copies
-- (accepted pool), and declined copies not yet returned (rejected pool).
create or replace function public.consignment_returnable(p_lot_id uuid)
returns table(accepted integer, rejected integer)
language sql
stable
security definer
set search_path to ''
as $$
  select q.unlisted + greatest(q.on_sale - coalesce((
           select sum(r.quantity)::int from public.inventory_reservations r
           join public.inventory_items i on i.id = r.inventory_item_id
           where i.consignment_lot_id = p_lot_id and r.status = 'active'), 0), 0),
         greatest(q.rejected - q.returning_rejected, 0)
  from public.consignment_lot_quantities(p_lot_id) q;
$$;

-- A return of cards to the consignor. p_lines: [{ "lotId", "pool", "quantity" }],
-- or null for everything that can go back. Staff approve it next.
create or replace function public.consignment_request_return(p_consignment_id uuid, p_lines jsonb, p_ends_consignment boolean, p_requested_by text, p_note text, p_actor text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  c public.consignments%rowtype;
  v_id uuid;
  v_no integer;
  l record;
  q record;
  v_avail integer;
  v_lines integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into c from public.consignments where id = p_consignment_id for update;
  if not found then
    raise exception 'That consignment isn''t there.' using errcode = 'GC041';
  end if;
  if c.status in ('closed') then
    raise exception 'This consignment is closed.' using errcode = 'GC088';
  end if;
  if p_requested_by not in ('consignor', 'staff') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if exists (select 1 from public.consignment_returns where consignment_id = c.id and status = 'requested') then
    raise exception 'A return is already waiting for approval.' using errcode = 'GC088';
  end if;

  perform set_config('geega.consignment_write', 'on', true);
  select coalesce(max(return_number), 0) + 1 into v_no from public.consignment_returns where consignment_id = c.id;
  insert into public.consignment_returns (consignment_id, return_number, requested_by, ends_consignment, note, requested_actor)
  values (c.id, v_no, p_requested_by, coalesce(p_ends_consignment, false), nullif(btrim(p_note), ''), p_actor)
  returning id into v_id;

  for l in select * from public.consignment_lots where consignment_id = c.id order by created_at loop
    -- Everything returnable when no lines are given.
    if p_lines is null then
      select * into q from public.consignment_returnable(l.id);
      if coalesce(q.accepted, 0) > 0 then
        insert into public.consignment_return_lines (return_id, lot_id, pool, quantity) values (v_id, l.id, 'accepted', q.accepted);
        v_lines := v_lines + 1;
      end if;
      if coalesce(q.rejected, 0) > 0 then
        insert into public.consignment_return_lines (return_id, lot_id, pool, quantity) values (v_id, l.id, 'rejected', q.rejected);
        v_lines := v_lines + 1;
      end if;
    end if;
  end loop;

  if p_lines is not null then
    if jsonb_typeof(p_lines) <> 'array' then
      raise exception 'Choose the cards to return.' using errcode = 'GC045';
    end if;
    for l in
      select (x ->> 'lotId')::uuid as lot_id, x ->> 'pool' as pool, sum((x ->> 'quantity')::int)::int as quantity
      from jsonb_array_elements(p_lines) x group by 1, 2
    loop
      if l.pool not in ('accepted', 'rejected') or l.quantity is null or l.quantity < 1 then
        raise exception 'Each card needs a quantity of at least 1.' using errcode = 'GC045';
      end if;
      if not exists (select 1 from public.consignment_lots where id = l.lot_id and consignment_id = c.id) then
        raise exception 'That card isn''t part of this consignment.' using errcode = 'GC041';
      end if;
      select * into q from public.consignment_returnable(l.lot_id);
      v_avail := case when l.pool = 'accepted' then q.accepted else q.rejected end;
      if l.quantity > v_avail then
        raise exception 'Only % of % can be returned right now; the rest is sold or committed to a sale.',
          v_avail, (select card_name from public.consignment_lots where id = l.lot_id) using errcode = 'GC089';
      end if;
      insert into public.consignment_return_lines (return_id, lot_id, pool, quantity) values (v_id, l.lot_id, l.pool, l.quantity);
      v_lines := v_lines + 1;
    end loop;
  end if;

  if v_lines = 0 and not coalesce(p_ends_consignment, false) then
    raise exception 'There are no unsold cards to return.' using errcode = 'GC089';
  end if;
  perform set_config('geega.consignment_write', '', true);
  return v_id;
end;
$$;

-- Staff approve a return: its cards come off sale now (7.4(1)). Copies in a
-- checkout or sold stay with their sale (7.4(2)).
create or replace function public.consignment_approve_return(p_return_id uuid, p_actor text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  r public.consignment_returns%rowtype;
  rl record;
  q record;
  v_inv public.inventory_items%rowtype;
  v_reserved integer;
  v_take integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into r from public.consignment_returns where id = p_return_id for update;
  if not found or r.status <> 'requested' then
    raise exception 'Only a requested return can be approved.' using errcode = 'GC088';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  for rl in select * from public.consignment_return_lines where return_id = r.id order by lot_id, pool loop
    select * into q from public.consignment_lot_quantities(rl.lot_id);
    if rl.pool = 'rejected' then
      if rl.quantity > q.rejected - q.returning_rejected then
        raise exception 'Some declined copies were already returned. Cancel this return and request it again.' using errcode = 'GC089';
      end if;
      continue;
    end if;
    -- Unlisted copies first, then copies taken off the website.
    v_take := greatest(rl.quantity - q.unlisted, 0);
    if v_take > 0 then
      select * into v_inv from public.inventory_items where consignment_lot_id = rl.lot_id order by created_at limit 1 for update;
      select coalesce(sum(res.quantity), 0)::int into v_reserved from public.inventory_reservations res
        where res.inventory_item_id = v_inv.id and res.status = 'active';
      if v_inv.id is null or v_take > v_inv.quantity - coalesce(v_reserved, 0) then
        raise exception '% has copies committed to a sale now. They stay with that sale; cancel this return and request it again.',
          (select card_name from public.consignment_lots where id = rl.lot_id) using errcode = 'GC089';
      end if;
      update public.inventory_items set quantity = quantity - v_take where id = v_inv.id;
    end if;
    insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
    select l.id, l.consignment_id, 'return_pulled', l.status, l.status,
           jsonb_build_object('returnId', r.id, 'quantity', rl.quantity, 'offWebsite', v_take), p_actor
    from public.consignment_lots l where l.id = rl.lot_id;
  end loop;
  update public.consignment_returns set status = 'removed_from_sale', approved_at = now(), approved_by = p_actor where id = r.id;
  if r.ends_consignment then
    update public.consignments set status = 'terminated' where id = r.consignment_id and status <> 'closed';
  end if;
  for rl in select distinct lot_id from public.consignment_return_lines where return_id = r.id loop
    perform public.consignment_refresh_lot_status(rl.lot_id, p_actor);
  end loop;
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- Moves a return along: 'quote' (shipping cost; we may pay it), 'paid',
-- 'ship' (carrier, tracking, insured value), 'delivered'.
create or replace function public.consignment_advance_return(
  p_return_id uuid, p_step text, p_shipping_cost_cents integer, p_we_pay boolean,
  p_carrier text, p_tracking text, p_insured_value_cents integer, p_at timestamptz, p_actor text
) returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  r public.consignment_returns%rowtype;
  v_to text;
  rl record;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into r from public.consignment_returns where id = p_return_id for update;
  if not found then
    raise exception 'That return isn''t there.' using errcode = 'GC088';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  if p_step = 'quote' then
    if r.status not in ('removed_from_sale', 'awaiting_shipping_payment') then
      raise exception 'Approve the return first.' using errcode = 'GC088';
    end if;
    if p_shipping_cost_cents is null or p_shipping_cost_cents < 0 then
      raise exception 'Enter the return shipping cost.' using errcode = 'GC045';
    end if;
    v_to := case when coalesce(p_we_pay, false) or p_shipping_cost_cents = 0 then 'ready_to_ship' else 'awaiting_shipping_payment' end;
    update public.consignment_returns set status = v_to, shipping_cost_cents = p_shipping_cost_cents, we_pay_shipping = coalesce(p_we_pay, false)
      where id = r.id;
  elsif p_step = 'paid' then
    if r.status <> 'awaiting_shipping_payment' then
      raise exception 'This return isn''t waiting for shipping payment.' using errcode = 'GC088';
    end if;
    v_to := 'ready_to_ship';
    update public.consignment_returns set status = v_to, shipping_paid_at = coalesce(p_at, now()) where id = r.id;
  elsif p_step = 'ship' then
    if r.status <> 'ready_to_ship' then
      raise exception 'Ship a return once its shipping is paid or waived.' using errcode = 'GC088';
    end if;
    if coalesce(btrim(p_carrier), '') = '' or coalesce(btrim(p_tracking), '') = '' then
      raise exception 'Returns ship tracked: enter the carrier and tracking number (7.4(4)).' using errcode = 'GC045';
    end if;
    v_to := 'shipped';
    update public.consignment_returns set status = v_to, carrier = btrim(p_carrier), tracking_number = btrim(p_tracking),
      insured_value_cents = p_insured_value_cents, shipped_at = coalesce(p_at, now()) where id = r.id;
    for rl in select * from public.consignment_return_lines where return_id = r.id loop
      insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
      select l.id, l.consignment_id, 'returned', l.status, l.status,
             jsonb_build_object('returnId', r.id, 'quantity', rl.quantity, 'pool', rl.pool, 'tracking', btrim(p_tracking)), p_actor
      from public.consignment_lots l where l.id = rl.lot_id;
    end loop;
  elsif p_step = 'delivered' then
    if r.status <> 'shipped' then
      raise exception 'Only a shipped return can be delivered.' using errcode = 'GC088';
    end if;
    v_to := 'delivered';
    update public.consignment_returns set status = v_to, delivered_at = coalesce(p_at, now()) where id = r.id;
  else
    raise exception 'Unknown step.' using errcode = 'GC045';
  end if;
  perform set_config('geega.consignment_write', '', true);
  return v_to;
end;
$$;

-- Cancel a return before it ships. Copies already taken off sale stay
-- unlisted; list them again from the consignment.
create or replace function public.consignment_cancel_return(p_return_id uuid, p_reason text, p_actor text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  r public.consignment_returns%rowtype;
  rl record;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into r from public.consignment_returns where id = p_return_id for update;
  if not found or r.status in ('shipped', 'delivered', 'cancelled') then
    raise exception 'Only a return that hasn''t shipped can be cancelled.' using errcode = 'GC088';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the return is cancelled.' using errcode = 'GC045';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_returns set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason) where id = r.id;
  for rl in select distinct lot_id from public.consignment_return_lines where return_id = r.id loop
    insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
    select l.id, l.consignment_id, 'return_cancelled', l.status, l.status, jsonb_build_object('returnId', r.id, 'reason', btrim(p_reason)), p_actor
    from public.consignment_lots l where l.id = rl.lot_id;
    perform public.consignment_refresh_lot_status(rl.lot_id, p_actor);
  end loop;
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- Close a consignment once nothing is left: no cards with us, no sale or
-- adjustment unpaid, no claim or return open.
create or replace function public.consignment_close(p_consignment_id uuid, p_actor text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  c public.consignments%rowtype;
  v_left integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into c from public.consignments where id = p_consignment_id for update;
  if not found then
    raise exception 'That consignment isn''t there.' using errcode = 'GC041';
  end if;
  if c.status = 'closed' then
    return;
  end if;
  select coalesce(sum(q.unlisted + q.on_sale + q.pending + greatest(q.rejected - q.returning_rejected, 0)), 0) into v_left
    from public.consignment_lots l cross join lateral public.consignment_lot_quantities(l.id) q
    where l.consignment_id = c.id;
  if v_left > 0 then
    raise exception '% card(s) are still with us. Return or sell them first.', v_left using errcode = 'GC090';
  end if;
  if exists (select 1 from public.consignment_lots where consignment_id = c.id and status in ('received', 'under_inspection')) then
    raise exception 'Some cards haven''t been inspected yet.' using errcode = 'GC090';
  end if;
  if exists (select 1 from public.consignment_sales where consignment_id = c.id and status in ('open', 'settled')) then
    raise exception 'Some sales aren''t paid out yet.' using errcode = 'GC090';
  end if;
  if exists (select 1 from public.consignment_adjustments where consignment_id = c.id and payout_id is null and voided_at is null) then
    raise exception 'Some adjustments aren''t paid out or recovered yet.' using errcode = 'GC090';
  end if;
  if exists (select 1 from public.consignment_shipping_claims cl join public.consignment_sales s on s.order_id = cl.order_id
             where s.consignment_id = c.id and cl.status <> 'closed') then
    raise exception 'A shipping claim is still open.' using errcode = 'GC090';
  end if;
  if exists (select 1 from public.consignment_returns where consignment_id = c.id and status not in ('delivered', 'cancelled')) then
    raise exception 'A return hasn''t been delivered yet.' using errcode = 'GC090';
  end if;
  perform set_config('geega.consignment_write', 'on', true);
  update public.consignments set status = 'closed' where id = c.id;
  perform set_config('geega.consignment_write', '', true);
end;
$$;

-- ============================================================ the consignor's view

-- As in 20261029120000, plus the term's end, what each card can still be
-- returned, holds on sales and why (6.4), payout due dates, each shipment's
-- record (5.6), adjustments and returns.
create or replace function public.my_consignments()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'consignmentNumber', c.consignment_number,
    'status', c.status,
    'signedAt', c.signed_at,
    'termStartedAt', c.term_started_at,
    'initialTermDays', c.initial_term_days,
    'termEndsAt', case when c.term_started_at is not null then c.term_started_at + make_interval(days => c.initial_term_days) end,
    'elections', public.consignment_current_elections(c.id),
    'agreements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'status', a.status,
        'versionNumber', v.version_number,
        'invitedAt', a.invited_at,
        'expiresAt', a.invite_expires_at,
        'signedAt', a.signed_at,
        'agreementSha256', a.rendered_sha256,
        'hasPdf', s.pdf_path is not null,
        'pdfSha256', s.pdf_sha256,
        'terms', a.terms_snapshot
      ) order by a.created_at desc)
      from public.consignment_agreements a
      join public.consignment_agreement_versions v on v.id = a.version_id
      left join public.consignment_signatures s on s.agreement_id = a.id
      where a.consignment_id = c.id and a.status <> 'void'), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'cardName', l.card_name,
        'setCode', l.set_code,
        'setName', l.set_name,
        'collectorNumber', l.collector_number,
        'finish', l.finish,
        'imageUrl', l.image_url,
        'status', l.status,
        'quantitySubmitted', l.quantity_submitted,
        'quantityAccepted', l.quantity_accepted,
        'quantityRejected', l.quantity_rejected,
        'declaredCondition', l.declared_condition,
        'condition', l.condition,
        'listPriceCents', case when l.status in ('accepted', 'listed', 'reserved_for_sale', 'sold') then l.list_price_cents end,
        'minPriceCents', case when l.status in ('accepted', 'listed', 'reserved_for_sale', 'sold') then l.min_price_cents end,
        'rejectionReason', l.rejection_reason,
        'receivedAt', b.received_at,
        'returnable', (select jsonb_build_object('accepted', r.accepted, 'rejected', r.rejected) from public.consignment_returnable(l.id) r)
      ) order by b.batch_number, l.card_name)
      from public.consignment_lots l
      left join public.consignment_receiving_batches b on b.id = l.batch_id
      where l.consignment_id = c.id), '[]'::jsonb),
    'sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cs.id,
        'cardName', l.card_name,
        'setCode', l.set_code,
        'collectorNumber', l.collector_number,
        'channel', cs.channel,
        'quantity', cs.quantity,
        'unitPriceCents', cs.unit_price_cents,
        'grossCents', cs.gross_cents,
        'soldAt', cs.sold_at,
        'shippedAt', cs.shipped_at,
        'deliveredAt', cs.delivered_at,
        'payableAt', cs.payable_at,
        'status', cs.status,
        'cancelReason', case when cs.status = 'cancelled' then cs.cancel_reason end,
        'settlement', case when cs.status in ('settled', 'paid') then jsonb_build_object(
          'marketplaceFeeCents', cs.marketplace_fee_cents,
          'processingFeeCents', cs.processing_fee_cents,
          'postageCents', cs.postage_cents,
          'insuranceCents', cs.insurance_cents,
          'otherExpenseCents', cs.other_expense_cents,
          'otherExpenseNote', cs.other_expense_note,
          'netSaleCents', cs.net_sale_cents,
          'commissionRateBps', cs.commission_rate_bps,
          'commissionCents', cs.commission_cents,
          'payoutCents', cs.payout_cents,
          'settledAt', cs.settled_at) end,
        'payoutId', cs.payout_id,
        'payoutDueOn', case when cs.status in ('open', 'settled') then cs.payout_due_on end,
        'insuranceElected', cs.insurance_elected,
        'lost', cs.lost,
        'holds', coalesce((select jsonb_agg(jsonb_build_object('reason', h.reason, 'openedAt', h.opened_at, 'resolvedAt', h.resolved_at, 'resolution', h.resolution) order by h.opened_at)
                  from public.consignment_sale_holds h where h.sale_id = cs.id), '[]'::jsonb),
        -- The shipment record (5.6). The tracking number is left out: it
        -- would show where the buyer lives.
        'shipment', (select jsonb_build_object(
            'carrier', o.tracking_carrier, 'service', o.shipping_service,
            'declaredValueCents', sh.declared_value_cents, 'includedCoverageCents', sh.included_coverage_cents,
            'insuredValueCents', sh.insured_value_cents, 'insurancePremiumCents', sh.insurance_premium_cents,
            'claim', (select jsonb_build_object('kind', cl.kind, 'status', cl.status, 'outcome', cl.outcome)
                      from public.consignment_shipping_claims cl where cl.order_id = o.id order by cl.opened_at desc limit 1))
          from public.orders o left join public.consignment_shipments sh on sh.order_id = o.id
          where o.id = cs.order_id)
      ) order by cs.sold_at desc)
      from public.consignment_sales cs
      join public.consignment_lots l on l.id = cs.lot_id
      where cs.consignment_id = c.id), '[]'::jsonb),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'amountCents', p.amount_cents,
        'saleCount', p.sale_count,
        'method', p.method,
        'paidAt', p.paid_at,
        'reference', p.reference,
        'voided', p.voided_at is not null
      ) order by p.paid_at desc)
      from public.consignment_payouts p
      where p.consignment_id = c.id), '[]'::jsonb),
    'adjustments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'amountCents', a.amount_cents, 'reason', a.reason,
        'createdAt', a.created_at, 'payoutId', a.payout_id
      ) order by a.created_at desc)
      from public.consignment_adjustments a
      where a.consignment_id = c.id and a.voided_at is null), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'returnNumber', r.return_number, 'status', r.status, 'endsConsignment', r.ends_consignment,
        'requestedAt', r.requested_at, 'shippingCostCents', r.shipping_cost_cents, 'wePayShipping', r.we_pay_shipping,
        'carrier', r.carrier, 'trackingNumber', r.tracking_number, 'shippedAt', r.shipped_at, 'deliveredAt', r.delivered_at,
        'cards', (select coalesce(sum(rl.quantity), 0) from public.consignment_return_lines rl where rl.return_id = r.id)
      ) order by r.requested_at desc)
      from public.consignment_returns r
      where r.consignment_id = c.id), '[]'::jsonb)
  ) order by c.created_at desc), '[]'::jsonb)
  from public.consignments c
  join public.consignors p on p.id = c.consignor_id
  where p.user_id = auth.uid();
$$;
revoke all on function public.my_consignments() from public, anon;
grant execute on function public.my_consignments() to authenticated, service_role;

-- ============================================================ grants

do $grants$
declare
  f text;
begin
  foreach f in array array[
    'consignment_refresh_shipment(uuid)',
    'consignment_record_insurance(uuid, integer, integer, text, text, text)',
    'consignment_mark_funds_released(uuid, timestamptz, text)',
    'consignment_open_hold(uuid, text, text, text)',
    'consignment_release_hold(uuid, text, text)',
    'consignment_add_adjustment(uuid, uuid, text, integer, text, text)',
    'consignment_void_adjustment(uuid, text, text)',
    'consignment_record_payout(uuid, uuid[], uuid[], text, text, timestamptz, text, text)',
    'consignment_open_claim(uuid, text, text, text)',
    'consignment_update_claim(uuid, text, text, timestamptz, text, integer, timestamptz, text, text)',
    'consignment_close_claim(uuid, text, jsonb, text, text)',
    'consignment_returnable(uuid)',
    'consignment_request_return(uuid, jsonb, boolean, text, text, text)',
    'consignment_approve_return(uuid, text)',
    'consignment_advance_return(uuid, text, integer, boolean, text, text, integer, timestamptz, text)',
    'consignment_cancel_return(uuid, text, text)',
    'consignment_close(uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$grants$;
grant execute on function public.consignment_payable_at(timestamptz, integer) to authenticated, service_role;
grant execute on function public.consignment_payout_due_on(timestamptz) to authenticated, service_role;
revoke all on function public.tg_consignment_sale_defaults() from public, anon, authenticated;
