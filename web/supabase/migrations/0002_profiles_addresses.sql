-- =============================================================================
-- 0002_profiles_addresses.sql
-- Customer profile (1:1 with auth.users), structured addresses, notification prefs.
-- Auth itself lives in Supabase auth.users. This table holds app-side profile data.
-- =============================================================================

-- ---- profiles ---------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  first_name    text,
  last_name     text,
  username      citext unique,
  phone         text,
  -- Notification preferences (JSONB keeps the legacy shape; simple + flexible).
  announcement_notifications jsonb not null default
    '{"enabled": false, "byEmail": true, "byText": false}'::jsonb,
  shipping_notifications     jsonb not null default
    '{"enabled": true,  "byEmail": true, "byText": false}'::jsonb,
  -- Migration/audit only. Never used for authorization.
  legacy_mongo_id text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.profiles.legacy_mongo_id is
  'Original MongoDB _id for migration reconciliation. Not an identity/authz source.';

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- Auto-create a profile row whenever a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name, username, phone)
  values (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    nullif(new.raw_user_meta_data ->> 'username', ''),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- addresses --------------------------------------------------------------
-- Structured (not a single formatted string). Supports multiple per user with
-- one default. Used by checkout + account, one reusable component client-side.
create table if not exists public.addresses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  label        text,                 -- e.g. 'Home', 'Shipping'
  recipient    text,                 -- name on the package
  line1        text not null,
  line2        text,
  city         text not null,
  state        text not null,
  postal_code  text not null,
  country      text not null default 'US',
  phone        text,
  is_default   boolean not null default false,
  legacy_mongo_id text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_addresses_user on public.addresses(user_id);

-- Enforce at most one default address per user.
create unique index if not exists uq_addresses_one_default
  on public.addresses(user_id)
  where is_default;

create trigger trg_addresses_updated_at
  before update on public.addresses
  for each row execute function public.tg_set_updated_at();
