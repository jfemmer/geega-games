-- Lets staff pick, per scan session, what the pipeline actually does:
-- 'card_matching' (identify only — condition stays fully manual, e.g. for
-- cards someone will grade themselves or already knows the condition of),
-- 'condition' (grade condition only — identity stays fully manual, e.g.
-- re-grading existing stock or a card already picked by hand), or 'both'
-- (the existing full pipeline). Additive only.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'scan_recognition_mode') then
    create type public.scan_recognition_mode as enum (
      'card_matching',
      'condition',
      'both'
    );
  end if;
end$$;

alter table public.scan_sessions
  add column if not exists scan_mode public.scan_recognition_mode not null default 'both';

comment on column public.scan_sessions.scan_mode is
  'What /api/admin/scans/:scanId/recognize does for every scan in this session. card_matching skips condition analysis; condition skips identity recognition; both runs everything (default, matches pre-existing behavior).';

commit;
