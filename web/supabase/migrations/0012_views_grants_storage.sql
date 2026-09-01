-- =============================================================================
-- 0012_views_grants_storage.sql
-- Public-safe inventory view (hides cost_cents), function grants, a private
-- scanner Storage bucket + policies, and Realtime publication for review queue.
-- =============================================================================

-- ---- Public-safe inventory view --------------------------------------------
-- Customer/anon clients query THIS instead of the base table so cost_cents can
-- never leak. It respects the base table's RLS (in-stock only for non-staff).
create or replace view public.inventory_public
  with (security_invoker = true) as
  select
    id, scryfall_id, oracle_id, set_code, collector_number, language,
    card_name, set_name, rarity, type_line, colors, creature_types, image_url,
    condition, finish, foil, variant_type,
    quantity, price_cents
  from public.inventory_items;

comment on view public.inventory_public is
  'Customer/anon-facing inventory. Excludes cost_cents. Inherits base-table RLS.';

-- ---- Function execute grants -------------------------------------------------
-- Authenticated users may call the owner-scoped RPCs (each self-guards).
grant execute on function public.get_or_create_my_cart() to authenticated;
grant execute on function public.my_store_credit_balance() to authenticated;
grant execute on function public.store_credit_balance(uuid) to authenticated;
grant execute on function public.checkout_create_order(
  shipping_method, integer, text, text, text, text, text, text, text
) to authenticated;

-- Admin-only / server-only RPCs: granted to authenticated but self-guard on
-- is_admin(); the destructive server-role ones are NOT granted to clients.
grant execute on function public.admin_adjust_store_credit(uuid, integer, text) to authenticated;

-- mark_order_paid / cancel_unpaid_order are intended for the service role only.
-- Do NOT grant them to 'authenticated'. (Service role bypasses grants.)
revoke execute on function public.mark_order_paid(uuid, payment_provider, text) from public, authenticated;
revoke execute on function public.cancel_unpaid_order(uuid, text) from public, authenticated;

-- Read the public inventory view without a session (storefront browse).
grant select on public.inventory_public to anon, authenticated;

-- ---- Private scanner Storage bucket -----------------------------------------
-- Review/scan images live here. Private: only staff (or signed URLs minted
-- server-side) can read. The scanner-worker uploads via the server service role.
insert into storage.buckets (id, name, public)
values ('scanner', 'scanner', false)
on conflict (id) do nothing;

-- Staff/admin may read objects in the scanner bucket directly.
create policy scanner_bucket_staff_read
  on storage.objects for select
  using (bucket_id = 'scanner' and public.is_staff());

-- No insert/update/delete policies for clients: writes are service-role only.

-- ---- Realtime ---------------------------------------------------------------
-- Publish the review queue so the admin UI updates live as cards are scanned
-- (replaces the legacy SSE stream). Only staff can subscribe meaningfully
-- because RLS still filters the streamed rows.
do $$
begin
  alter publication supabase_realtime add table public.scanner_review_queue;
exception
  when duplicate_object then null;
  when undefined_object then null;  -- publication may not exist in bare test DBs
end $$;
