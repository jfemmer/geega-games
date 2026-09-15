-- Part 9: explainable per-region condition findings.
--
-- suggested_condition / suggested_condition_confidence (added in
-- 20260915194514_scan_sessions_card_scans.sql) already carry the final
-- grade + confidence number, but not WHY — the review UI needs the actual
-- region-by-region defect list (corner/edge/surface findings with severity
-- and a human note) so a suggestion is never a black box. Additive only;
-- the existing scalar columns are untouched.

alter table public.card_scans
  add column if not exists condition_findings jsonb;

comment on column public.card_scans.condition_findings is
  'ConditionFindings: { findings: DefectFinding[], summary, backImageMissing }. Explains suggested_condition; never auto-applied to confirmed_condition.';
