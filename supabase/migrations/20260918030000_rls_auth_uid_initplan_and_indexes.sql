-- Pure performance hardening, no behavior change — flagged by Supabase's
-- own database linter (get_advisors, type=performance):
--
-- 1) auth_rls_initplan: these policies called auth.uid() directly, which
--    Postgres re-evaluates once per row scanned. Wrapping it as
--    `(select auth.uid())` lets the planner evaluate it once per statement
--    instead — same result, cheaper at scale. See:
--    https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
-- 2) unindexed_foreign_keys: adds a covering index for every FK the linter
--    flagged, so joins/deletes on the referencing side don't full-scan.
-- 3) duplicate_index: sell_submission_cards had two identical indexes on
--    submission_id (idx_trade_in_items_ti, a leftover from the pre-rename
--    trade_in_items table, and sell_submission_cards_submission_idx) —
--    drops the older-named duplicate, keeps the current one.

-- ---------------------------------------------------------------------
-- 1) RLS policies: wrap auth.uid() as (select auth.uid())
-- ---------------------------------------------------------------------

alter policy addresses_delete_own on public.addresses
  using (user_id = (select auth.uid()));

alter policy addresses_insert_own on public.addresses
  with check (user_id = (select auth.uid()));

alter policy addresses_select_own on public.addresses
  using ((user_id = (select auth.uid())) or public.is_staff());

alter policy addresses_update_own on public.addresses
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy cart_items_all_own on public.cart_items
  using (exists (select 1 from public.carts c where c.id = cart_items.cart_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.carts c where c.id = cart_items.cart_id and c.user_id = (select auth.uid())));

alter policy carts_all_own on public.carts
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy order_items_select_own on public.order_items
  using (exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and (o.user_id = (select auth.uid()) or public.is_staff())
  ));

alter policy orders_select_own on public.orders
  using ((user_id = (select auth.uid())) or public.is_staff());

alter policy profiles_select_own on public.profiles
  using ((id = (select auth.uid())) or public.is_staff());

alter policy profiles_update_own on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy sct_select_own on public.store_credit_transactions
  using ((user_id = (select auth.uid())) or public.is_staff());

-- ---------------------------------------------------------------------
-- 2) Missing covering indexes on foreign keys
-- ---------------------------------------------------------------------

create index if not exists card_scans_inventory_item_id_idx on public.card_scans (inventory_item_id);
create index if not exists card_scans_selected_scryfall_id_idx on public.card_scans (selected_scryfall_id);
create index if not exists inventory_reservations_pickup_request_id_idx on public.inventory_reservations (pickup_request_id);
create index if not exists order_items_inventory_item_id_idx on public.order_items (inventory_item_id);
create index if not exists orders_customer_id_idx on public.orders (customer_id);
create index if not exists pickup_request_items_inventory_item_id_idx on public.pickup_request_items (inventory_item_id);
create index if not exists pickup_request_items_pickup_request_id_idx on public.pickup_request_items (pickup_request_id);
create index if not exists pickup_requests_order_id_idx on public.pickup_requests (order_id);
create index if not exists scanner_review_queue_created_inventory_item_id_idx on public.scanner_review_queue (created_inventory_item_id);
create index if not exists scanner_review_queue_resolved_by_idx on public.scanner_review_queue (resolved_by);
create index if not exists scanner_review_queue_result_id_idx on public.scanner_review_queue (result_id);
create index if not exists store_credit_transactions_created_by_idx on public.store_credit_transactions (created_by);

-- ---------------------------------------------------------------------
-- 3) Drop the duplicate index (keep the current, correctly-named one)
-- ---------------------------------------------------------------------

drop index if exists public.idx_trade_in_items_ti;

-- ---------------------------------------------------------------------
-- 4) Harden tg_set_updated_at's search_path (defense in depth — this
--    trigger only ever touches NEW.updated_at, so there's no behavior
--    change, just removing a mutable search_path the linter flagged).
-- ---------------------------------------------------------------------

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
