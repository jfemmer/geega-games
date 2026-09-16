-- Sell Your Cards / Sell Your Collection system.
--
-- Repurposes the existing trade_ins / trade_in_items tables rather than
-- creating parallel dead tables: both were carried over from the old
-- Mongo-based site (see legacy_mongo_id), have 0 rows, and are referenced by
-- NO application code anywhere in this repo — confirmed via full-repo search
-- before writing this migration. Their schema doesn't fit the new feature
-- either (trade_ins.user_id is NOT NULL, which makes guest submissions
-- impossible), so this migration renames them and extends/replaces columns
-- to match the real requirements. Renaming (not dropping+recreating) costs
-- nothing since there is no data to lose, and avoids leaving a second,
-- confusing "why do we have two card-buying-lead tables" system.
--
-- Every public-facing write to these tables goes through service_role
-- Vercel Functions (never a direct anon/authenticated INSERT policy) — the
-- same pattern already used for orders, inventory, and campaigns. Reads are
-- staff-or-owner via RLS.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'sell_submission_status') then
    create type public.sell_submission_status as enum (
      'new',
      'reviewing',
      'contacted',
      'offer_made',
      'accepted',
      'declined',
      'completed',
      'closed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'sell_preferred_contact_method') then
    create type public.sell_preferred_contact_method as enum ('email', 'phone', 'text');
  end if;

  if not exists (select 1 from pg_type where typname = 'sell_transaction_preference') then
    create type public.sell_transaction_preference as enum ('local', 'ship', 'either', 'not_sure');
  end if;

  if not exists (select 1 from pg_type where typname = 'sell_collection_size') then
    create type public.sell_collection_size as enum (
      'under_100',
      '100_to_500',
      '500_to_1000',
      '1000_to_5000',
      '5000_to_10000',
      '10000_plus',
      'not_sure'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'sell_timeline') then
    create type public.sell_timeline as enum ('asap', 'within_week', 'within_month', 'no_rush');
  end if;

  if not exists (select 1 from pg_type where typname = 'sell_priority') then
    create type public.sell_priority as enum ('normal', 'high_interest');
  end if;

  if not exists (select 1 from pg_type where typname = 'sell_card_match_status') then
    create type public.sell_card_match_status as enum ('matched', 'ambiguous', 'unmatched');
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Rename the legacy, unused tables into the new domain (idempotent: only
-- runs if the old name still exists and the new one doesn't yet).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'trade_ins')
     and not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'sell_submissions') then
    alter table public.trade_ins rename to sell_submissions;
  end if;

  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'trade_in_items')
     and not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'sell_submission_cards') then
    alter table public.trade_in_items rename to sell_submission_cards;
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- sell_submissions
-- ---------------------------------------------------------------------------

-- Guests must be able to submit — drop the old required-account constraint.
alter table public.sell_submissions alter column user_id drop not null;

alter table public.sell_submissions alter column first_name set not null;
alter table public.sell_submissions alter column last_name set not null;
alter table public.sell_submissions alter column email set not null;

-- Replace the old trade_in_status column with the new, wider status set.
-- 0 rows exist, so there is no data to migrate.
alter table public.sell_submissions drop column if exists status;
alter table public.sell_submissions
  add column status public.sell_submission_status not null default 'new';

alter table public.sell_submissions add column if not exists reference_number text;
alter table public.sell_submissions
  add column if not exists preferred_contact_method public.sell_preferred_contact_method not null default 'email';
alter table public.sell_submissions add column if not exists city text;
alter table public.sell_submissions add column if not exists state text;
alter table public.sell_submissions add column if not exists zip text;
alter table public.sell_submissions
  add column if not exists transaction_preference public.sell_transaction_preference not null default 'not_sure';
alter table public.sell_submissions add column if not exists collection_size public.sell_collection_size;
alter table public.sell_submissions add column if not exists collection_types text[] not null default '{}';
alter table public.sell_submissions add column if not exists collection_eras text[] not null default '{}';
alter table public.sell_submissions add column if not exists timeline public.sell_timeline;
alter table public.sell_submissions add column if not exists valuable_cards_notes text;
alter table public.sell_submissions add column if not exists referral_source text;
alter table public.sell_submissions add column if not exists priority public.sell_priority not null default 'normal';
alter table public.sell_submissions add column if not exists favorited boolean not null default false;
alter table public.sell_submissions add column if not exists contacted_at timestamptz;
alter table public.sell_submissions add column if not exists closed_at timestamptz;
alter table public.sell_submissions
  add column if not exists purchase_amount_cents integer check (purchase_amount_cents >= 0);
alter table public.sell_submissions alter column source set default 'sell_page';

comment on table public.sell_submissions is
  'Sell Your Cards / Sell Your Collection leads. Guest-submittable; every write happens server-side with the service_role key.';
comment on column public.sell_submissions.estimated_value_cents is
  'Internal reference estimate computed from Scryfall prices of identified cards. NEVER shown to the seller as an offer — condition, liquidity, and physical inspection all matter.';
comment on column public.sell_submissions.offer_value_cents is
  'Internal: an offer amount staff record if/when one is made. Never auto-generated or auto-exposed to the seller.';
comment on column public.sell_submissions.purchase_amount_cents is
  'Internal: the final amount actually paid, if the transaction completes.';
comment on column public.sell_submissions.internal_notes is
  'Staff-only. Never returned by any customer-facing endpoint.';

-- Human-friendly reference number (GG-S-100001, GG-S-100002, ...), assigned
-- once at insert time via trigger so the column can be NOT NULL + UNIQUE from
-- the start.
create sequence if not exists public.sell_submission_reference_seq start with 100001;

create or replace function public.tg_set_sell_submission_reference()
returns trigger
language plpgsql
as $function$
begin
  if new.reference_number is null then
    new.reference_number := 'GG-S-' || nextval('public.sell_submission_reference_seq')::text;
  end if;
  return new;
end;
$function$;

drop trigger if exists set_reference_number on public.sell_submissions;
create trigger set_reference_number
  before insert on public.sell_submissions
  for each row execute function public.tg_set_sell_submission_reference();

alter table public.sell_submissions alter column reference_number set not null;
create unique index if not exists sell_submissions_reference_number_key
  on public.sell_submissions (reference_number);

create index if not exists sell_submissions_status_idx on public.sell_submissions (status);
create index if not exists sell_submissions_created_idx on public.sell_submissions (created_at desc);
create index if not exists sell_submissions_user_idx on public.sell_submissions (user_id);
create index if not exists sell_submissions_email_idx on public.sell_submissions (email);

drop trigger if exists set_updated_at on public.sell_submissions;
create trigger set_updated_at
  before update on public.sell_submissions
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- sell_submission_cards (renamed from trade_in_items)
-- ---------------------------------------------------------------------------
alter table public.sell_submission_cards rename column trade_in_id to submission_id;

alter table public.sell_submission_cards add column if not exists collector_number text;
alter table public.sell_submission_cards add column if not exists raw_input text;
alter table public.sell_submission_cards
  add column if not exists match_status public.sell_card_match_status not null default 'matched';
alter table public.sell_submission_cards add column if not exists seller_notes text;
alter table public.sell_submission_cards
  add column if not exists scryfall_price_cents integer check (scryfall_price_cents >= 0);

comment on table public.sell_submission_cards is
  'Individually identified/pasted cards on a sell submission. condition = null means the seller selected "Unsure". raw_input preserves the original pasted line when a card could not be confidently matched (match_status <> matched), so nothing the seller typed is ever silently discarded.';

create index if not exists sell_submission_cards_submission_idx
  on public.sell_submission_cards (submission_id);

-- ---------------------------------------------------------------------------
-- sell_submission_photos (new)
-- ---------------------------------------------------------------------------
create table if not exists public.sell_submission_photos (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid not null references public.sell_submissions (id) on delete cascade,
  storage_path      text not null,
  original_filename text not null,
  mime_type         text not null,
  size_bytes        integer not null check (size_bytes >= 0),
  created_at        timestamptz not null default now()
);

comment on table public.sell_submission_photos is
  'Collection photos for a sell submission. Bytes live in the private sell-photos Storage bucket — this table is metadata only.';

create index if not exists sell_submission_photos_submission_idx
  on public.sell_submission_photos (submission_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — staff-or-owner reads only. No INSERT/UPDATE/DELETE
-- grants to anon/authenticated: every write (create, status change, internal
-- notes, offer/purchase amounts, favoriting) happens through staff-gated or
-- validated Vercel Functions using the service_role key, which bypasses RLS
-- entirely. This mirrors the card_scans / scan_sessions pattern exactly.
-- ---------------------------------------------------------------------------
alter table public.sell_submissions enable row level security;
alter table public.sell_submission_cards enable row level security;
alter table public.sell_submission_photos enable row level security;

drop policy if exists trade_ins_select_own on public.sell_submissions;
drop policy if exists trade_ins_insert_own on public.sell_submissions;
drop policy if exists trade_ins_staff_update on public.sell_submissions;
drop policy if exists sell_submissions_select on public.sell_submissions;
create policy sell_submissions_select
  on public.sell_submissions for select to authenticated
  using (public.is_staff() or user_id = auth.uid());

drop policy if exists trade_in_items_select_own on public.sell_submission_cards;
drop policy if exists trade_in_items_insert_own on public.sell_submission_cards;
drop policy if exists sell_submission_cards_select on public.sell_submission_cards;
create policy sell_submission_cards_select
  on public.sell_submission_cards for select to authenticated
  using (
    exists (
      select 1 from public.sell_submissions s
      where s.id = sell_submission_cards.submission_id
        and (public.is_staff() or s.user_id = auth.uid())
    )
  );

drop policy if exists sell_submission_photos_select on public.sell_submission_photos;
create policy sell_submission_photos_select
  on public.sell_submission_photos for select to authenticated
  using (
    exists (
      select 1 from public.sell_submissions s
      where s.id = sell_submission_photos.submission_id
        and (public.is_staff() or s.user_id = auth.uid())
    )
  );

grant select on public.sell_submissions to authenticated;
grant select on public.sell_submission_cards to authenticated;
grant select on public.sell_submission_photos to authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.sell_submissions, public.sell_submission_cards, public.sell_submission_photos
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket for collection photos (private; staff read via signed URLs
-- minted with their own session, uploads via service_role-minted signed
-- upload URLs — same pattern as the card-scans bucket).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('sell-photos', 'sell-photos', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'sell_photos_staff_read'
  ) then
    create policy sell_photos_staff_read
      on storage.objects for select to authenticated
      using (bucket_id = 'sell-photos' and public.is_staff());
  end if;
end$$;

commit;
