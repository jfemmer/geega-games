-- =============================================================================
-- 0010_rls_policies.sql
-- Enable Row Level Security on every exposed table and define policies.
--
-- Principles:
--  * Customers access ONLY their own rows (auth.uid() = user_id).
--  * Public may read ONLY public inventory.
--  * Staff/admin roles come from JWT app_metadata (is_staff()/is_admin()),
--    never from user_metadata or request bodies.
--  * Privileged writes (checkout, credit, order status, inventory mutation)
--    go through SECURITY DEFINER RPCs or the server service role, which BYPASSES
--    RLS by design — so we intentionally do NOT grant broad write policies here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_select_own
  on public.profiles for select
  using (id = auth.uid() or public.is_staff());

create policy profiles_update_own
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());
-- No insert policy: profiles are created by the handle_new_user() trigger
-- (SECURITY DEFINER). No delete policy: account deletion cascades from auth.users.

-- ---------------------------------------------------------------------------
-- addresses (full CRUD for owner)
-- ---------------------------------------------------------------------------
alter table public.addresses enable row level security;

create policy addresses_select_own
  on public.addresses for select
  using (user_id = auth.uid() or public.is_staff());

create policy addresses_insert_own
  on public.addresses for insert
  with check (user_id = auth.uid());

create policy addresses_update_own
  on public.addresses for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy addresses_delete_own
  on public.addresses for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- inventory_items
--   Public: read only rows that are in stock (browse/search).
--   Staff/admin: full read (incl. out-of-stock and cost_cents).
--   Writes: staff/admin only (admin UI also typically uses server routes).
--   NOTE: cost_cents is sensitive. Public/customer clients must select explicit
--   columns (never select *). A public-safe view is provided in 0012.
-- ---------------------------------------------------------------------------
alter table public.inventory_items enable row level security;

create policy inventory_public_read_instock
  on public.inventory_items for select
  using (quantity > 0 or public.is_staff());

create policy inventory_staff_insert
  on public.inventory_items for insert
  with check (public.is_staff());

create policy inventory_staff_update
  on public.inventory_items for update
  using (public.is_staff())
  with check (public.is_staff());

create policy inventory_admin_delete
  on public.inventory_items for delete
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- carts / cart_items (owner-only)
-- ---------------------------------------------------------------------------
alter table public.carts enable row level security;

create policy carts_all_own
  on public.carts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.cart_items enable row level security;

create policy cart_items_all_own
  on public.cart_items for all
  using (
    exists (select 1 from public.carts c
            where c.id = cart_items.cart_id and c.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.carts c
            where c.id = cart_items.cart_id and c.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- orders / order_items
--   Owner: read own. Staff/admin: read all.
--   Writes: none from clients. Orders are created by the checkout RPC and
--   mutated by server routes (service role). This is deliberate.
-- ---------------------------------------------------------------------------
alter table public.orders enable row level security;

create policy orders_select_own
  on public.orders for select
  using (user_id = auth.uid() or public.is_staff());

alter table public.order_items enable row level security;

create policy order_items_select_own
  on public.order_items for select
  using (
    exists (select 1 from public.orders o
            where o.id = order_items.order_id
              and (o.user_id = auth.uid() or public.is_staff()))
  );

-- ---------------------------------------------------------------------------
-- store_credit_transactions (ledger)
--   Owner + staff: read. NO client writes (append only via RPC/service role).
-- ---------------------------------------------------------------------------
alter table public.store_credit_transactions enable row level security;

create policy sct_select_own
  on public.store_credit_transactions for select
  using (user_id = auth.uid() or public.is_staff());
-- Intentionally no insert/update/delete policies: writes happen through
-- admin_adjust_store_credit() (SECURITY DEFINER) and the checkout RPC.

-- ---------------------------------------------------------------------------
-- trade_ins / trade_in_items
--   Owner: read own + insert own. Staff/admin: read all (updates via server).
-- ---------------------------------------------------------------------------
alter table public.trade_ins enable row level security;

create policy trade_ins_select_own
  on public.trade_ins for select
  using (user_id = auth.uid() or public.is_staff());

create policy trade_ins_insert_own
  on public.trade_ins for insert
  with check (user_id = auth.uid());

create policy trade_ins_staff_update
  on public.trade_ins for update
  using (public.is_staff())
  with check (public.is_staff());

alter table public.trade_in_items enable row level security;

create policy trade_in_items_select_own
  on public.trade_in_items for select
  using (
    exists (select 1 from public.trade_ins t
            where t.id = trade_in_items.trade_in_id
              and (t.user_id = auth.uid() or public.is_staff()))
  );

create policy trade_in_items_insert_own
  on public.trade_in_items for insert
  with check (
    exists (select 1 from public.trade_ins t
            where t.id = trade_in_items.trade_in_id
              and t.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- scanner_* and payment_events: staff/admin only (no customer access at all).
--   Ingest writes come from the server service role, which bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.scanner_jobs enable row level security;
create policy scanner_jobs_staff_read on public.scanner_jobs for select using (public.is_staff());

alter table public.scanner_results enable row level security;
create policy scanner_results_staff_read on public.scanner_results for select using (public.is_staff());

alter table public.scanner_review_queue enable row level security;
create policy srq_staff_read on public.scanner_review_queue for select using (public.is_staff());
create policy srq_staff_update on public.scanner_review_queue for update
  using (public.is_staff()) with check (public.is_staff());

alter table public.payment_events enable row level security;
-- No policies -> with RLS enabled, only the service role (bypasses RLS) can touch it.

comment on policy inventory_public_read_instock on public.inventory_items is
  'Anonymous/customer clients can read only in-stock rows; staff read everything. Never select * from client (cost_cents is sensitive).';
