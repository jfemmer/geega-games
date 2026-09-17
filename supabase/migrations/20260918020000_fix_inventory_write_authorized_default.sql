-- inventory_write_authorized() had a dangerous default: when
-- request.jwt.claims was unset or lacked a 'role' key, its coalesce()
-- treated the caller AS service_role rather than denying access. In
-- practice this never fires over Supabase's real REST/RPC gateway (which
-- always populates request.jwt.claims with at least the anon key's own
-- claims), but it's a fail-OPEN default sitting behind
-- admin_inventory_set_codes() — the one function of the four that use this
-- helper which is actually EXECUTE-granted to anon/authenticated (the
-- other three are locked to service_role via GRANT, so the grant itself
-- already protects them regardless of this bug).
--
-- Replaces the hand-rolled claims parsing with auth.role(), the same
-- Supabase-provided helper already used correctly elsewhere in this
-- codebase (see admin_create_reservation, and the pos_* functions fixed in
-- 20260916091000_fix_pos_service_role_check.sql) — it has no such
-- default-to-service_role fallback, so a missing/absent claim correctly
-- resolves to "not service_role" instead of "is service_role".

create or replace function public.inventory_write_authorized()
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select public.is_staff() or auth.role() = 'service_role';
$function$;
