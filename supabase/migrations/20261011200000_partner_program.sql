-- Partner program: sellers' leads go to vetted partner stores for a finder's
-- fee, people who send sellers our way earn a referral reward, and every lead
-- records where it came from.
--
--   partners           Stores that buy leads (kind 'store') and referral
--                      partners who send sellers to us (kind 'referrer':
--                      estate sale companies, estate attorneys, realtors,
--                      move managers…). Applications arrive through
--                      /api/partner-applications as status 'applied'.
--   partner_referrals  One lead passed to one partner store: when, what came
--                      of it, the sale amount, the finder's fee, and the
--                      seller's answer to the check-in email a week later.
--                      Survives the lead being deleted (lead ids go null; the
--                      reference number stays) so fee records aren't lost.
--   referral_codes     Personal ?ref= codes: one per customer account (made on
--                      first use by my_referral_code()) and one per approved
--                      referral partner (made by the admin API).
--   referral_rewards   What we owe or paid for a referred seller who sold:
--                      store credit for customers (issued at once, through
--                      store_credit_transactions) or cash for referral
--                      partners (owed until marked paid).
--
-- Same lockdown as referral_leads / sell_submissions: no anon or
-- authenticated writes at all — every write goes through the API with the
-- service_role key — and only staff can read (customers can read their own
-- referral code and rewards).

-- ---------------------------------------------------------------------------
-- Partners
-- ---------------------------------------------------------------------------

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind text not null check (kind in ('store', 'referrer')),
  status text not null default 'applied'
    check (status in ('applied', 'active', 'paused', 'declined')),
  business_name text not null check (char_length(business_name) between 1 and 200),
  contact_name text not null check (char_length(contact_name) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320),
  phone text check (phone is null or char_length(phone) <= 30),
  website text check (website is null or char_length(website) <= 300),
  city text check (city is null or char_length(city) <= 120),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  -- What a store buys. Mirrors PARTNER_CATEGORIES in src/store/lib/partnerTypes.ts.
  categories text[] not null default '{}'
    check (categories <@ array[
      'magic', 'pokemon', 'one_piece', 'video_games', 'other_tcg'
    ]::text[]),
  -- Where a store meets sellers, in its own words.
  coverage text check (coverage is null or char_length(coverage) <= 1000),
  buys_by_mail boolean not null default false,
  -- What a referral partner does. Mirrors PARTNER_PROFESSIONS.
  profession text
    check (profession is null or profession in (
      'estate_sale', 'estate_attorney', 'realtor', 'move_manager', 'auction', 'other'
    )),
  notes text check (notes is null or char_length(notes) <= 2000),
  internal_notes text check (internal_notes is null or char_length(internal_notes) <= 4000),
  -- Stores: the finder's fee they pay, as a percent of what they pay the
  -- seller. Referral partners: the fee we pay them, as a percent of the sale.
  fee_percent numeric(5, 2) not null default 8.00 check (fee_percent >= 0 and fee_percent <= 50),
  agreed_to_standards_at timestamptz not null,
  approved_at timestamptz,
  -- How the applicant found the page (same fields as the leads below).
  utm_source text check (utm_source is null or char_length(utm_source) <= 100),
  utm_medium text check (utm_medium is null or char_length(utm_medium) <= 100),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 100),
  landing_path text check (landing_path is null or char_length(landing_path) <= 200),
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 200)
);

comment on table public.partners is
  'Partner stores (buy leads, pay a finder''s fee) and referral partners (send sellers, earn a referral fee). Written only by the API (service_role); staff read-only via RLS.';
comment on column public.partners.fee_percent is
  'Stores: finder''s fee they pay, % of what they pay the seller. Referral partners: fee we pay them, % of the sale.';

create index if not exists partners_status_kind_idx on public.partners (status, kind);
create index if not exists partners_email_created_at_idx on public.partners (email, created_at desc);

drop trigger if exists partners_set_updated_at on public.partners;
create trigger partners_set_updated_at
  before update on public.partners
  for each row execute function public.tg_set_updated_at();

alter table public.partners enable row level security;

drop policy if exists partners_staff_select on public.partners;
create policy partners_staff_select
  on public.partners for select to authenticated
  using ((select public.is_staff()));

revoke all on public.partners from anon, authenticated;
grant select on public.partners to authenticated;

-- ---------------------------------------------------------------------------
-- Referral codes
-- ---------------------------------------------------------------------------

create table if not exists public.referral_codes (
  code text primary key check (code ~ '^[a-z0-9]{6,16}$'),
  created_at timestamptz not null default now(),
  user_id uuid unique references auth.users (id) on delete cascade,
  partner_id uuid unique references public.partners (id) on delete cascade,
  constraint referral_codes_one_owner check (num_nonnulls(user_id, partner_id) = 1)
);

comment on table public.referral_codes is
  'Personal ?ref= codes: customers (my_referral_code()) and approved referral partners (admin API).';

alter table public.referral_codes enable row level security;

drop policy if exists referral_codes_owner_or_staff_select on public.referral_codes;
create policy referral_codes_owner_or_staff_select
  on public.referral_codes for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));

revoke all on public.referral_codes from anon, authenticated;
grant select on public.referral_codes to authenticated;

-- ---------------------------------------------------------------------------
-- Where each lead came from
-- ---------------------------------------------------------------------------

alter table public.referral_leads
  add column if not exists referral_source text
    check (referral_source is null or char_length(referral_source) <= 100),
  add column if not exists utm_source text
    check (utm_source is null or char_length(utm_source) <= 100),
  add column if not exists utm_medium text
    check (utm_medium is null or char_length(utm_medium) <= 100),
  add column if not exists utm_campaign text
    check (utm_campaign is null or char_length(utm_campaign) <= 100),
  add column if not exists ref_code text
    references public.referral_codes (code) on delete set null,
  add column if not exists landing_path text
    check (landing_path is null or char_length(landing_path) <= 200),
  add column if not exists referrer_host text
    check (referrer_host is null or char_length(referrer_host) <= 200);

comment on column public.referral_leads.consent_to_share_at is
  'When the seller asked us to share their details with a partner store (and was told the store may pay us a referral fee). Never null — no consent, no lead.';

alter table public.sell_submissions
  add column if not exists utm_source text
    check (utm_source is null or char_length(utm_source) <= 100),
  add column if not exists utm_medium text
    check (utm_medium is null or char_length(utm_medium) <= 100),
  add column if not exists utm_campaign text
    check (utm_campaign is null or char_length(utm_campaign) <= 100),
  add column if not exists ref_code text
    references public.referral_codes (code) on delete set null,
  add column if not exists landing_path text
    check (landing_path is null or char_length(landing_path) <= 200),
  add column if not exists referrer_host text
    check (referrer_host is null or char_length(referrer_host) <= 200),
  -- The seller ticked "if Geega Games passes, share it with a partner store".
  add column if not exists partner_consent_at timestamptz;

comment on column public.sell_submissions.partner_consent_at is
  'When the seller agreed that, if Geega Games passes, their submission may go to one partner store (which may pay us a referral fee). Null: never share it.';

create index if not exists referral_leads_ref_code_idx
  on public.referral_leads (ref_code) where ref_code is not null;
create index if not exists sell_submissions_ref_code_idx
  on public.sell_submissions (ref_code) where ref_code is not null;

-- ---------------------------------------------------------------------------
-- Leads passed to partner stores
-- ---------------------------------------------------------------------------

create table if not exists public.partner_referrals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  referral_lead_id uuid references public.referral_leads (id) on delete set null,
  sell_submission_id uuid references public.sell_submissions (id) on delete set null,
  -- Kept when the lead itself is later deleted, so fee records still read.
  lead_reference text not null check (char_length(lead_reference) between 1 and 40),
  constraint partner_referrals_one_lead check (num_nonnulls(referral_lead_id, sell_submission_id) <= 1),
  sent_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz not null default now(),
  outcome text not null default 'pending'
    check (outcome in ('pending', 'sold', 'not_sold', 'no_response', 'passed')),
  outcome_at timestamptz,
  sale_amount_cents integer check (sale_amount_cents is null or sale_amount_cents >= 0),
  fee_percent numeric(5, 2) not null check (fee_percent >= 0 and fee_percent <= 50),
  fee_cents integer check (fee_cents is null or fee_cents >= 0),
  fee_status text not null default 'none' check (fee_status in ('none', 'owed', 'paid', 'waived')),
  fee_paid_at timestamptz,
  checkin_sent_at timestamptz,
  checkin_response text
    check (checkin_response is null or checkin_response in ('sold', 'not_sold', 'not_contacted')),
  checkin_amount_cents integer check (checkin_amount_cents is null or checkin_amount_cents >= 0),
  checkin_responded_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 2000)
);

comment on table public.partner_referrals is
  'A lead passed to one partner store, its outcome and finder''s fee. Written only by the API (service_role); staff read-only via RLS.';

-- One store per lead at a time: a lead can go to another store only once the
-- first one's outcome is recorded.
create unique index if not exists partner_referrals_one_open_per_lead
  on public.partner_referrals (referral_lead_id)
  where outcome = 'pending' and referral_lead_id is not null;
create unique index if not exists partner_referrals_one_open_per_submission
  on public.partner_referrals (sell_submission_id)
  where outcome = 'pending' and sell_submission_id is not null;
create index if not exists partner_referrals_partner_sent_idx
  on public.partner_referrals (partner_id, sent_at desc);
create index if not exists partner_referrals_referral_lead_idx
  on public.partner_referrals (referral_lead_id) where referral_lead_id is not null;
create index if not exists partner_referrals_sell_submission_idx
  on public.partner_referrals (sell_submission_id) where sell_submission_id is not null;
-- The seller check-in worker's queue.
create index if not exists partner_referrals_checkin_due_idx
  on public.partner_referrals (sent_at)
  where outcome = 'pending' and checkin_sent_at is null;

drop trigger if exists partner_referrals_set_updated_at on public.partner_referrals;
create trigger partner_referrals_set_updated_at
  before update on public.partner_referrals
  for each row execute function public.tg_set_updated_at();

alter table public.partner_referrals enable row level security;

drop policy if exists partner_referrals_staff_select on public.partner_referrals;
create policy partner_referrals_staff_select
  on public.partner_referrals for select to authenticated
  using ((select public.is_staff()));

revoke all on public.partner_referrals from anon, authenticated;
grant select on public.partner_referrals to authenticated;

-- ---------------------------------------------------------------------------
-- Referral rewards
-- ---------------------------------------------------------------------------

alter type public.store_credit_type add value if not exists 'referral_reward';

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- One reward per referred lead.
  referral_lead_id uuid unique references public.referral_leads (id) on delete set null,
  sell_submission_id uuid unique references public.sell_submissions (id) on delete set null,
  lead_reference text not null check (char_length(lead_reference) between 1 and 40),
  ref_code text not null check (char_length(ref_code) <= 16),
  user_id uuid references auth.users (id) on delete set null,
  -- Restrict, like partner_referrals: a referral fee record must keep saying
  -- who it's owed to (pause the partner instead of deleting it).
  partner_id uuid references public.partners (id) on delete restrict,
  kind text not null check (kind in ('store_credit', 'cash')),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'owed' check (status in ('owed', 'paid')),
  paid_at timestamptz,
  store_credit_transaction_id uuid references public.store_credit_transactions (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null
);

comment on table public.referral_rewards is
  'Rewards for referred sellers who sold: store credit for customers, cash for referral partners. Written only via grant_referral_reward() and the admin API.';

create index if not exists referral_rewards_user_idx on public.referral_rewards (user_id) where user_id is not null;
create index if not exists referral_rewards_partner_idx on public.referral_rewards (partner_id) where partner_id is not null;

alter table public.referral_rewards enable row level security;

drop policy if exists referral_rewards_owner_or_staff_select on public.referral_rewards;
create policy referral_rewards_owner_or_staff_select
  on public.referral_rewards for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));

revoke all on public.referral_rewards from anon, authenticated;
grant select on public.referral_rewards to authenticated;

-- Records a reward and, for store credit, issues the credit in the same
-- transaction, so a retried request can never pay twice (the lead columns are
-- unique). Server only: called by /api/admin/referral-rewards with the
-- service_role key after it has checked the lead, the code and the amount.
create or replace function public.grant_referral_reward(
  p_referral_lead_id uuid,
  p_sell_submission_id uuid,
  p_lead_reference text,
  p_ref_code text,
  p_user_id uuid,
  p_partner_id uuid,
  p_kind text,
  p_amount_cents integer,
  p_created_by uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward_id uuid;
  v_txn_id uuid;
begin
  if num_nonnulls(p_referral_lead_id, p_sell_submission_id) <> 1 then
    raise exception 'exactly one lead is required';
  end if;
  if num_nonnulls(p_user_id, p_partner_id) <> 1 then
    raise exception 'exactly one referrer is required';
  end if;
  if p_kind = 'store_credit' and p_user_id is null then
    raise exception 'store credit goes to a customer account';
  end if;

  insert into public.referral_rewards (
    referral_lead_id, sell_submission_id, lead_reference, ref_code,
    user_id, partner_id, kind, amount_cents, status, created_by
  ) values (
    p_referral_lead_id, p_sell_submission_id, p_lead_reference, p_ref_code,
    p_user_id, p_partner_id, p_kind, p_amount_cents, 'owed', p_created_by
  )
  returning id into v_reward_id;

  if p_kind = 'store_credit' then
    insert into public.store_credit_transactions (
      user_id, amount_cents, type, reason, reference_type, reference_id, created_by
    ) values (
      p_user_id, p_amount_cents, 'referral_reward',
      'Referral reward: a seller you referred sold (' || p_lead_reference || ')',
      'referral_reward', v_reward_id, p_created_by
    )
    returning id into v_txn_id;

    update public.referral_rewards
       set status = 'paid', paid_at = now(), store_credit_transaction_id = v_txn_id
     where id = v_reward_id;
  end if;

  return v_reward_id;
end;
$$;

revoke all on function public.grant_referral_reward(uuid, uuid, text, text, uuid, uuid, text, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.grant_referral_reward(uuid, uuid, text, text, uuid, uuid, text, integer, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Customers' own referral link
-- ---------------------------------------------------------------------------

-- The signed-in customer's referral code, made on first use. Codes avoid
-- look-alike characters (no 0/o, 1/l/i) so they survive being read aloud.
create or replace function public.my_referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_attempt integer := 0;
begin
  if v_uid is null then
    raise exception 'sign in to get a referral link' using errcode = '42501';
  end if;
  if exists (select 1 from auth.users u where u.id = v_uid and u.is_anonymous) then
    raise exception 'sign in to get a referral link' using errcode = '42501';
  end if;

  select code into v_code from public.referral_codes where user_id = v_uid;
  if v_code is not null then
    return v_code;
  end if;

  loop
    v_attempt := v_attempt + 1;
    select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1), '')
      into v_code
      from generate_series(1, 8);
    begin
      insert into public.referral_codes (code, user_id) values (v_code, v_uid);
      return v_code;
    exception when unique_violation then
      -- Either the code was taken (try another) or this user got one from a
      -- request running at the same time (return that one).
      select code into v_code from public.referral_codes where user_id = v_uid;
      if v_code is not null then
        return v_code;
      end if;
      if v_attempt >= 10 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.my_referral_code() from public, anon;
grant execute on function public.my_referral_code() to authenticated;

-- How the signed-in customer's referrals are doing. Counts only — never who
-- they referred.
create or replace function public.my_referral_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select code into v_code from public.referral_codes where user_id = v_uid;
  return jsonb_build_object(
    'code', v_code,
    'referred', case when v_code is null then 0 else
      (select count(*) from public.referral_leads where ref_code = v_code)
      + (select count(*) from public.sell_submissions where ref_code = v_code)
    end,
    'rewarded', (select count(*) from public.referral_rewards where user_id = v_uid),
    'credit_earned_cents', coalesce(
      (select sum(amount_cents) from public.referral_rewards
        where user_id = v_uid and kind = 'store_credit' and status = 'paid'), 0)
  );
end;
$$;

revoke all on function public.my_referral_summary() from public, anon;
grant execute on function public.my_referral_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin badge: partner applications waiting for a decision
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
