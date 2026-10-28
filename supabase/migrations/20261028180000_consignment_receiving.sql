-- Consignments, Phase 3: receiving and inspecting cards.
--
--   consignment_receiving_batches   One shipment (or drop-off) of a consignor's
--                                   cards: when it arrived, carrier, tracking,
--                                   notes. A consignment can have several.
--   consignment_lots (extended)     Each line received: the exact printing
--                                   (resolved against Scryfall data by the API),
--                                   what the consignor said they sent, and what
--                                   staff accepted after inspection: quantity,
--                                   graded condition, finish, list price and
--                                   the consignor's minimum price.
--   consignment_lot_events          Append-only history of every lot change.
--
-- Status flow of a lot:
--   received -> under_inspection -> accepted | rejected
--   (accepted or rejected can be reopened for inspection while not listed;
--   listing, sale and return are Phase 4 and later)
--
-- Every lot write goes through consignment_receive() and
-- consignment_inspect_lot() (service role): cards can only be received for a
-- consignment whose agreement is signed, and the consignor's own numbers are
-- never taken as accepted (agreement 2.5). Nothing here creates inventory or
-- lists a card: consigned stock becomes buyable only with Phase 4's sales and
-- payout ledger.
--
-- Run after 20261028150000. Safe to run more than once.
-- Error codes: GC040-GC049.

-- ============================================================ receiving batches

create table if not exists public.consignment_receiving_batches (
  id uuid primary key default gen_random_uuid(),
  consignment_id uuid not null references public.consignments(id) on delete restrict,
  batch_number integer not null,
  received_at timestamptz not null default now(),
  method text not null default 'mail' check (method in ('mail', 'in_person')),
  carrier text check (carrier is null or char_length(carrier) <= 60),
  tracking_number text check (tracking_number is null or char_length(tracking_number) <= 60),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  created_by text,
  unique (consignment_id, batch_number)
);
create index if not exists consignment_receiving_batches_consignment_idx on public.consignment_receiving_batches (consignment_id);
comment on table public.consignment_receiving_batches is
  'A shipment or drop-off of a consignor''s cards. Written only by consignment_receive().';

-- ============================================================ lots: receiving and inspection fields

alter table public.consignment_lots
  add column if not exists batch_id uuid references public.consignment_receiving_batches(id) on delete restrict,
  add column if not exists rarity text,
  add column if not exists image_url text,
  add column if not exists market_price_cents integer check (market_price_cents is null or market_price_cents >= 0),
  add column if not exists declared_condition public.card_condition,
  add column if not exists quantity_rejected integer not null default 0 check (quantity_rejected between 0 and 9999),
  add column if not exists rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  add column if not exists inspected_at timestamptz,
  add column if not exists inspected_by text,
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by text;
create index if not exists consignment_lots_batch_idx on public.consignment_lots (batch_id);
comment on column public.consignment_lots.declared_condition is 'The condition the consignor described. condition is the grade staff gave at inspection.';
comment on column public.consignment_lots.quantity_rejected is 'Copies of this line not accepted (counted, wrong, damaged or inauthentic); they are returned to the consignor.';

-- Lots change only through the receiving and inspection functions.
create or replace function public.tg_consignment_lot_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if coalesce(current_setting('geega.consignment_write', true), '') <> 'on' then
    raise exception 'Consignment cards are changed only through Consignments > Receive Cards and inspection.' using errcode = 'GC040';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists consignment_lot_guard on public.consignment_lots;
create trigger consignment_lot_guard before insert or update or delete on public.consignment_lots
  for each row execute function public.tg_consignment_lot_guard();

-- ============================================================ lot history

create table if not exists public.consignment_lot_events (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.consignment_lots(id) on delete restrict,
  consignment_id uuid not null references public.consignments(id) on delete restrict,
  event text not null check (event in ('received', 'inspection_started', 'accepted', 'rejected', 'reopened')),
  from_status text,
  to_status text not null,
  details jsonb not null default '{}'::jsonb,
  actor text,
  created_at timestamptz not null default now()
);
create index if not exists consignment_lot_events_lot_idx on public.consignment_lot_events (lot_id, created_at);
drop trigger if exists append_only on public.consignment_lot_events;
create trigger append_only before update or delete on public.consignment_lot_events
  for each row execute function public.tg_append_only();

alter table public.consignment_receiving_batches enable row level security;
alter table public.consignment_lot_events enable row level security;
revoke all on public.consignment_receiving_batches, public.consignment_lot_events from anon, authenticated;
grant select on public.consignment_receiving_batches, public.consignment_lot_events to authenticated;
drop policy if exists receiving_batches_staff_read on public.consignment_receiving_batches;
create policy receiving_batches_staff_read on public.consignment_receiving_batches for select to authenticated using (public.is_staff());
drop policy if exists lot_events_staff_read on public.consignment_lot_events;
create policy lot_events_staff_read on public.consignment_lot_events for select to authenticated using (public.is_staff());

-- ============================================================ receiving

-- Record a shipment of a signed consignment's cards. p_lines is an array of
-- already-resolved printings:
--   { scryfallId, oracleId, cardName, setCode, setName, collectorNumber,
--     rarity, imageUrl, language, finish, declaredCondition, quantity,
--     marketPriceCents, listPriceCents, minPriceCents, notes }
-- Each becomes a lot in 'received'. Returns the batch id.
create or replace function public.consignment_receive(
  p_consignment_id uuid,
  p_lines jsonb,
  p_method text,
  p_carrier text,
  p_tracking text,
  p_notes text,
  p_actor text
) returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  c public.consignments%rowtype;
  v_batch_id uuid;
  v_batch_no integer;
  v_line jsonb;
  v_lot_id uuid;
  v_qty integer;
  v_list integer;
  v_min integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into c from public.consignments where id = p_consignment_id for update;
  if not found then
    raise exception 'That consignment isn''t there.' using errcode = 'GC041';
  end if;
  if c.signed_at is null or c.status not in ('signed', 'inventory_received', 'active') then
    raise exception 'Cards can be received only after the consignor signs the agreement.' using errcode = 'GC042';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 1000 then
    raise exception 'Add 1 to 1,000 card lines.' using errcode = 'GC043';
  end if;

  perform set_config('geega.consignment_write', 'on', true);

  select coalesce(max(batch_number), 0) + 1 into v_batch_no from public.consignment_receiving_batches where consignment_id = c.id;
  insert into public.consignment_receiving_batches (consignment_id, batch_number, method, carrier, tracking_number, notes, created_by)
  values (c.id, v_batch_no, coalesce(nullif(p_method, ''), 'mail'), nullif(btrim(p_carrier), ''), nullif(btrim(p_tracking), ''), nullif(btrim(p_notes), ''), p_actor)
  returning id into v_batch_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line ->> 'quantity')::int;
    v_list := nullif(v_line ->> 'listPriceCents', '')::int;
    v_min := nullif(v_line ->> 'minPriceCents', '')::int;
    if v_qty is null or v_qty not between 1 and 9999 then
      raise exception 'Each line needs a quantity from 1 to 9,999.' using errcode = 'GC043';
    end if;
    if coalesce(v_line ->> 'cardName', '') = '' or coalesce(v_line ->> 'setCode', '') = '' or coalesce(v_line ->> 'collectorNumber', '') = '' then
      raise exception 'Every line must be a specific printing (name, set and collector number).' using errcode = 'GC043';
    end if;
    insert into public.consignment_lots (
      consignment_id, batch_id, scryfall_id, oracle_id, card_name, set_code, set_name, collector_number, rarity, image_url,
      language, finish, declared_condition, condition, quantity_submitted, quantity_accepted, status,
      market_price_cents, list_price_cents, min_price_cents, internal_notes, created_by
    ) values (
      c.id, v_batch_id, nullif(v_line ->> 'scryfallId', '')::uuid, nullif(v_line ->> 'oracleId', '')::uuid,
      v_line ->> 'cardName', lower(v_line ->> 'setCode'), v_line ->> 'setName', v_line ->> 'collectorNumber',
      v_line ->> 'rarity', v_line ->> 'imageUrl', coalesce(nullif(v_line ->> 'language', ''), 'en'),
      coalesce(nullif(v_line ->> 'finish', ''), 'nonfoil')::public.card_finish,
      nullif(v_line ->> 'declaredCondition', '')::public.card_condition, null,
      v_qty, 0, 'received',
      nullif(v_line ->> 'marketPriceCents', '')::int, v_list, v_min, nullif(btrim(v_line ->> 'notes'), ''), p_actor
    ) returning id into v_lot_id;
    insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
    values (v_lot_id, c.id, 'received', null, 'received',
            jsonb_build_object('batch', v_batch_no, 'quantitySubmitted', v_qty, 'declaredCondition', v_line ->> 'declaredCondition'), p_actor);
  end loop;

  if c.status = 'signed' then
    update public.consignments set status = 'inventory_received' where id = c.id;
  end if;

  perform set_config('geega.consignment_write', '', true);
  return v_batch_id;
end;
$$;

-- ============================================================ inspection

-- One inspection step on a lot:
--   'start'  received -> under_inspection
--   'accept' received | under_inspection -> accepted   (quantity, graded
--            condition, finish, list price and optional minimum required;
--            copies not accepted are counted as rejected and returned)
--   'reject' received | under_inspection -> rejected   (reason required)
--   'reopen' accepted | rejected -> under_inspection   (corrections)
-- Below the minimum accepted card value is refused unless p_allow_below_minimum.
create or replace function public.consignment_inspect_lot(
  p_lot_id uuid,
  p_action text,
  p_quantity_accepted integer,
  p_condition public.card_condition,
  p_finish public.card_finish,
  p_list_price_cents integer,
  p_min_price_cents integer,
  p_reason text,
  p_allow_below_minimum boolean,
  p_actor text
) returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  l public.consignment_lots%rowtype;
  v_min_value integer;
  v_to text;
  v_event text;
  v_details jsonb := '{}'::jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into l from public.consignment_lots where id = p_lot_id for update;
  if not found then
    raise exception 'That card line isn''t there.' using errcode = 'GC041';
  end if;

  if p_action = 'start' then
    if l.status <> 'received' then
      raise exception 'Only received cards can start inspection.' using errcode = 'GC044';
    end if;
    v_to := 'under_inspection';
    v_event := 'inspection_started';
  elsif p_action = 'accept' then
    if l.status not in ('received', 'under_inspection') then
      raise exception 'Only cards being inspected can be accepted.' using errcode = 'GC044';
    end if;
    if p_quantity_accepted is null or p_quantity_accepted not between 1 and 9999 then
      raise exception 'Enter how many copies you accept (at least 1). Reject the line if none.' using errcode = 'GC045';
    end if;
    if p_condition is null then
      raise exception 'Grade the condition before accepting.' using errcode = 'GC045';
    end if;
    if p_list_price_cents is null or p_list_price_cents <= 0 then
      raise exception 'Enter a list price before accepting.' using errcode = 'GC045';
    end if;
    if p_min_price_cents is not null and (p_min_price_cents <= 0 or p_min_price_cents > p_list_price_cents) then
      raise exception 'The minimum price must be above $0 and no more than the list price.' using errcode = 'GC045';
    end if;
    select min_card_value_cents into v_min_value from public.consignment_settings where id;
    if coalesce(v_min_value, 0) > 0 and p_list_price_cents < v_min_value and not coalesce(p_allow_below_minimum, false) then
      raise exception 'This card is below the minimum accepted value of $%.', to_char(v_min_value / 100.0, 'FM999990.00') using errcode = 'GC046';
    end if;
    v_to := 'accepted';
    v_event := 'accepted';
    v_details := jsonb_build_object(
      'quantityAccepted', p_quantity_accepted,
      'quantityRejected', greatest(coalesce(l.quantity_submitted, p_quantity_accepted) - p_quantity_accepted, 0),
      'condition', p_condition, 'finish', coalesce(p_finish, l.finish),
      'listPriceCents', p_list_price_cents, 'minPriceCents', p_min_price_cents,
      'reason', nullif(btrim(p_reason), ''),
      'belowMinimum', coalesce(v_min_value, 0) > 0 and p_list_price_cents < v_min_value);
  elsif p_action = 'reject' then
    if l.status not in ('received', 'under_inspection') then
      raise exception 'Only cards being inspected can be rejected.' using errcode = 'GC044';
    end if;
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'Say why the card is rejected; the consignor sees it.' using errcode = 'GC045';
    end if;
    v_to := 'rejected';
    v_event := 'rejected';
    v_details := jsonb_build_object('reason', btrim(p_reason), 'quantityRejected', coalesce(l.quantity_submitted, 0));
  elsif p_action = 'reopen' then
    if l.status not in ('accepted', 'rejected') then
      raise exception 'Only accepted or rejected cards can be reopened.' using errcode = 'GC044';
    end if;
    if exists (select 1 from public.inventory_items i where i.consignment_lot_id = l.id) then
      raise exception 'These cards are already listed; take them off sale first.' using errcode = 'GC047';
    end if;
    v_to := 'under_inspection';
    v_event := 'reopened';
    v_details := jsonb_build_object('previous', jsonb_build_object(
      'status', l.status, 'quantityAccepted', l.quantity_accepted, 'condition', l.condition,
      'listPriceCents', l.list_price_cents, 'minPriceCents', l.min_price_cents, 'reason', l.rejection_reason));
  else
    raise exception 'Unknown inspection step.' using errcode = 'GC044';
  end if;

  perform set_config('geega.consignment_write', 'on', true);
  update public.consignment_lots set
    status = v_to,
    inspected_at = case when p_action = 'start' or inspected_at is null then now() else inspected_at end,
    inspected_by = case when p_action = 'start' or inspected_by is null then p_actor else inspected_by end,
    decided_at = case when v_to in ('accepted', 'rejected') then now() when p_action = 'reopen' then null else decided_at end,
    decided_by = case when v_to in ('accepted', 'rejected') then p_actor when p_action = 'reopen' then null else decided_by end,
    quantity_accepted = case when v_to = 'accepted' then p_quantity_accepted when v_to = 'rejected' then 0 else quantity_accepted end,
    quantity_rejected = case
      when v_to = 'accepted' then greatest(coalesce(quantity_submitted, p_quantity_accepted) - p_quantity_accepted, 0)
      when v_to = 'rejected' then coalesce(quantity_submitted, 0)
      else quantity_rejected end,
    condition = case when v_to = 'accepted' then p_condition else condition end,
    finish = case when v_to = 'accepted' then coalesce(p_finish, finish) else finish end,
    list_price_cents = case when v_to = 'accepted' then p_list_price_cents else list_price_cents end,
    min_price_cents = case when v_to = 'accepted' then p_min_price_cents else min_price_cents end,
    rejection_reason = case when v_to = 'rejected' then btrim(p_reason) when v_to = 'accepted' then nullif(btrim(p_reason), '') else rejection_reason end
  where id = l.id;
  insert into public.consignment_lot_events (lot_id, consignment_id, event, from_status, to_status, details, actor)
  values (l.id, l.consignment_id, v_event, l.status, v_to, v_details, p_actor);
  perform set_config('geega.consignment_write', '', true);
  return v_to;
end;
$$;

revoke all on function public.consignment_receive(uuid, jsonb, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.consignment_inspect_lot(uuid, text, integer, public.card_condition, public.card_finish, integer, integer, text, boolean, text) from public, anon, authenticated;
grant execute on function public.consignment_receive(uuid, jsonb, text, text, text, text, text) to service_role;
grant execute on function public.consignment_inspect_lot(uuid, text, integer, public.card_condition, public.card_finish, integer, integer, text, boolean, text) to service_role;

-- ============================================================ the consignor's view, now with their cards

-- As in 20261028150000, plus each consignment's cards: what arrived, what
-- was accepted (graded condition, list price, their minimum) or rejected and
-- why. Staff-only notes are never included.
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
        'receivedAt', b.received_at
      ) order by b.batch_number, l.card_name)
      from public.consignment_lots l
      left join public.consignment_receiving_batches b on b.id = l.batch_id
      where l.consignment_id = c.id), '[]'::jsonb)
  ) order by c.created_at desc), '[]'::jsonb)
  from public.consignments c
  join public.consignors p on p.id = c.consignor_id
  where p.user_id = auth.uid();
$$;
revoke all on function public.my_consignments() from public, anon;
grant execute on function public.my_consignments() to authenticated, service_role;
