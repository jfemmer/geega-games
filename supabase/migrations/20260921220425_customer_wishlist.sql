-- General wishlist: any customer can save any card (by oracle_id, printing-
-- agnostic -- matches how shop_card_name_suggestions/card_stock_subscriptions
-- already treat "card" as a name/oracle_id-level concept, not a specific
-- printing) for later, viewable from their account. Distinct from deck
-- watches (customer_deck_cards) and stock-alert subscriptions
-- (card_stock_subscriptions): a wishlist is just a personal bookmark list,
-- with no email side effect of its own.
create table public.customer_wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  oracle_id uuid not null,
  card_name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, oracle_id)
);

alter table public.customer_wishlist_items enable row level security;

create policy "wishlist owners manage wishlist"
on public.customer_wishlist_items for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Live-joins current inventory + the Scryfall art cache so the account page
-- always shows real availability/price (never a stale add-time snapshot) and
-- still has art to show for an out-of-stock save. Same "cheapest active
-- listing" shape as deck_inventory_matches.
create function public.my_wishlist()
returns table(
  id uuid,
  oracle_id uuid,
  card_name text,
  created_at timestamptz,
  image_url text,
  in_stock boolean,
  min_price_cents integer,
  inventory_item_id uuid
)
language sql
stable security invoker
set search_path to 'public'
as $function$
  select
    w.id, w.oracle_id, w.card_name, w.created_at,
    coalesce(i.image_url, sb.image_url) as image_url,
    (i.id is not null) as in_stock,
    i.price_cents as min_price_cents,
    i.id as inventory_item_id
  from public.customer_wishlist_items w
  left join lateral (
    select
      ii.id, ii.image_url,
      public.storefront_effective_price(ii.price_cents, ii.original_price_cents, ii.is_deal) as price_cents
    from public.inventory_items ii
    where ii.oracle_id = w.oracle_id and ii.status = 'active' and ii.quantity > 0
    order by public.storefront_effective_price(ii.price_cents, ii.original_price_cents, ii.is_deal) asc nulls last,
             ii.condition asc, ii.created_at desc
    limit 1
  ) i on true
  left join lateral (
    select coalesce(b.raw->'image_uris'->>'normal', b.raw->'card_faces'->0->'image_uris'->>'normal') as image_url
    from public.scryfall_bulk_cards b
    where b.oracle_id = w.oracle_id and b.lang = 'en'
    order by b.released_at desc nulls last
    limit 1
  ) sb on true
  where w.user_id = auth.uid()
  order by w.created_at desc;
$function$;

grant execute on function public.my_wishlist() to authenticated;
