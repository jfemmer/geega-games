create table if not exists public.inventory_price_floors (
  rarity text primary key check (rarity in ('common', 'uncommon', 'rare', 'mythic')),
  min_price_cents integer not null default 0 check (min_price_cents >= 0),
  updated_at timestamptz not null default now(),
  updated_by text
);

comment on table public.inventory_price_floors is
  'Per-rarity minimum sell price. When staff price a card from its Scryfall/market reference price (Add Card, or matching a printing during scan review), the suggested price is floored to this value if the rarity has one set above 0. Never overrides a price staff type in by hand, and never retroactively changes existing inventory rows.';

insert into public.inventory_price_floors (rarity, min_price_cents) values
  ('common', 0), ('uncommon', 0), ('rare', 0), ('mythic', 0)
on conflict (rarity) do nothing;

drop trigger if exists set_updated_at on public.inventory_price_floors;
create trigger set_updated_at
  before update on public.inventory_price_floors
  for each row execute function public.tg_set_updated_at();

alter table public.inventory_price_floors enable row level security;

drop policy if exists inventory_price_floors_staff_select on public.inventory_price_floors;
create policy inventory_price_floors_staff_select
  on public.inventory_price_floors
  for select
  to authenticated
  using (public.is_staff());

revoke all on public.inventory_price_floors from anon, authenticated;
grant select on public.inventory_price_floors to authenticated;
