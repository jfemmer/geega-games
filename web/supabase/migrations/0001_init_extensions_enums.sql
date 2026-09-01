-- =============================================================================
-- 0001_init_extensions_enums.sql
-- Extensions, enum types, and shared helper functions.
-- Everything monetary in this schema is stored as integer CENTS (bigint/int).
-- =============================================================================

-- ---- Extensions -------------------------------------------------------------
create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "citext";        -- case-insensitive email
create extension if not exists "pg_trgm";        -- trigram indexes for card-name search

-- ---- Enum types -------------------------------------------------------------

-- Application role. Source of truth is auth.users.raw_app_meta_data->>'role'
-- (app_metadata is NOT editable by end users). This enum is used by helper
-- functions and admin tables, never trusted from a client.
do $$ begin
  create type app_role as enum ('customer', 'staff', 'admin');
exception when duplicate_object then null; end $$;

-- Card condition grades.
do $$ begin
  create type card_condition as enum ('NM', 'LP', 'MP', 'HP', 'DMG');
exception when duplicate_object then null; end $$;

-- Card finish. `nonfoil`/`foil` cover the legacy boolean; others are future-proofing.
do $$ begin
  create type card_finish as enum ('nonfoil', 'foil', 'etched', 'glossy');
exception when duplicate_object then null; end $$;

-- Order lifecycle. Standardized enum (replaces legacy free-form strings).
-- Legacy mapping (applied in data-migration phase):
--   'Pending'      -> pending_payment  (or 'paid' if payment_status was paid)
--   'packing'      -> packing
--   'dropped off'  -> shipped
do $$ begin
  create type order_status as enum (
    'pending_payment',
    'paid',
    'packing',
    'ready_to_ship',
    'shipped',
    'delivered',
    'cancelled',
    'refunded'
  );
exception when duplicate_object then null; end $$;

-- Payment provider (provider-agnostic model: Stripe + PayPal/Venmo).
do $$ begin
  create type payment_provider as enum ('stripe', 'paypal', 'store_credit', 'manual');
exception when duplicate_object then null; end $$;

-- Payment status. Only a verified webhook/capture may move an order to 'paid'.
do $$ begin
  create type payment_status as enum ('unpaid', 'processing', 'paid', 'refunded', 'failed');
exception when duplicate_object then null; end $$;

-- Shipping method.
do $$ begin
  create type shipping_method as enum ('tracked', 'pwe');
exception when duplicate_object then null; end $$;

-- Trade-in lifecycle.
do $$ begin
  create type trade_in_status as enum (
    'new',
    'received',
    'evaluating',
    'offer_made',
    'accepted',
    'paid_out',
    'rejected',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

-- Store-credit ledger entry types. 'earn' paths (e.g. trade_in_payout) are
-- defined now but nothing writes them yet (earn path not built).
do $$ begin
  create type store_credit_type as enum (
    'opening_balance',   -- migration seed of legacy balances
    'admin_adjustment',  -- manual admin credit/debit
    'order_spend',       -- deduction at checkout
    'order_refund',      -- credit back on refund/cancel
    'trade_in_payout'    -- FUTURE earn path (unused for now)
  );
exception when duplicate_object then null; end $$;

-- Scanner job lifecycle (mirrors legacy ScanJob).
do $$ begin
  create type scan_job_status as enum ('queued', 'processing', 'done', 'failed');
exception when duplicate_object then null; end $$;

-- Scanner review decision lifecycle.
do $$ begin
  create type scan_review_status as enum ('pending', 'approved', 'corrected', 'rejected');
exception when duplicate_object then null; end $$;

-- ---- Helper functions -------------------------------------------------------

-- Current caller's role, read from the trusted JWT app_metadata claim.
-- Falls back to 'customer'. NEVER reads user_metadata.
-- Null-safe: an unauthenticated request leaves request.jwt.claims as '' (empty),
-- and ''::jsonb throws. We parse defensively and fall back to 'customer'.
create or replace function public.current_app_role()
returns app_role
language plpgsql
stable
as $$
declare
  v_raw text;
  v_claims jsonb;
  v_role text;
begin
  v_raw := current_setting('request.jwt.claims', true);
  if v_raw is null or v_raw = '' then
    return 'customer'::app_role;
  end if;

  begin
    v_claims := v_raw::jsonb;
  exception when others then
    return 'customer'::app_role;
  end;

  v_role := coalesce(
    nullif(v_claims -> 'app_metadata' ->> 'role', ''),   -- Supabase access-token shape
    nullif(v_claims ->> 'role', '')                       -- fallback if role is top-level
  );

  if v_role is null or v_role not in ('customer','staff','admin') then
    return 'customer'::app_role;
  end if;

  return v_role::app_role;
end;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
as $$
  select public.current_app_role() in ('staff', 'admin');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.current_app_role() = 'admin';
$$;

-- Generic updated_at trigger.
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.current_app_role() is
  'Reads role from JWT app_metadata (server-controlled). Never trusts user_metadata or client input.';
