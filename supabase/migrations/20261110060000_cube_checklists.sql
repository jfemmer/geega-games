-- Cube checklists: a shared, working copy of a CubeCobra cube list that staff
-- and friends work through together (admin: Cube Checklist; public: the
-- secret share link at /cube-checklist?t=<token>).
--
-- The cube's mainboard is copied in once when staff create the checklist.
-- After that this table IS the list: people mark cards found, and swap a card
-- for a better option (the swap keeps the original so it can be undone).
--
-- Same lockdown as referral_leads: no anon/authenticated writes at all. Every
-- read and write from the share link, and every admin change, goes through
-- the API with the service_role key (api/cube-checklist.ts and
-- api/admin/cube-checklists.ts), which checks the share token or the staff
-- role and enforces the swap rarity rule. Staff may read directly via RLS.
--
-- Safe to run more than once.

create table if not exists public.cube_checklists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  -- CubeCobra cube id the list was copied from.
  cube_id text not null check (cube_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  -- Which rarities a swap may bring in. Pauper cubes are commons only.
  rarity_rule text not null default 'common'
    check (rarity_rule in ('common', 'common_uncommon')),
  -- The secret in the share link. Rotating it turns off old links.
  share_token text not null unique check (char_length(share_token) between 20 and 100),
  share_enabled boolean not null default true,
  created_by text check (created_by is null or char_length(created_by) <= 320),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cube_checklists is
  'Shared CubeCobra cube checklists. Written only by /api/cube-checklist and /api/admin/cube-checklists (service_role); staff read-only via RLS.';
comment on column public.cube_checklists.share_token is
  'Secret for the public share link. Anyone with it can mark cards found and swap cards while share_enabled.';

create table if not exists public.cube_checklist_cards (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.cube_checklists (id) on delete cascade,
  position integer not null check (position >= 0),
  name text not null check (char_length(name) between 1 and 200),
  type_line text check (type_line is null or char_length(type_line) <= 200),
  color_category text check (color_category is null or char_length(color_category) <= 40),
  -- Set when the card was swapped in: the card from the cube it replaced
  -- (the first one, so undo always goes back to the cube's own card).
  original_name text check (original_name is null or char_length(original_name) <= 200),
  original_type_line text check (original_type_line is null or char_length(original_type_line) <= 200),
  original_color_category text check (original_color_category is null or char_length(original_color_category) <= 40),
  swapped_by text check (swapped_by is null or char_length(swapped_by) <= 80),
  swapped_at timestamptz,
  -- Who found it and when (null = still looking).
  found_by text check (found_by is null or char_length(found_by) <= 80),
  found_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((found_at is null) = (found_by is null)),
  check ((original_name is null) = (swapped_at is null))
);

comment on table public.cube_checklist_cards is
  'One slot of a cube checklist. updated_at drives the share page''s incremental refresh.';

-- A card can only be on a list once (a swap can't bring in a duplicate).
create unique index if not exists cube_checklist_cards_name_uidx
  on public.cube_checklist_cards (checklist_id, lower(name));
create index if not exists cube_checklist_cards_checklist_updated_idx
  on public.cube_checklist_cards (checklist_id, updated_at);

-- updated_at comes from the database clock so incremental refreshes never
-- miss a change because of a server's clock.
create or replace function public.cube_checklist_touch()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists cube_checklists_touch on public.cube_checklists;
create trigger cube_checklists_touch
  before update on public.cube_checklists
  for each row execute function public.cube_checklist_touch();

drop trigger if exists cube_checklist_cards_touch on public.cube_checklist_cards;
create trigger cube_checklist_cards_touch
  before update on public.cube_checklist_cards
  for each row execute function public.cube_checklist_touch();

alter table public.cube_checklists enable row level security;
alter table public.cube_checklist_cards enable row level security;

drop policy if exists cube_checklists_staff_select on public.cube_checklists;
create policy cube_checklists_staff_select
  on public.cube_checklists for select to authenticated
  using ((select public.is_staff()));

drop policy if exists cube_checklist_cards_staff_select on public.cube_checklist_cards;
create policy cube_checklist_cards_staff_select
  on public.cube_checklist_cards for select to authenticated
  using ((select public.is_staff()));

revoke all on public.cube_checklists from anon, authenticated;
revoke all on public.cube_checklist_cards from anon, authenticated;
grant select on public.cube_checklists to authenticated;
grant select on public.cube_checklist_cards to authenticated;
revoke all on function public.cube_checklist_touch() from public, anon, authenticated;
