-- Trade Center: choose the condition, and optionally the line's price, when
-- adding a traded-in card to inventory.
--
-- Before: a card staff took went into inventory at the condition recorded on
-- the trade, at the price staff typed. If we already stocked that printing in
-- that condition, the copies joined that line and kept its price, so the
-- typed price was quietly ignored.
--
-- Now trade_import_card also takes:
--   p_condition          The condition to stock it as (NM, LP, MP, HP, DMG).
--                        Null keeps the trade's (verified, else reported).
--                        The trade's own record of the card isn't changed: it
--                        stays what was agreed. The choice is logged.
--   p_update_line_price  When the copies join a line we already stock: true
--                        changes that whole line's price to p_price_cents,
--                        false (the default) keeps the line's price as before.
--                        A line on a deal isn't repriced here (GT010: change
--                        it in Inventory), so a deal's price never gets mixed
--                        up with its regular price.
-- Called with only the first four arguments it behaves exactly as before.
--
-- Run after 20261028120000_consignment_foundation.sql (admin_upsert_inventory
-- only joins active, business-owned lines). Safe to run more than once.

drop function if exists public.trade_import_card(uuid, integer, text, text);

create or replace function public.trade_import_card(
  p_offer_card_id uuid, p_price_cents integer, p_storage_location text, p_actor text,
  p_condition text default null, p_update_line_price boolean default false
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_card public.trade_offer_cards%rowtype;
  v_trade public.trade_requests%rowtype;
  v_inv public.inventory_items%rowtype;
  v_existing public.inventory_items%rowtype;
  v_condition public.card_condition;
  v_unit_cost integer;
  v_repriced boolean := false;
begin
  perform public.trade_require_service_role();
  select * into v_card from public.trade_offer_cards where id = p_offer_card_id for update;
  if not found then
    raise exception 'That card isn''t on a trade.' using errcode = 'GT404';
  end if;
  if v_card.disposition = 'imported' then
    return v_card.imported_inventory_item_id;
  end if;
  select * into v_trade from public.trade_requests where id = v_card.trade_request_id;
  if v_trade.status not in ('approved_for_fulfillment', 'completed') then
    raise exception 'Add trade-ins to inventory once the trade is finished.' using errcode = 'GT009';
  end if;
  if v_card.disposition <> 'accepted' or coalesce(v_card.final_quantity, 0) < 1 then
    raise exception 'Only accepted cards go into inventory.' using errcode = 'GT009';
  end if;
  if p_price_cents is null or p_price_cents < 1 then
    raise exception 'Set a selling price.' using errcode = 'GT010';
  end if;
  if p_condition is not null and p_condition not in ('NM', 'LP', 'MP', 'HP', 'DMG') then
    raise exception 'Choose a condition: NM, LP, MP, HP or DMG.' using errcode = 'GT010';
  end if;

  v_condition := coalesce(p_condition, v_card.verified_condition::text, v_card.reported_condition::text)::public.card_condition;
  -- What the card cost us: its share of the trade credit.
  v_unit_cost := round(coalesce(v_card.final_unit_cents, 0) * v_trade.credit_rate_percent / 100.0)::int;

  -- The line these copies join, if we already stock it (admin_upsert_inventory's own rule).
  select * into v_existing
  from public.inventory_items i
  where i.status = 'active'
    and i.ownership = 'business'
    and i.condition = v_condition
    and i.finish = v_card.finish
    and coalesce(i.variant_type, '') = ''
    and coalesce(i.language, 'en') = 'en'
    and (
      (v_card.scryfall_id is not null and i.scryfall_id = v_card.scryfall_id)
      or (v_card.scryfall_id is null and i.scryfall_id is null
          and i.set_code = coalesce(v_card.set_code, '')
          and i.collector_number = coalesce(v_card.collector_number, ''))
    )
  limit 1
  for update;
  if found and coalesce(p_update_line_price, false) and v_existing.is_deal
     and v_existing.price_cents is distinct from p_price_cents then
    raise exception '% is on a deal in inventory: change its price there.', v_existing.card_name using errcode = 'GT010';
  end if;

  v_inv := public.admin_upsert_inventory(
    v_card.scryfall_id, null, v_card.card_name, coalesce(v_card.set_code, ''), v_card.set_name,
    coalesce(v_card.collector_number, ''), null, null, v_card.image_url, v_condition, v_card.finish,
    v_card.final_quantity, p_price_cents, v_unit_cost, v_card.reference_price_cents,
    left(nullif(btrim(p_storage_location), ''), 120), null, 'Trade-in TR-' || v_trade.trade_number,
    '', 'en', '{}', '{}', left(coalesce(p_actor, 'trade'), 200), 'trade_in'
  );

  -- Joined an existing line: its price only changes when staff asked.
  if v_existing.id is not null and v_existing.id = v_inv.id and coalesce(p_update_line_price, false)
     and v_inv.price_cents is distinct from p_price_cents then
    update public.inventory_items set price_cents = p_price_cents where id = v_inv.id;
    v_repriced := true;
  end if;

  update public.trade_offer_cards set disposition = 'imported', imported_inventory_item_id = v_inv.id
    where id = p_offer_card_id;
  perform public.trade_log(v_trade.id, 'staff', null, p_actor, 'card_imported', v_trade.status, v_trade.status,
    jsonb_build_object('offer_card_id', p_offer_card_id, 'inventory_item_id', v_inv.id, 'quantity', v_card.final_quantity,
                       'condition', v_condition, 'trade_condition', coalesce(v_card.verified_condition, v_card.reported_condition),
                       'price_cents', p_price_cents, 'joined_existing', v_existing.id is not null,
                       'line_price_from', case when v_repriced then v_existing.price_cents end,
                       'line_price_updated', v_repriced));
  return v_inv.id;
end;
$$;

revoke all on function public.trade_import_card(uuid, integer, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.trade_import_card(uuid, integer, text, text, text, boolean) to service_role;
