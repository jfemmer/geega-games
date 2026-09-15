-- CREATE OR REPLACE FUNCTION does not truly replace a function when the
-- parameter TYPE LIST changes (Postgres treats a different arg count as a
-- distinct overload, even with the new arg defaulted) — so the earlier
-- admin_upsert_inventory migration that "added p_reason" actually created a
-- SECOND, separate admin_upsert_inventory(...) overload alongside the
-- original, rather than replacing it. The new overload, being a genuinely
-- new function object, got Postgres's default EXECUTE-to-PUBLIC grant
-- instead of inheriting the original's restricted service_role-only grant
-- (confirmed via pg_proc.proacl — the new overload showed anon+authenticated
-- +PUBLIC; the original showed only postgres+service_role). Same gap on
-- brand-new recompute_scan_session and the staff_or_service_role helper.
--
-- The internal is_staff()/staff_or_service_role() check inside each function
-- body still blocks any unauthorized caller at runtime regardless of grants,
-- so this was never an exploitable hole — but it violates the
-- least-privilege pattern every sibling admin RPC follows, and leaving two
-- admin_upsert_inventory overloads alive is confusing dead-code debt (the
-- original is unreachable now that every caller — inventory add included —
-- resolves to the 23-arg version, since Postgres's named-argument overload
-- resolution prefers an exact match, but scan commits explicitly pass
-- p_reason and everything else matches the superset with one default fill).
--
-- Fix: drop the orphaned original overload, and lock every affected
-- function down to exactly the grants its equivalent sibling has.

DROP FUNCTION IF EXISTS public.admin_upsert_inventory(
  uuid, uuid, text, text, text, text, text, text, text,
  card_condition, card_finish, integer, integer, integer, integer,
  text, text, text, text, text, text[], text[], text
);

REVOKE ALL ON FUNCTION public.admin_upsert_inventory(
  uuid, uuid, text, text, text, text, text, text, text,
  card_condition, card_finish, integer, integer, integer, integer,
  text, text, text, text, text, text[], text[], text, inventory_movement_reason
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_inventory(
  uuid, uuid, text, text, text, text, text, text, text,
  card_condition, card_finish, integer, integer, integer, integer,
  text, text, text, text, text, text[], text[], text, inventory_movement_reason
) TO service_role;

REVOKE ALL ON FUNCTION public.recompute_scan_session(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_scan_session(uuid) TO service_role;

-- Internal-only helper (called from within other SECURITY DEFINER function
-- bodies, which run with the owner's privileges regardless of grants) — no
-- external caller needs direct RPC access to it at all.
REVOKE ALL ON FUNCTION public.staff_or_service_role() FROM PUBLIC, anon, authenticated, service_role;
