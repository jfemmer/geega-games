-- =============================================================================
-- 0004_carts.sql
-- One cart per user; line items reference inventory_items by stable ID (not
-- string tuples) and are removed by a stable line id (not array index).
-- Prices are never trusted from the cart at checkout — always re-derived from
-- inventory_items server-side. cart_items stores no price.
-- =============================================================================

create table if not exists public.carts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_carts_updated_at
  before update on public.carts
  for each row execute function public.tg_set_updated_at();

create table if not exists public.cart_items (
  id                uuid primary key default gen_random_uuid(),
  cart_id           uuid not null references public.carts(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  quantity          integer not null check (quantity > 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (cart_id, inventory_item_id)   -- one line per SKU; bump quantity instead
);

create index if not exists idx_cart_items_cart on public.cart_items(cart_id);
create index if not exists idx_cart_items_inv on public.cart_items(inventory_item_id);

create trigger trg_cart_items_updated_at
  before update on public.cart_items
  for each row execute function public.tg_set_updated_at();

-- Convenience: ensure a cart exists for the current user, return its id.
-- SECURITY INVOKER so RLS applies; the caller can only touch their own cart.
create or replace function public.get_or_create_my_cart()
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cart_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.carts (user_id)
  values (v_uid)
  on conflict (user_id) do update set updated_at = now()
  returning id into v_cart_id;

  return v_cart_id;
end;
$$;
