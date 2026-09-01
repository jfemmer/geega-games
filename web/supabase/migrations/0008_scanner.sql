-- =============================================================================
-- 0008_scanner.sql
-- DB-backed scanner pipeline (replaces JSONL review queue on local disk).
-- Written by the local scanner-worker via an authenticated server ingest route
-- (service role, server-side only). Review images live in a PRIVATE Storage
-- bucket; only signed URLs / storage keys are stored here. Realtime-friendly.
-- All scanner tables are staff/admin-only (no customer access).
-- =============================================================================

-- ---- scanner_jobs (mirrors legacy ScanJob) ----------------------------------
create table if not exists public.scanner_jobs (
  id                uuid primary key default gen_random_uuid(),
  status            scan_job_status not null default 'queued',

  -- File / batch inputs
  original_name     text default '',
  storage_key       text,             -- key in private scanner bucket
  condition         card_condition not null default 'NM',
  finish            card_finish not null default 'nonfoil',
  set_code          text default '',

  -- OCR / matching results
  guessed_name      text,
  name_confidence   numeric,
  collector_number  text,
  chosen_set        text,
  chosen_set_name   text,
  chosen_collector  text,
  ocr_text_name     text,
  ocr_text_bottom   text,
  detected_set_code text,
  set_symbol_score  numeric,
  set_symbol_best_dist numeric,
  copyright_year    integer,

  -- Ops
  attempts          integer not null default 0,
  last_error        text,
  locked_at         timestamptz,
  finished_at       timestamptz,

  legacy_mongo_id   text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_scanner_jobs_status on public.scanner_jobs(status, created_at);

create trigger trg_scanner_jobs_updated_at
  before update on public.scanner_jobs
  for each row execute function public.tg_set_updated_at();

-- ---- scanner_results --------------------------------------------------------
-- Full result payload for a single scanned card (candidate printings, scores).
create table if not exists public.scanner_results (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid references public.scanner_jobs(id) on delete set null,

  scryfall_id       uuid,
  card_name         text,
  set_code          text,
  collector_number  text,
  condition         card_condition,
  finish            card_finish not null default 'nonfoil',

  overall_score     numeric,
  auto_ingested     boolean not null default false,
  candidates        jsonb not null default '[]'::jsonb,  -- alternate printings + scores
  ocr               jsonb not null default '{}'::jsonb,  -- raw ocr sub-results

  image_storage_key text,             -- primary scan image (private bucket)
  crop_storage_keys jsonb not null default '{}'::jsonb,  -- {name:..., collector:..., symbol:...}

  created_at        timestamptz not null default now()
);

create index if not exists idx_scanner_results_job on public.scanner_results(job_id);

-- ---- scanner_review_queue ---------------------------------------------------
-- Items needing human review. review_hash dedupes repeat scans of the same card.
create table if not exists public.scanner_review_queue (
  id                uuid primary key default gen_random_uuid(),
  result_id         uuid references public.scanner_results(id) on delete set null,
  status            scan_review_status not null default 'pending',
  reason            text,             -- e.g. 'name_not_detected', 'low_confidence'
  review_hash       text unique,      -- collision-dedupe of equivalent scans

  -- Denormalized prediction fields for fast list rendering.
  guessed_name      text,
  predicted_set     text,
  collector_number  text,
  symbol_match      text,
  confidence        numeric,
  condition         card_condition,
  finish            card_finish not null default 'nonfoil',
  candidates        jsonb not null default '[]'::jsonb,
  image_storage_key text,

  -- Resolution
  resolved_by       uuid references auth.users(id) on delete set null,
  resolved_at       timestamptz,
  corrected_scryfall_id uuid,
  created_inventory_item_id uuid references public.inventory_items(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_srq_status on public.scanner_review_queue(status, created_at);

create trigger trg_srq_updated_at
  before update on public.scanner_review_queue
  for each row execute function public.tg_set_updated_at();

comment on table public.scanner_review_queue is
  'DB-backed replacement for the legacy JSONL review queue. Staff/admin only. Realtime-enabled.';
