-- Yard Sale Mode: whole-dollar prices. Each card's yard sale price is now
-- its website price less the discount, rounded to the nearest dollar (50
-- cents rounds up), so everything at the yard sale is paid in whole dollars:
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
