-- Collection sorting: customers drop off their Magic collection locally or
-- ship it in, Geega Games sorts it, and the customer approves and pays one
-- itemized quote before it comes back.
--
-- Shipping policy (owner, 2026-10-17), which the tables below hold us to:
--   * customers pay for shipping their cards to us (supplies, postage and any
--     insurance); we send no inbound labels or packing materials;
--   * return shipping isn't part of the per-1,000-card sorting rates: it is
--     quoted from the collection's size, weight, packaging and destination,
--     together with any return packaging and supplies, as line items of the
--     one total the customer approves and pays;
--   * an approved total is never changed without the customer's say-so: a
--     change is a new quote version the customer has to approve.
--
-- Tables
--   sorting_service_options  the advertised per-1,000-card rates (staff edit
--                            them in the admin; the storefront reads the
--                            active ones).
--   sorting_requests         one request per collection. The option, rate,
--                            estimate, return address and the exact shipping
--                            terms the customer agreed to are snapshots, so the
--                            request reads the same however the rates or the
--                            customer's address book change later.
--   sorting_quotes           itemized quotes, versioned. A quote can be edited
--                            only while it's a draft; once sent it is frozen
--                            (a trigger refuses any change to its amounts),
--                            and its total is always the sum of its items.
--                            sorting_requests.accepted_quote_id is the one the
--                            customer approved: the binding total.
--   sorting_payments         append-only: card payments (Stripe) and payments
--                            staff record in person. Keeps
--                            sorting_requests.amount_paid_cents up to date.
--
-- Same lockdown as photo_requests and sell_submissions: anon/authenticated
-- can't write any of these. Every write goes through the API with the
-- service_role key (and the functions below); staff read via RLS. Customers
-- see their own requests through my_sorting_requests() and the quote page's
-- API, never the tables.
--
-- Also: the sidebar badge count for new requests (admin_nav_badges) and a
-- 'sorting_request' staff push notification kind.

-- ---------------------------------------------------------------------------
-- sorting_service_options
-- ---------------------------------------------------------------------------

create table if not exists public.sorting_service_options (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 400),
  rate_per_thousand_cents integer not null check (rate_per_thousand_cents between 1 and 10000000),
  sort_order integer not null default 0 check (sort_order between -1000 and 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

comment on table public.sorting_service_options is
  'Advertised collection-sorting rates, per 1,000 cards. Return shipping is never part of a rate. Staff edit them through /api/admin/sorting-options (service_role); anyone can read the active ones.';

create index if not exists sorting_service_options_active_order_idx
  on public.sorting_service_options (active, sort_order, name);
create index if not exists sorting_service_options_updated_by_idx
  on public.sorting_service_options (updated_by);

drop trigger if exists sorting_service_options_set_updated_at on public.sorting_service_options;
create trigger sorting_service_options_set_updated_at
  before update on public.sorting_service_options
  for each row execute function public.tg_set_updated_at();

alter table public.sorting_service_options enable row level security;

drop policy if exists sorting_service_options_select on public.sorting_service_options;
create policy sorting_service_options_select
  on public.sorting_service_options for select to anon, authenticated
  using (active or (select public.is_staff()));

revoke all on public.sorting_service_options from anon, authenticated;
grant select on public.sorting_service_options to anon, authenticated;

-- ---------------------------------------------------------------------------
-- sorting_requests
-- ---------------------------------------------------------------------------

create sequence if not exists public.sorting_request_reference_seq start with 1001;

create table if not exists public.sorting_requests (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique
    default ('GG-SR-' || nextval('public.sorting_request_reference_seq')::text),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text not null check (char_length(last_name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 320),
  phone text check (phone is null or char_length(phone) <= 40),
  -- The rate the customer saw, as it was then.
  option_id uuid references public.sorting_service_options (id) on delete set null,
  option_name text not null check (char_length(option_name) between 1 and 80),
  rate_per_thousand_cents integer not null check (rate_per_thousand_cents between 1 and 10000000),
  estimated_cards integer not null check (estimated_cards between 1 and 1000000),
  estimated_sorting_cents integer not null check (estimated_sorting_cents >= 0),
  delivery_method text not null check (delivery_method in ('drop_off', 'ship')),
  -- Where a shipped collection goes back to: a copy of the address, plus the
  -- address-book entry it came from (if any).
  return_address_id uuid references public.addresses (id) on delete set null,
  return_recipient text check (return_recipient is null or char_length(return_recipient) between 1 and 200),
  return_line1 text check (return_line1 is null or char_length(return_line1) between 1 and 200),
  return_line2 text check (return_line2 is null or char_length(return_line2) <= 200),
  return_city text check (return_city is null or char_length(return_city) between 1 and 100),
  return_state text check (return_state is null or public.us_state_code(return_state) = return_state),
  return_postal_code text check (return_postal_code is null or return_postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  return_country text check (return_country is null or return_country = 'US'),
  -- The exact words of the shipping checkbox the customer ticked, and when.
  shipping_terms_accepted_at timestamptz,
  shipping_terms_text text check (shipping_terms_text is null or char_length(shipping_terms_text) <= 1000),
  customer_notes text check (customer_notes is null or char_length(customer_notes) <= 2000),
  status text not null default 'new' check (status in (
    'new', 'awaiting_cards', 'received', 'quoted', 'approved', 'sorting', 'ready', 'returned', 'cancelled'
  )),
  status_changed_at timestamptz not null default now(),
  counted_cards integer check (counted_cards is null or counted_cards between 0 and 10000000),
  internal_notes text check (internal_notes is null or char_length(internal_notes) <= 10000),
  accepted_quote_id uuid,
  amount_paid_cents integer not null default 0 check (amount_paid_cents >= 0),
  stripe_payment_intent_id text check (stripe_payment_intent_id is null or char_length(stripe_payment_intent_id) <= 255),
  return_carrier text check (return_carrier is null or char_length(return_carrier) <= 40),
  return_tracking_number text check (return_tracking_number is null or char_length(return_tracking_number) <= 80),
  received_at timestamptz,
  returned_at timestamptz,
  cancelled_at timestamptz,
  constraint sorting_requests_ship_details check (
    delivery_method <> 'ship' or (
      return_recipient is not null and return_line1 is not null and return_city is not null
      and return_state is not null and return_postal_code is not null and return_country is not null
      and shipping_terms_accepted_at is not null and shipping_terms_text is not null
    )
  )
);

comment on table public.sorting_requests is
  'Collection sorting requests. Written only by /api/sorting-requests, /api/sorting-quote and /api/admin/sorting-requests/:id (service_role); staff read-only via RLS; customers read their own through my_sorting_requests().';
comment on column public.sorting_requests.shipping_terms_text is
  'The exact shipping checkbox wording the customer agreed to (shipped collections), kept with the time they agreed.';
comment on column public.sorting_requests.accepted_quote_id is
  'The quote the customer approved — the binding total. Only sorting_accept_quote() sets it.';
comment on column public.sorting_requests.amount_paid_cents is
  'Sum of sorting_payments for this request, kept up to date by a trigger on sorting_payments.';

create index if not exists sorting_requests_status_created_at_idx
  on public.sorting_requests (status, created_at desc);
create index if not exists sorting_requests_email_created_at_idx
  on public.sorting_requests (email, created_at desc);
create index if not exists sorting_requests_user_id_idx on public.sorting_requests (user_id);
create index if not exists sorting_requests_option_id_idx on public.sorting_requests (option_id);
create index if not exists sorting_requests_return_address_id_idx on public.sorting_requests (return_address_id);

drop trigger if exists sorting_requests_set_updated_at on public.sorting_requests;
create trigger sorting_requests_set_updated_at
  before update on public.sorting_requests
  for each row execute function public.tg_set_updated_at();

-- When the status moves: stamp it, and the milestones staff look back on.
create or replace function public.tg_sorting_request_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    if new.status = 'received' then new.received_at := coalesce(new.received_at, now()); end if;
    if new.status = 'returned' then new.returned_at := coalesce(new.returned_at, now()); end if;
    if new.status = 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now()); end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sorting_requests_status_stamps on public.sorting_requests;
create trigger sorting_requests_status_stamps
  before update of status on public.sorting_requests
  for each row execute function public.tg_sorting_request_status();

-- ---------------------------------------------------------------------------
-- sorting_quotes
-- ---------------------------------------------------------------------------

create table if not exists public.sorting_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sorting_requests (id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'declined', 'superseded')),
  -- The count the sorting cost is based on.
  counted_cards integer check (counted_cards is null or counted_cards between 0 and 10000000),
  sorting_service_cents integer not null default 0 check (sorting_service_cents between 0 and 10000000),
  return_shipping_cents integer not null default 0 check (return_shipping_cents between 0 and 10000000),
  return_packaging_cents integer not null default 0 check (return_packaging_cents between 0 and 10000000),
  -- Other agreed charges: [{"label": "...", "amountCents": 123}, ...] (at most 5).
  other_charges jsonb not null default '[]'::jsonb,
  -- Always the sum of the items above (set by the trigger, never by hand).
  total_cents integer not null default 0 check (total_cents >= 0),
  note_to_customer text check (note_to_customer is null or char_length(note_to_customer) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  declined_at timestamptz,
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 1000),
  superseded_at timestamptz,
  constraint sorting_quotes_request_version_key unique (request_id, version),
  constraint sorting_quotes_id_request_key unique (id, request_id)
);

comment on table public.sorting_quotes is
  'Itemized collection-sorting quotes, versioned. Editable only as a draft; frozen once sent (tg_sorting_quote_guard). total_cents is always the sum of the items.';

-- One draft, and one quote waiting on the customer, per request at a time.
create unique index if not exists sorting_quotes_one_draft_idx
  on public.sorting_quotes (request_id) where status = 'draft';
create unique index if not exists sorting_quotes_one_sent_idx
  on public.sorting_quotes (request_id) where status = 'sent';
create index if not exists sorting_quotes_created_by_idx on public.sorting_quotes (created_by);
create index if not exists sorting_quotes_sent_by_idx on public.sorting_quotes (sent_by);

-- The approved quote must be one of this request's own quotes.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sorting_requests_accepted_quote_fk'
  ) then
    alter table public.sorting_requests
      add constraint sorting_requests_accepted_quote_fk
      foreign key (accepted_quote_id, id) references public.sorting_quotes (id, request_id);
  end if;
end$$;

create index if not exists sorting_requests_accepted_quote_idx
  on public.sorting_requests (accepted_quote_id, id);

drop trigger if exists sorting_quotes_set_updated_at on public.sorting_quotes;
create trigger sorting_quotes_set_updated_at
  before update on public.sorting_quotes
  for each row execute function public.tg_set_updated_at();

-- The rules that make an approved total safe to rely on:
--   * quotes are born drafts; a draft's total is recomputed from its items on
--     every write, and other_charges is checked item by item;
--   * once sent, nothing that was quoted can change — not an amount, not the
--     note, not who sent it or when. The only moves left are sent → accepted /
--     declined / superseded and accepted → superseded (a newer approved
--     version replaces it);
--   * a sent quote can't be deleted.
create or replace function public.tg_sorting_quote_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_label text;
  v_amount numeric;
  v_other integer := 0;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'A quote that has been sent to the customer can''t be deleted.' using errcode = 'GGS01';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' and new.status <> 'draft' then
    raise exception 'New quotes start as drafts.' using errcode = 'GGS02';
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' then
    if new.request_id is distinct from old.request_id
       or new.version is distinct from old.version
       or new.counted_cards is distinct from old.counted_cards
       or new.sorting_service_cents is distinct from old.sorting_service_cents
       or new.return_shipping_cents is distinct from old.return_shipping_cents
       or new.return_packaging_cents is distinct from old.return_packaging_cents
       or new.other_charges is distinct from old.other_charges
       or new.total_cents is distinct from old.total_cents
       or new.note_to_customer is distinct from old.note_to_customer
       or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by
       or new.sent_at is distinct from old.sent_at
       or new.sent_by is distinct from old.sent_by
       or (old.accepted_at is not null and new.accepted_at is distinct from old.accepted_at)
       or (old.declined_at is not null and new.declined_at is distinct from old.declined_at)
       or (old.status <> 'sent' and new.decline_reason is distinct from old.decline_reason) then
      raise exception 'This quote was sent to the customer, so it can''t be changed. Make a revised quote instead.'
        using errcode = 'GGS01';
    end if;
    if new.status is distinct from old.status and not (
      (old.status = 'sent' and new.status in ('accepted', 'declined', 'superseded'))
      or (old.status = 'accepted' and new.status = 'superseded')
    ) then
      raise exception 'This quote is %, so it can''t become %.', old.status, new.status using errcode = 'GGS02';
    end if;
    return new;
  end if;

  -- A draft (new, edited, or being sent): check the items and total them up.
  if jsonb_typeof(new.other_charges) is distinct from 'array' or jsonb_array_length(new.other_charges) > 5 then
    raise exception 'Other charges must be a list of up to 5 items.' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(new.other_charges) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'amountCents') is distinct from 'number' then
      raise exception 'Each other charge needs a description and an amount.' using errcode = '22023';
    end if;
    v_label := btrim(coalesce(v_item ->> 'label', ''));
    if char_length(v_label) not between 1 and 80 then
      raise exception 'Each other charge needs a short description (up to 80 characters).' using errcode = '22023';
    end if;
    v_amount := (v_item ->> 'amountCents')::numeric;
    if v_amount <> trunc(v_amount) or v_amount < 0 or v_amount > 10000000 then
      raise exception 'Other charges must be whole cents between $0 and $100,000.' using errcode = '22023';
    end if;
    v_other := v_other + v_amount::integer;
  end loop;

  new.total_cents := new.sorting_service_cents + new.return_shipping_cents + new.return_packaging_cents + v_other;

  if new.status = 'draft' then
    new.sent_at := null;
    new.sent_by := null;
    new.accepted_at := null;
    new.declined_at := null;
    new.decline_reason := null;
    new.superseded_at := null;
  elsif new.status = 'sent' then
    new.sent_at := coalesce(new.sent_at, now());
  else
    raise exception 'A draft can only be sent.' using errcode = 'GGS02';
  end if;
  return new;
end;
$$;

drop trigger if exists sorting_quotes_guard on public.sorting_quotes;
create trigger sorting_quotes_guard
  before insert or update or delete on public.sorting_quotes
  for each row execute function public.tg_sorting_quote_guard();

-- ---------------------------------------------------------------------------
-- sorting_payments
-- ---------------------------------------------------------------------------

create table if not exists public.sorting_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sorting_requests (id) on delete restrict,
  -- The approved quote the payment was made against.
  quote_id uuid references public.sorting_quotes (id) on delete set null,
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  method text not null check (method in ('card_online', 'in_store_card', 'cash', 'other')),
  -- Stripe PaymentIntent id for card payments: one payment per intent.
  provider_reference text unique
    check (provider_reference is null or char_length(provider_reference) between 1 and 255),
  note text check (note is null or char_length(note) <= 500),
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.sorting_payments is
  'Append-only payments for collection sorting: card payments (Stripe, provider_reference = PaymentIntent id) and in-person payments staff record. Written only by sorting_record_payment().';

create index if not exists sorting_payments_request_id_idx on public.sorting_payments (request_id, created_at);
create index if not exists sorting_payments_quote_id_idx on public.sorting_payments (quote_id);
create index if not exists sorting_payments_recorded_by_idx on public.sorting_payments (recorded_by);

-- Payments are a ledger: never edited or removed (only the links to a deleted
-- staff account or quote may be cleared).
create or replace function public.tg_sorting_payment_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payments can''t be deleted.' using errcode = 'GGS01';
  end if;
  if new.request_id is distinct from old.request_id
     or new.amount_cents is distinct from old.amount_cents
     or new.method is distinct from old.method
     or new.provider_reference is distinct from old.provider_reference
     or new.note is distinct from old.note
     or new.created_at is distinct from old.created_at
     or (new.recorded_by is distinct from old.recorded_by and new.recorded_by is not null)
     or (new.quote_id is distinct from old.quote_id and new.quote_id is not null) then
    raise exception 'Payments can''t be changed.' using errcode = 'GGS01';
  end if;
  return new;
end;
$$;

drop trigger if exists sorting_payments_guard on public.sorting_payments;
create trigger sorting_payments_guard
  before update or delete on public.sorting_payments
  for each row execute function public.tg_sorting_payment_guard();

create or replace function public.tg_sorting_payment_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.sorting_requests r
  set amount_paid_cents = (
    select coalesce(sum(p.amount_cents), 0)::integer
    from public.sorting_payments p
    where p.request_id = new.request_id
  )
  where r.id = new.request_id;
  return null;
end;
$$;

drop trigger if exists sorting_payments_totals on public.sorting_payments;
create trigger sorting_payments_totals
  after insert on public.sorting_payments
  for each row execute function public.tg_sorting_payment_totals();

-- ---------------------------------------------------------------------------
-- RLS: staff read; nobody writes except the service role.
-- ---------------------------------------------------------------------------

alter table public.sorting_requests enable row level security;
alter table public.sorting_quotes enable row level security;
alter table public.sorting_payments enable row level security;

drop policy if exists sorting_requests_staff_select on public.sorting_requests;
create policy sorting_requests_staff_select
  on public.sorting_requests for select to authenticated
  using ((select public.is_staff()));

drop policy if exists sorting_quotes_staff_select on public.sorting_quotes;
create policy sorting_quotes_staff_select
  on public.sorting_quotes for select to authenticated
  using ((select public.is_staff()));

drop policy if exists sorting_payments_staff_select on public.sorting_payments;
create policy sorting_payments_staff_select
  on public.sorting_payments for select to authenticated
  using ((select public.is_staff()));

revoke all on public.sorting_requests, public.sorting_quotes, public.sorting_payments from anon, authenticated;
grant select on public.sorting_requests, public.sorting_quotes, public.sorting_payments to authenticated;
revoke all on sequence public.sorting_request_reference_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Quote and payment moves (service role only: the API calls these). Each
-- locks the request first, so a quote can't be accepted while staff send a
-- newer one, and a payment can't be counted twice.
-- ---------------------------------------------------------------------------

-- Send a draft to the customer. Any earlier quote still waiting on them is
-- replaced by this one (a quote they already approved stays the binding one
-- until they approve this revision).
create or replace function public.sorting_send_quote(p_quote_id uuid, p_actor uuid default null)
returns public.sorting_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.sorting_requests;
  v_quote public.sorting_quotes;
  v_request_id uuid;
begin
  if not public.staff_or_service_role() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select q.request_id into v_request_id from public.sorting_quotes q where q.id = p_quote_id;
  if v_request_id is null then
    raise exception 'Quote not found.' using errcode = 'GGS03';
  end if;
  select * into v_request from public.sorting_requests where id = v_request_id for update;
  select * into v_quote from public.sorting_quotes where id = p_quote_id for update;
  if v_quote.status <> 'draft' then
    raise exception 'This quote was already sent.' using errcode = 'GGS02';
  end if;
  if v_request.status in ('returned', 'cancelled') then
    raise exception 'This request is %, so it can''t get a new quote.', v_request.status using errcode = 'GGS04';
  end if;

  update public.sorting_quotes
    set status = 'superseded', superseded_at = now()
    where request_id = v_request.id and status = 'sent';
  update public.sorting_quotes
    set status = 'sent', sent_at = now(), sent_by = p_actor
    where id = p_quote_id
    returning * into v_quote;
  update public.sorting_requests
    set status = 'quoted'
    where id = v_request.id and status in ('new', 'awaiting_cards', 'received');
  return v_quote;
end;
$$;

-- The customer approves the quote waiting on them. It becomes the binding
-- total (replacing any earlier approved version). Approving twice is a no-op.
create or replace function public.sorting_accept_quote(p_request_id uuid, p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.sorting_requests;
  v_quote public.sorting_quotes;
  v_previous uuid;
begin
  if not public.staff_or_service_role() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_request from public.sorting_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found.' using errcode = 'GGS03';
  end if;
  select * into v_quote from public.sorting_quotes
    where id = p_quote_id and request_id = p_request_id for update;
  if not found then
    raise exception 'Quote not found.' using errcode = 'GGS03';
  end if;
  if v_quote.status = 'accepted' then
    return jsonb_build_object(
      'quote_id', v_quote.id, 'total_cents', v_quote.total_cents,
      'amount_paid_cents', v_request.amount_paid_cents, 'previous_quote_id', null, 'already', true
    );
  end if;
  if v_quote.status <> 'sent' then
    raise exception 'This quote is no longer open.' using errcode = 'GGS02';
  end if;
  if v_request.status = 'cancelled' then
    raise exception 'This request was cancelled.' using errcode = 'GGS04';
  end if;

  v_previous := v_request.accepted_quote_id;
  if v_previous is not null then
    update public.sorting_quotes
      set status = 'superseded', superseded_at = now()
      where id = v_previous and status = 'accepted';
  end if;
  update public.sorting_quotes
    set status = 'accepted', accepted_at = now()
    where id = v_quote.id
    returning * into v_quote;
  update public.sorting_requests
    set accepted_quote_id = v_quote.id,
        status = case when status = 'quoted' then 'approved' else status end
    where id = p_request_id
    returning * into v_request;
  return jsonb_build_object(
    'quote_id', v_quote.id, 'total_cents', v_quote.total_cents,
    'amount_paid_cents', v_request.amount_paid_cents, 'previous_quote_id', v_previous, 'already', false
  );
end;
$$;

-- The customer turns down the quote waiting on them (an approved earlier
-- version, if any, stays the binding one). Declining twice is a no-op.
create or replace function public.sorting_decline_quote(p_request_id uuid, p_quote_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.sorting_quotes;
begin
  if not public.staff_or_service_role() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform 1 from public.sorting_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found.' using errcode = 'GGS03';
  end if;
  select * into v_quote from public.sorting_quotes
    where id = p_quote_id and request_id = p_request_id for update;
  if not found then
    raise exception 'Quote not found.' using errcode = 'GGS03';
  end if;
  if v_quote.status = 'declined' then
    return jsonb_build_object('quote_id', v_quote.id, 'already', true);
  end if;
  if v_quote.status <> 'sent' then
    raise exception 'This quote is no longer open.' using errcode = 'GGS02';
  end if;
  update public.sorting_quotes
    set status = 'declined', declined_at = now(), decline_reason = nullif(btrim(coalesce(p_reason, '')), '')
    where id = v_quote.id;
  return jsonb_build_object('quote_id', v_quote.id, 'already', false);
end;
$$;

-- Record a payment against the approved quote. A card payment carries its
-- Stripe PaymentIntent id, so the webhook and the page's own confirmation
-- can both report it and it's still counted once.
create or replace function public.sorting_record_payment(
  p_request_id uuid,
  p_amount_cents integer,
  p_method text,
  p_reference text default null,
  p_note text default null,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.sorting_requests;
  v_payment_id uuid;
  v_total integer;
begin
  if not public.staff_or_service_role() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_request from public.sorting_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found.' using errcode = 'GGS03';
  end if;
  if v_request.accepted_quote_id is null then
    raise exception 'There''s no approved quote to pay yet.' using errcode = 'GGS04';
  end if;
  select q.total_cents into v_total from public.sorting_quotes q where q.id = v_request.accepted_quote_id;

  if p_reference is not null then
    select p.id into v_payment_id from public.sorting_payments p where p.provider_reference = p_reference;
    if v_payment_id is not null then
      return jsonb_build_object(
        'payment_id', v_payment_id, 'inserted', false,
        'amount_paid_cents', v_request.amount_paid_cents, 'total_cents', v_total
      );
    end if;
  end if;

  insert into public.sorting_payments (request_id, quote_id, amount_cents, method, provider_reference, note, recorded_by)
  values (
    p_request_id, v_request.accepted_quote_id, p_amount_cents, p_method, p_reference,
    nullif(btrim(coalesce(p_note, '')), ''), p_actor
  )
  returning id into v_payment_id;

  select r.amount_paid_cents into v_request.amount_paid_cents
  from public.sorting_requests r where r.id = p_request_id;
  return jsonb_build_object(
    'payment_id', v_payment_id, 'inserted', true,
    'amount_paid_cents', v_request.amount_paid_cents, 'total_cents', v_total
  );
end;
$$;

revoke all on function public.sorting_send_quote(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sorting_accept_quote(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sorting_decline_quote(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.sorting_record_payment(uuid, integer, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.sorting_send_quote(uuid, uuid) to service_role;
grant execute on function public.sorting_accept_quote(uuid, uuid) to service_role;
grant execute on function public.sorting_decline_quote(uuid, uuid, text) to service_role;
grant execute on function public.sorting_record_payment(uuid, integer, text, text, text, uuid) to service_role;

-- A signed-in customer's own requests, for the account page: what they
-- asked for, where it stands, the latest quote they were sent, the total
-- they approved and what they've paid. Never staff-only columns.
create or replace function public.my_sorting_requests()
returns table (
  id uuid,
  reference_number text,
  created_at timestamptz,
  status text,
  delivery_method text,
  option_name text,
  estimated_cards integer,
  email text,
  quote_status text,
  quote_total_cents integer,
  accepted_total_cents integer,
  amount_paid_cents integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id, r.reference_number, r.created_at, r.status, r.delivery_method, r.option_name,
    r.estimated_cards, r.email, lq.status, lq.total_cents, aq.total_cents, r.amount_paid_cents
  from public.sorting_requests r
  left join lateral (
    select q.status, q.total_cents
    from public.sorting_quotes q
    where q.request_id = r.id and q.status <> 'draft'
    order by q.version desc
    limit 1
  ) lq on true
  left join public.sorting_quotes aq on aq.id = r.accepted_quote_id
  where r.user_id = (select auth.uid())
  order by r.created_at desc;
$$;

revoke all on function public.my_sorting_requests() from public, anon;
grant execute on function public.my_sorting_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin sidebar badge: new requests nobody has looked at yet.
-- (Same as the current admin_nav_badges plus new_sorting_requests.)
-- ---------------------------------------------------------------------------

create or replace function public.admin_nav_badges(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_seen timestamptz;
begin
  if public.is_staff() then
    -- Staff only ever get their own "new users" count.
    v_user := auth.uid();
  elsif public.staff_or_service_role() then
    -- The server asking on a staff member's behalf (app icon badge in pushes).
    v_user := p_user_id;
  else
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_user is not null then
    select s.seen_at into v_seen
    from public.staff_section_seen s
    where s.user_id = v_user and s.section = 'users';
  end if;

  return jsonb_build_object(
    'needs_packing', (select count(*) from public.orders where status = 'paid'),
    'open_photo_requests', (select count(*) from public.photo_requests where status = 'new'),
    'waiting_pickups', (select count(*) from public.pickup_requests where status = 'waiting'),
    'new_leads', (select count(*) from public.sell_submissions where status = 'new'),
    'new_partner_leads', (select count(*) from public.referral_leads where status = 'new'),
    'new_partner_applications', (select count(*) from public.partners where status = 'applied'),
    'new_sorting_requests', (select count(*) from public.sorting_requests where status = 'new'),
    'new_users', case when v_user is null then 0 else (
      select count(*) from public.customers c
      -- Sign-ups only; customers staff added or imported aren't news.
      where c.source in ('account_signup', 'checkout', 'newsletter')
        -- Never opened Users yet: the last week, not every customer ever.
        and c.created_at > coalesce(v_seen, now() - interval '7 days')
    ) end
  );
end;
$$;

revoke all on function public.admin_nav_badges(uuid) from public, anon;
grant execute on function public.admin_nav_badges(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Staff push notifications: every kind that exists today plus
-- sorting_request (new requests, quote replies and card payments), turned on
-- for devices that already have notifications enabled.
-- ---------------------------------------------------------------------------

alter table public.staff_push_subscriptions
  drop constraint if exists staff_push_subscriptions_kinds_check;
alter table public.staff_push_subscriptions
  add constraint staff_push_subscriptions_kinds_check
  check (kinds <@ array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup', 'photo_request', 'sorting_request']::text[]);
alter table public.staff_push_subscriptions
  alter column kinds set default array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup', 'photo_request', 'sorting_request']::text[];
update public.staff_push_subscriptions
  set kinds = array_append(kinds, 'sorting_request'), updated_at = now()
  where not ('sorting_request' = any (kinds));

do $$
begin
  if to_regclass('public.staff_apns_devices') is not null then
    alter table public.staff_apns_devices
      drop constraint if exists staff_apns_devices_kinds_check;
    alter table public.staff_apns_devices
      add constraint staff_apns_devices_kinds_check
      check (kinds <@ array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup', 'photo_request', 'sorting_request']::text[]);
    alter table public.staff_apns_devices
      alter column kinds set default array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup', 'photo_request', 'sorting_request']::text[];
    update public.staff_apns_devices
      set kinds = array_append(kinds, 'sorting_request'), updated_at = now()
      where not ('sorting_request' = any (kinds));
  end if;
end$$;
