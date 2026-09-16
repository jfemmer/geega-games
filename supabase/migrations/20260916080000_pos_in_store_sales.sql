-- In-store Point of Sale: staff ring up a walk-in customer against the SAME
-- inventory_items pool the storefront sells from. Orders created this way
-- share the orders/order_items tables with online checkout (same reporting,
-- same fulfillment history) but differ in a few structural ways:
--   * No account is required — a walk-in may be anonymous, or linked to an
--     existing public.customers row (which itself does not require an
--     auth.users account). orders.user_id (an auth.users FK) therefore can't
--     be required the way online checkout requires it.
--   * There is nothing to ship — shipping_method or a real fulfillment
--     record aren't in play.
--   * Sales tax needs to exist for the first time (pos_settings.sales_tax_bps);
--     it was previously scaffolding-only (taxCents hardcoded to 0 in the
--     email template / admin types) and is now real for POS sales.
-- Online checkout (checkout_create_order) is untouched and keeps requiring
-- user_id/email/shipping_method, enforced below by a channel-conditional
-- check constraint rather than relaxing anything for the online path.

create type public.order_channel as enum ('online', 'pos');

alter table public.orders
  add column channel public.order_channel not null default 'online',
  add column customer_id uuid references public.customers(id) on delete set null,
  add column tax_cents integer not null default 0 check (tax_cents >= 0);

alter table public.orders alter column user_id drop not null;
alter table public.orders alter column email drop not null;
alter table public.orders alter column shipping_method drop not null;

alter table public.orders
  add constraint chk_online_requires_identity check (
    channel <> 'online'
    or (user_id is not null and email is not null and shipping_method is not null)
  );

comment on column public.orders.channel is
  'online: created via storefront checkout (checkout_create_order), always has user_id/email/shipping_method. pos: created via pos_create_sale from the in-store register, may be anonymous (customer_id/user_id/email all null) or linked to an existing customers row.';
comment on column public.orders.customer_id is
  'Optional link to public.customers for a POS sale (walk-in with no account). Null for online orders (which use user_id instead) and for anonymous walk-ins.';
comment on column public.orders.tax_cents is
  'Sales tax collected on this order. Always 0 for online orders (no tax logic exists for the storefront). For POS orders, computed from pos_settings.sales_tax_bps at time of sale.';

-- ---------------------------------------------------------------------------
-- Store-wide POS settings (singleton row).
-- ---------------------------------------------------------------------------
create table public.pos_settings (
  id smallint primary key default 1 check (id = 1),
  sales_tax_bps integer not null default 0 check (sales_tax_bps >= 0 and sales_tax_bps <= 10000),
  updated_at timestamptz not null default now(),
  updated_by text
);

comment on table public.pos_settings is
  'Single-row config for the in-store register. sales_tax_bps is basis points (825 = 8.25%), applied to the subtotal of every POS sale by pos_create_sale().';

insert into public.pos_settings (id, sales_tax_bps) values (1, 0)
on conflict (id) do nothing;

drop trigger if exists set_updated_at on public.pos_settings;
create trigger set_updated_at
  before update on public.pos_settings
  for each row execute function public.tg_set_updated_at();

alter table public.pos_settings enable row level security;

drop policy if exists pos_settings_staff_select on public.pos_settings;
create policy pos_settings_staff_select
  on public.pos_settings
  for select
  to authenticated
  using (public.is_staff());

revoke all on public.pos_settings from anon, authenticated;
grant select on public.pos_settings to authenticated;

-- ---------------------------------------------------------------------------
-- pos_create_sale: the staff-only equivalent of checkout_create_order.
--
-- Takes a flat list of {inventory_item_id, quantity} lines (no cart table
-- involved — the register keeps its ticket client-side until checkout) and
-- an optional customer to link. Mirrors checkout_create_order's stock
-- revalidation exactly (FOR UPDATE row lock, sellable = on_hand - active
-- reservations, reject if insufficient) so the same card can never be sold
-- online and in-store at the same time. Always creates the order pending —
-- callers mark it paid afterward via the existing mark_order_paid (cash) or
-- the Stripe webhook (card, via Stripe Terminal), never here.
-- ---------------------------------------------------------------------------
create or replace function public.pos_create_sale(
  p_items jsonb,
  p_customer_id uuid default null,
  p_notes text default null
)
returns table(
  order_id uuid,
  subtotal_cents integer,
  tax_cents integer,
  total_cents integer,
  amount_due_cents integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_subtotal integer := 0;
  v_tax integer := 0;
  v_total integer := 0;
  v_tax_bps integer := 0;
  v_order_id uuid;
  v_customer_email text;
  v_item jsonb;
  v_inv_id uuid;
  v_qty integer;
begin
  if not public.is_staff() and current_user <> 'service_role' then
    raise exception 'Staff access required' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a sale needs at least one item' using errcode = 'P0001';
  end if;

  if p_customer_id is not null then
    select email into v_customer_email from public.customers where id = p_customer_id;
    if v_customer_email is null then
      raise exception 'customer not found' using errcode = 'P0006';
    end if;
  end if;

  select coalesce(sales_tax_bps, 0) into v_tax_bps from public.pos_settings where id = 1;

  insert into public.orders (
    user_id, customer_id, email, channel, shipping_method,
    subtotal_cents, shipping_cents, store_credit_used_cents,
    tax_cents, total_cents, amount_due_cents,
    status, payment_status, internal_notes
  ) values (
    null, p_customer_id, v_customer_email, 'pos', null,
    0, 0, 0,
    0, 0, 0,
    'pending_payment', 'unpaid', nullif(trim(coalesce(p_notes, '')), '')
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_inv_id := (v_item->>'inventory_item_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    if v_inv_id is null or v_qty is null or v_qty < 1 then
      raise exception 'invalid line item' using errcode = 'P0005';
    end if;

    declare
      v_inv public.inventory_items%rowtype;
      v_unit integer;
      v_line integer;
      v_reserved integer;
      v_sellable integer;
    begin
      select * into v_inv from public.inventory_items where id = v_inv_id for update;
      if not found then
        raise exception 'item no longer available' using errcode = 'P0002';
      end if;
      if v_inv.status = 'archived' then
        raise exception 'item no longer available: %', v_inv.card_name using errcode = 'P0002';
      end if;
      if v_inv.price_cents is null then
        raise exception 'item has no price: %', v_inv.card_name using errcode = 'P0003';
      end if;

      select coalesce(sum(res.quantity), 0)::int into v_reserved
      from public.inventory_reservations res
      where res.inventory_item_id = v_inv.id and res.status = 'active';

      v_sellable := greatest(0, v_inv.quantity - v_reserved);
      if v_sellable < v_qty then
        raise exception 'insufficient stock for % (sellable %, need %)',
          v_inv.card_name, v_sellable, v_qty using errcode = 'P0004';
      end if;

      v_unit := v_inv.price_cents;
      v_line := v_unit * v_qty;
      v_subtotal := v_subtotal + v_line;

      insert into public.order_items (
        order_id, inventory_item_id, scryfall_id, set_code, collector_number,
        card_name, set_name, condition, finish, variant_type, image_url,
        quantity, unit_price_cents, line_total_cents
      ) values (
        v_order_id, v_inv.id, v_inv.scryfall_id, v_inv.set_code, v_inv.collector_number,
        v_inv.card_name, v_inv.set_name, v_inv.condition, v_inv.finish, v_inv.variant_type, v_inv.image_url,
        v_qty, v_unit, v_line
      );

      update public.inventory_items set quantity = quantity - v_qty where id = v_inv.id;
    end;
  end loop;

  if v_subtotal = 0 then
    raise exception 'a sale needs at least one priced item' using errcode = 'P0001';
  end if;

  v_tax := (v_subtotal * v_tax_bps) / 10000;
  v_total := v_subtotal + v_tax;

  update public.orders set
    subtotal_cents = v_subtotal,
    tax_cents = v_tax,
    total_cents = v_total,
    amount_due_cents = v_total
  where id = v_order_id;

  return query select v_order_id, v_subtotal, v_tax, v_total, v_total;
end;
$function$;

grant execute on function public.pos_create_sale(jsonb, uuid, text) to authenticated;

comment on function public.pos_create_sale is
  'Staff-only in-store sale creation. Revalidates stock the same way checkout_create_order does (row lock + sellable = on_hand - active reservations) so online and in-store sales can never oversell the same card. Always creates the order pending_payment/unpaid; the caller marks it paid separately (mark_order_paid for cash, the Stripe webhook for a Terminal card payment).';
