-- =============================================================================
-- 0014_security_hardening.sql
-- Post-audit hardening from the Supabase security advisor:
--   * Pin search_path on helper functions (prevents search-path hijacking).
--   * Remove implicit PUBLIC/anon EXECUTE on SECURITY DEFINER functions; keep
--     only the intended roles. checkout_create_order + admin_adjust_store_credit
--     stay callable by `authenticated` (they self-guard internally on
--     auth.uid()/is_admin()); everything else is service-role only.
--   * Explicit deny-all policy on payment_events to document intent.
-- =============================================================================

-- 1. Pin search_path on helper functions.
alter function public.current_app_role() set search_path = public;
alter function public.is_staff() set search_path = public;
alter function public.is_admin() set search_path = public;
alter function public.tg_set_updated_at() set search_path = public;

-- 2. Trigger-only / service-role-only functions: no direct RPC execute.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.mark_order_paid(uuid, payment_provider, text) from public, anon, authenticated;
revoke execute on function public.cancel_unpaid_order(uuid, text) from public, anon, authenticated;

-- 3. Client-callable RPCs: remove implicit PUBLIC grant (which lets anon in),
--    then grant only authenticated. Internal guards handle authorization.
revoke execute on function public.checkout_create_order(
  shipping_method, integer, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.checkout_create_order(
  shipping_method, integer, text, text, text, text, text, text, text
) to authenticated;

revoke execute on function public.admin_adjust_store_credit(uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_store_credit(uuid, integer, text) to authenticated;

-- 4. Document payment_events as no-client-access (RLS on; service role bypasses).
do $$ begin
  create policy payment_events_no_client_access on public.payment_events
    for all using (false) with check (false);
exception when duplicate_object then null; end $$;
