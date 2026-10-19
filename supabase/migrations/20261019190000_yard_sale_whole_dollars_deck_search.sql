-- Yard Sale Mode, two additions:
--
--   1. Whole-dollar prices (yard_sale_price)
--   2. "Shop your deck" on the yard sale page (yard_sale_deck_matches)
--
-- ---------------------------------------------------------------------------
-- 1. Whole-dollar prices
-- ---------------------------------------------------------------------------
--
-- Each card's yard sale price is now its website price less the discount,
-- rounded to the nearest dollar (50 cents rounds up), so everything at the
-- yard sale is paid in whole dollars:
--
--   * never above the card's website price: when rounding up would go over
--     it, the price rounds down to the dollar below instead ($4.80 at 5% off
--     is $4, not $5);
--   * never under $1, so a card is never free ($3.00 at 90% off is $1);
--   * a card under $1 (listed only when the sale's minimum price is under
--     $1) sells at its website price, since the only whole dollar below it
--     is $0.
--
-- yard_sale_complete_list works out every list's total with this function,
-- so only it changes. src/store/lib/yardSale.ts (yardSalePriceCents) has the
-- same formula for what the shopper's phone and Pickup Requests show.

create or replace function public.yard_sale_price(p_price_cents integer, p_discount_percent integer)
returns integer
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_price integer;
begin
  if p_price_cents is null then
    return null;
  end if;
  if p_price_cents < 100 then
    return p_price_cents;
  end if;
  -- The discounted price to the nearest dollar, 50 cents rounding up.
  v_price := (((p_price_cents::bigint * (100 - p_discount_percent) + 5000) / 10000) * 100)::integer;
  -- Never above the website price: round down instead.
  if v_price > p_price_cents then
    v_price := (p_price_cents / 100) * 100;
  end if;
  -- Never under $1.
  return greatest(v_price, 100);
end;
$$;

revoke all on function public.yard_sale_price(integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. "Shop your deck" on the yard sale page
-- ---------------------------------------------------------------------------
--
-- A shopper pastes a decklist (src/store/lib/decklist.ts reads it in the
-- browser) and sees which of its cards are at the yard sale, to add them to
-- their pickup list. This returns, for each name, the cards the yard sale
-- page itself would show (search_inventory's rules: active, in stock after
-- holds, priced at the website price a storewide sale included) at or above
-- the sale's minimum price: cheapest first, up to five printings, so a deck
-- wanting four copies can be filled from more than one. A name matches a
-- card's whole name or the front of a split or double-faced card
-- ("Fable of the Mirror-Breaker" finds "Fable of the Mirror-Breaker //
-- Reflection of Kiki-Jiki"), ignoring case. Nothing when no sale is on.
--
-- Public (the yard sale page has no sign-in), like search_inventory. It's
-- SECURITY DEFINER to read the sale's minimum and the holds; it returns
-- only what the public catalog already shows. At most 250 names.

create or replace function public.yard_sale_deck_matches(p_names text[])
returns table (
  input_name text,
  id uuid,
  oracle_id uuid,
  scryfall_id uuid,
  set_code text,
  set_name text,
  collector_number text,
  card_name text,
  rarity text,
  type_line text,
  image_url text,
  condition public.card_condition,
  finish public.card_finish,
  variant_type text,
  quantity integer,
  price_cents integer,
  original_price_cents integer,
  deal_discount_percent integer,
  deal_source text,
  deal_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  with sale as (
    select ys.min_price_cents
    from public.yard_sales ys
    where ys.ended_at is null and now() < ys.ends_at
    order by ys.started_at desc
    limit 1
  ),
  wanted as (
    select min(btrim(n)) as input_name, lower(btrim(n)) as name_key
    from unnest(p_names[1:250]) as n
    where n is not null and btrim(n) <> '' and char_length(n) <= 200
    group by lower(btrim(n))
  ),
  stock as (
    select
      i.*,
      public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal) as live_price,
      greatest(0, i.quantity - coalesce((
        select sum(r.quantity)::integer
        from public.inventory_reservations r
        where r.inventory_item_id = i.id and r.status = 'active'
      ), 0)) as sellable
    from public.inventory_items i
    where i.status = 'active' and i.quantity > 0
  ),
  matched as (
    select
      w.input_name,
      s.*,
      row_number() over (
        partition by w.name_key
        order by s.live_price asc, s.condition asc, s.created_at desc, s.id
      ) as pick
    from wanted w
    join stock s on w.name_key in (lower(s.card_name), lower(split_part(s.card_name, ' // ', 1)))
    cross join sale
    where s.sellable > 0
      and s.live_price > 0
      and s.live_price >= sale.min_price_cents
  )
  select
    m.input_name, m.id, m.oracle_id, m.scryfall_id, m.set_code, m.set_name, m.collector_number,
    m.card_name, m.rarity, m.type_line, m.image_url, m.condition, m.finish, m.variant_type,
    m.sellable,
    m.live_price,
    public.storefront_effective_original_price(m.price_cents, m.original_price_cents, m.is_deal),
    public.storefront_effective_discount_percent(m.price_cents, m.original_price_cents, m.is_deal),
    m.deal_source,
    m.deal_note
  from matched m
  where m.pick <= 5
  order by m.input_name, m.pick;
$$;

revoke all on function public.yard_sale_deck_matches(text[]) from public;
grant execute on function public.yard_sale_deck_matches(text[]) to anon, authenticated, service_role;
