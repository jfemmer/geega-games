-- Real backing store for the batch card-scanning pipeline. The admin app's
-- ScanRepository/CardScan/ScanSession types (src/admin/types, src/admin/
-- repositories/types.ts) and the whole scan review UI were already built
-- against this session+batch model, but the schema itself was never applied —
-- production only ever got the OLDER, unrelated single-image scanner_jobs /
-- scanner_results / scanner_review_queue tables (0 rows, superseded, left
-- untouched here rather than dropped). This migration creates the tables the
-- existing application code actually expects, so the mock repository can be
-- swapped for a real one with no interface changes.
--
-- Naming note: `scan_review_status` already exists live with a DIFFERENT,
-- unrelated 4-value set (pending/approved/corrected/rejected) backing the old
-- scanner_review_queue table. To avoid colliding with that, the review-status
-- enum for card_scans is named `card_scan_review_status` here, with the
-- 8-value set the admin app's ScanReviewStatus type already defines.
--
-- Everything below is purely additive: new types, new tables, new bucket.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'scan_session_status') then
    create type public.scan_session_status as enum (
      'uploading',
      'processing',
      'pending_review',
      'reviewing',
      'completed',
      'partially_failed',
      'failed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'scan_source_type') then
    create type public.scan_source_type as enum (
      'scanner_export',
      'file_upload',
      'folder_drop',
      'scanner_bridge'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'card_scan_review_status') then
    create type public.card_scan_review_status as enum (
      'unreviewed',
      'pending_match',
      'matched',
      'needs_manual_match',
      'ready',
      'added',
      'rejected',
      'error'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'recognition_status') then
    create type public.recognition_status as enum (
      'none',
      'queued',
      'processing',
      'recognized',
      'low_confidence',
      'failed'
    );
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- scan_sessions — a persistent batch of scans from one import.
-- ---------------------------------------------------------------------------
create table if not exists public.scan_sessions (
  id              uuid primary key default gen_random_uuid(),
  label           text not null,
  created_by      text,
  scanner_name    text,
  source_type     public.scan_source_type not null default 'scanner_export',
  status          public.scan_session_status not null default 'uploading',
  total_files     integer not null default 0,
  total_cards     integer not null default 0,
  reviewed_cards  integer not null default 0,
  matched_cards   integer not null default 0,
  ready_cards     integer not null default 0,
  added_cards     integer not null default 0,
  rejected_cards  integer not null default 0,
  failed_cards    integer not null default 0,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz
);

comment on table public.scan_sessions is
  'A persistent batch scanning session (e.g. one Ricoh fi-8170 import run).';

create index if not exists scan_sessions_status_idx on public.scan_sessions (status);
create index if not exists scan_sessions_created_idx on public.scan_sessions (created_at desc);

drop trigger if exists set_updated_at on public.scan_sessions;
create trigger set_updated_at
  before update on public.scan_sessions
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- card_scans — one row per scanned physical card (front + optional back).
-- ---------------------------------------------------------------------------
create table if not exists public.card_scans (
  id                uuid primary key default gen_random_uuid(),
  scan_session_id   uuid not null references public.scan_sessions (id) on delete cascade,
  sequence_number   integer not null,
  front_image_path  text,
  back_image_path   text,
  -- Chosen exact printing (nullable until matched).
  selected_scryfall_id uuid references public.card_printings (scryfall_id),
  recognition_status   public.recognition_status not null default 'none',
  recognition_confidence numeric(4,3),
  recognition_data     jsonb,
  suggested_condition  public.card_condition,
  suggested_condition_confidence numeric(4,3),
  confirmed_condition  public.card_condition,
  selected_finish      public.card_finish,
  quantity          integer not null default 1 check (quantity >= 1),
  price_cents       integer check (price_cents >= 0),
  cost_cents        integer check (cost_cents >= 0),
  storage_location  text,
  notes             text,
  review_status     public.card_scan_review_status not null default 'unreviewed',
  reviewed_by       text,
  reviewed_at       timestamptz,
  -- Set once committed; presence makes commit idempotent.
  inventory_item_id uuid references public.inventory_items (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint card_scans_session_sequence_key unique (scan_session_id, sequence_number)
);

comment on table public.card_scans is
  'One scanned physical card. inventory_item_id set at commit → idempotent.';

create index if not exists card_scans_session_idx
  on public.card_scans (scan_session_id, sequence_number);
create index if not exists card_scans_review_status_idx
  on public.card_scans (scan_session_id, review_status);

drop trigger if exists set_updated_at on public.card_scans;
create trigger set_updated_at
  before update on public.card_scans
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — staff-only reads. No INSERT/UPDATE/DELETE grants to
-- browser roles: every write goes through staff-gated Vercel Functions using
-- the service_role key, same pattern as inventory_items.
-- ---------------------------------------------------------------------------
alter table public.scan_sessions enable row level security;
alter table public.card_scans    enable row level security;

drop policy if exists scan_sessions_staff_select on public.scan_sessions;
create policy scan_sessions_staff_select
  on public.scan_sessions for select to authenticated
  using (public.is_staff());

drop policy if exists card_scans_staff_select on public.card_scans;
create policy card_scans_staff_select
  on public.card_scans for select to authenticated
  using (public.is_staff());

grant select on public.scan_sessions to authenticated;
grant select on public.card_scans    to authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.scan_sessions, public.card_scans
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket for physical scan images (private; served via signed URLs).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('card-scans', 'card-scans', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'card_scans_staff_read'
  ) then
    create policy card_scans_staff_read
      on storage.objects for select to authenticated
      using (bucket_id = 'card-scans' and public.is_staff());
  end if;
end$$;

commit;
