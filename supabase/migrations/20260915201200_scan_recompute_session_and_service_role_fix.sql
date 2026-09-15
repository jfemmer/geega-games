-- scan_filter_counts (SECURITY DEFINER) checked bare is_staff(), which reads
-- JWT claims — that's correct for a browser call (staff JWT present) but
-- WRONG for a server-side call through the service-role admin client (no
-- user JWT at all), which is exactly how the scan commit/ingest endpoints
-- need to call it. inventory_write_authorized() already solved this same
-- problem for inventory RPCs (is_staff() OR jwt role = 'service_role'); that
-- name is inventory-specific, so factor the same boolean logic out under a
-- generic name both can share, and use it here.
CREATE OR REPLACE FUNCTION public.staff_or_service_role()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    public.is_staff()
    or coalesce(
         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
         'service_role'
       ) = 'service_role';
$function$;

CREATE OR REPLACE FUNCTION public.scan_filter_counts(p_session_id uuid)
 RETURNS TABLE(
   all_count bigint,
   unreviewed bigint,
   pending_match bigint,
   matched bigint,
   needs_manual_match bigint,
   ready bigint,
   added bigint,
   rejected bigint,
   missing_back bigint,
   error bigint
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.staff_or_service_role() then
    raise exception 'Staff access required' using errcode = '42501';
  end if;

  return query
  select
    count(*) filter (where true),
    count(*) filter (where review_status = 'unreviewed'),
    count(*) filter (where selected_scryfall_id is null and review_status <> 'rejected'),
    count(*) filter (where selected_scryfall_id is not null and review_status = 'matched'),
    count(*) filter (where review_status = 'needs_manual_match'),
    count(*) filter (where review_status = 'ready'),
    count(*) filter (where review_status = 'added'),
    count(*) filter (where review_status = 'rejected'),
    count(*) filter (where back_image_path is null),
    count(*) filter (where review_status = 'error')
  from public.card_scans
  where scan_session_id = p_session_id;
end;
$function$;

-- Recompute a session's rollup counters + lifecycle status from its scans —
-- the server-side equivalent of the mock's recomputeSession, called after
-- ingest/update/bulk-update/commit so session progress stays accurate.
-- SECURITY DEFINER, no browser grant (server-only via service_role).
CREATE OR REPLACE FUNCTION public.recompute_scan_session(p_session_id uuid)
 RETURNS public.scan_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.scan_sessions;
  v_total integer;
  v_reviewed integer;
  v_matched integer;
  v_ready integer;
  v_added integer;
  v_rejected integer;
  v_failed integer;
begin
  if not public.staff_or_service_role() then
    raise exception 'Staff access required' using errcode = '42501';
  end if;

  select
    count(*),
    count(*) filter (where review_status in ('matched','ready','added','rejected')),
    count(*) filter (where selected_scryfall_id is not null),
    count(*) filter (where review_status = 'ready'),
    count(*) filter (where review_status = 'added'),
    count(*) filter (where review_status = 'rejected'),
    count(*) filter (where review_status = 'error')
  into v_total, v_reviewed, v_matched, v_ready, v_added, v_rejected, v_failed
  from public.card_scans
  where scan_session_id = p_session_id;

  update public.scan_sessions s
  set
    total_cards = v_total,
    reviewed_cards = v_reviewed,
    matched_cards = v_matched,
    ready_cards = v_ready,
    added_cards = v_added,
    rejected_cards = v_rejected,
    failed_cards = v_failed,
    -- Auto-advance lifecycle: once every card is added/rejected, complete.
    -- Mirrors the mock's recomputeSession exactly.
    status = case
      when v_total > 0 and (v_added + v_rejected) = v_total then 'completed'::scan_session_status
      when s.status = 'completed' and not (v_total > 0 and (v_added + v_rejected) = v_total)
        then 'reviewing'::scan_session_status
      else s.status
    end,
    completed_at = case
      when v_total > 0 and (v_added + v_rejected) = v_total
        then coalesce(s.completed_at, now())
      else null
    end
  where s.id = p_session_id
  returning * into v_row;

  return v_row;
end;
$function$;
