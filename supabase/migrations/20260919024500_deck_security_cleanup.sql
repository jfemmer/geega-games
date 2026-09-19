-- Security + index cleanup for customer deck builder.

create index if not exists customer_deck_cards_user_idx
  on public.customer_deck_cards(user_id);

create index if not exists deck_stock_notifications_inventory_item_idx
  on public.deck_stock_notifications(inventory_item_id);

alter table public.card_recommendation_catalog enable row level security;

drop policy if exists "authenticated read recommendation catalog"
on public.card_recommendation_catalog;

create policy "authenticated read recommendation catalog"
on public.card_recommendation_catalog
for select
to authenticated
using (true);

drop policy if exists "deck owners manage decks"
on public.customer_decks;
create policy "deck owners manage decks"
on public.customer_decks
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "deck owners manage cards"
on public.customer_deck_cards;
create policy "deck owners manage cards"
on public.customer_deck_cards
for all
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.customer_decks d
    where d.id = deck_id
      and d.user_id = (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.customer_decks d
    where d.id = deck_id
      and d.user_id = (select auth.uid())
  )
);

drop policy if exists "users read own deck notifications"
on public.deck_stock_notifications;
create policy "users read own deck notifications"
on public.deck_stock_notifications
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "users update own deck notifications"
on public.deck_stock_notifications;
create policy "users update own deck notifications"
on public.deck_stock_notifications
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
