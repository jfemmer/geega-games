-- Refund ledger. One row per refund (never a single mutable column), same
-- append-only shape as inventory_movements/admin_audit_log: a partial
-- refund followed by a second partial refund is two rows, not a number
-- that has to be trusted to have been updated correctly both times.
--
-- orders.status already has a 'refunded' value and payment_reference
-- already stores the Stripe PaymentIntent id (both predate this migration),
-- so this fills in the missing half rather than inventing new columns on
-- orders itself.

create table public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  stripe_refund_id text,
  amount_cents integer not null check (amount_cents > 0),
  reason text,
  restocked boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.order_refunds is
  'Append-only refund ledger. Written by the admin refund action and by the Stripe charge.refunded webhook (so a refund issued directly in the Stripe Dashboard still shows up here). Never updated or deleted.';

create index order_refunds_order_id_idx on public.order_refunds (order_id);

alter table public.order_refunds enable row level security;

-- Same read gate as admin_audit_log: owner/administrator only. Writes are
-- service_role only (the admin refund action and the Stripe webhook both
-- use the service-role key), so there is no insert/update/delete policy.
create policy order_refunds_select_privileged on public.order_refunds
  for select
  to authenticated
  using (
    public.is_staff()
    and public.current_staff_role() in ('owner', 'administrator')
  );

grant select on public.order_refunds to authenticated;

-- A restock triggered by a refund is its own reason, distinct from a normal
-- cancellation restock, so the movement ledger says WHY stock came back.
alter type public.inventory_movement_reason add value if not exists 'return_restock';
