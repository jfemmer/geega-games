-- =============================================================================
-- 0006_store_credit.sql
-- Store credit as an append-only ledger (financial data). Balance = SUM(amount).
-- Credits are positive cents, debits (spend) are negative cents.
-- No direct client balance updates anywhere. Spend + admin-adjust are wired;
-- 'earn' (trade_in_payout) is defined but unused (earn path not built yet).
-- =============================================================================

create table if not exists public.store_credit_transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  amount_cents   integer not null,     -- positive = credit, negative = debit
  type           store_credit_type not null,
  reason         text,
  reference_type text,                 -- e.g. 'order', 'trade_in', 'migration'
  reference_id   uuid,
  created_by     uuid references auth.users(id) on delete set null,  -- admin actor, null = system
  created_at     timestamptz not null default now()
);

create index if not exists idx_sct_user on public.store_credit_transactions(user_id, created_at);
create index if not exists idx_sct_reference on public.store_credit_transactions(reference_type, reference_id);

comment on table public.store_credit_transactions is
  'Append-only store-credit ledger. Balance = sum(amount_cents). Never mutate rows.';

-- Balance for an arbitrary user (used by admin + server RPCs).
create or replace function public.store_credit_balance(p_user_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(amount_cents), 0)::integer
  from public.store_credit_transactions
  where user_id = p_user_id;
$$;

-- Balance for the current caller (safe for client to call under RLS).
create or replace function public.my_store_credit_balance()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select public.store_credit_balance(auth.uid());
$$;

-- Admin-only adjustment. SECURITY DEFINER so it can write regardless of the
-- ledger's insert RLS, but it self-guards on is_admin().
create or replace function public.admin_adjust_store_credit(
  p_user_id uuid,
  p_amount_cents integer,
  p_reason text default null
)
returns integer   -- returns new balance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;
  if p_amount_cents = 0 then
    raise exception 'amount must be non-zero';
  end if;

  insert into public.store_credit_transactions
    (user_id, amount_cents, type, reason, reference_type, created_by)
  values
    (p_user_id, p_amount_cents, 'admin_adjustment', p_reason, 'admin', auth.uid());

  -- Guard against driving a balance negative via a debit adjustment.
  select public.store_credit_balance(p_user_id) into v_new_balance;
  if v_new_balance < 0 then
    raise exception 'adjustment would make balance negative (%.2f)', v_new_balance / 100.0;
  end if;

  return v_new_balance;
end;
$$;

comment on function public.admin_adjust_store_credit is
  'Admin-only. Appends a ledger entry and returns the new balance. Self-guards on is_admin().';
