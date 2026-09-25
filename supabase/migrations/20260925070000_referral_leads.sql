-- Referral leads: people selling Pokémon cards, One Piece cards or video
-- games. Geega Games doesn't buy these itself — it passes the seller's
-- details (with their explicit consent) to a trusted buying partner, who
-- makes the offer. Submitted from /sell-pokemon-cards, /sell-one-piece-cards
-- and /sell-video-games via POST /api/referral-leads.
--
-- Same lockdown as sell_submissions: no anon/authenticated writes at all —
-- every insert goes through the API with the service_role key — and only
-- staff can read. Photos reuse the private sell-photos bucket (paths are
-- stored here; bytes stay in Storage).

create sequence if not exists public.referral_lead_reference_seq start with 100001;

create table if not exists public.referral_leads (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique
    default ('GG-R-' || nextval('public.referral_lead_reference_seq')::text),
  created_at timestamptz not null default now(),
  categories text[] not null
    check (
      cardinality(categories) between 1 and 3
      and categories <@ array['pokemon', 'one_piece', 'video_games']::text[]
    ),
  description text not null check (char_length(description) between 1 and 4000),
  collection_size text
    check (collection_size is null or collection_size in ('few_items', 'small', 'large', 'not_sure')),
  handoff text not null default 'not_sure'
    check (handoff in ('local', 'ship', 'either', 'not_sure')),
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text check (last_name is null or char_length(last_name) <= 100),
  email text not null check (char_length(email) between 3 and 320),
  phone text check (phone is null or char_length(phone) <= 30),
  preferred_contact_method text not null default 'email'
    check (preferred_contact_method in ('email', 'phone', 'text')),
  location text check (location is null or char_length(location) <= 120),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 40),
  source_path text check (source_path is null or char_length(source_path) <= 200),
  -- The seller ticked "share my details with your buying partner". Required:
  -- the privacy policy only allows sharing with a third party with consent.
  consent_to_share_at timestamptz not null,
  status text not null default 'new'
    check (status in ('new', 'sent_to_partner', 'closed'))
);

comment on table public.referral_leads is
  'Pokémon / One Piece / video game sellers referred to Geega Games'' buying partner. Written only by /api/referral-leads (service_role); staff read-only via RLS.';
comment on column public.referral_leads.consent_to_share_at is
  'When the seller consented to their details being shared with the buying partner. Never null — no consent, no lead.';
comment on column public.referral_leads.photo_paths is
  'Object paths in the private sell-photos bucket, verified against Storage at submit time.';

create index if not exists referral_leads_created_at_idx
  on public.referral_leads (created_at desc);
create index if not exists referral_leads_email_created_at_idx
  on public.referral_leads (email, created_at desc);

alter table public.referral_leads enable row level security;

drop policy if exists referral_leads_staff_select on public.referral_leads;
create policy referral_leads_staff_select
  on public.referral_leads for select to authenticated
  using ((select public.is_staff()));

revoke all on public.referral_leads from anon, authenticated;
grant select on public.referral_leads to authenticated;
revoke all on sequence public.referral_lead_reference_seq from anon, authenticated;
