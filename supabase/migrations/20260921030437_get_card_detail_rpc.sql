-- Powers the new /shop/card/:slug storefront page (see
-- src/store/pages/CardDetailPage.tsx): one indexable page per unique card
-- (grouped by oracle_id across every in-stock printing/condition), so
-- specific-card searches ("buy <card name>") have a real page to match
-- instead of everything living behind one big /shop grid.
--
-- Anon-callable, same trust level as search_inventory (public storefront
-- read). Mirrors search_inventory's reservation-aware sellable-quantity
-- and effective-price math exactly rather than reinventing it.

begin;

-- Single source of truth for turning a card name into a URL slug. The
-- TypeScript side (src/store/lib/cardSlug.ts) applies the IDENTICAL
-- transform when generating links — the two must never drift apart.
create or replace function public.slugify_card_name(p_name text)
returns text
language sql
immutable
as $function$
  select regexp_replace(
    regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'),
    '(^-+)|(-+$)', '', 'g'
  );
$function$;

create or replace function public.get_card_detail(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_oracle_id uuid;
  v_card_name text;
  v_result jsonb;
  v_enrichment jsonb;
begin
  select i.oracle_id, i.card_name
    into v_oracle_id, v_card_name
  from public.inventory_items i
  where i.status = 'active'
    and public.slugify_card_name(i.card_name) = p_slug
  order by i.created_at asc
  limit 1;

  if v_oracle_id is null then
    return null;
  end if;

  with base as (
    select i.*,
      greatest(
        0,
        i.quantity - coalesce((
          select sum(r.quantity)::int
          from public.inventory_reservations r
          where r.inventory_item_id = i.id and r.status = 'active'
        ), 0)
      ) as sellable_qty,
      public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal) as effective_price_cents,
      public.storefront_effective_original_price(i.price_cents, i.original_price_cents, i.is_deal) as effective_original_price_cents,
      public.storefront_effective_discount_percent(i.price_cents, i.original_price_cents, i.is_deal) as effective_discount_percent
    from public.inventory_items i
    where i.oracle_id = v_oracle_id and i.status = 'active'
  ),
  listings as (
    select
      jsonb_build_object(
        'id', b.id,
        'scryfallId', b.scryfall_id,
        'setCode', b.set_code,
        'setName', b.set_name,
        'collectorNumber', b.collector_number,
        'rarity', b.rarity,
        'condition', b.condition,
        'finish', b.finish,
        'variantType', b.variant_type,
        'imageUrl', b.image_url,
        'quantity', b.sellable_qty,
        'priceCents', b.effective_price_cents,
        'isDeal', (b.is_deal or b.effective_discount_percent is not null),
        'originalPriceCents', b.effective_original_price_cents,
        'dealDiscountPercent', b.effective_discount_percent,
        'dealSource', b.deal_source,
        'dealNote', b.deal_note
      ) as x,
      b.sellable_qty,
      b.effective_price_cents
    from base b
    where b.sellable_qty > 0
  )
  select jsonb_build_object(
    'oracleId', v_oracle_id,
    'cardName', v_card_name,
    'listings', coalesce((select jsonb_agg(l.x order by l.effective_price_cents asc nulls last) from listings l), '[]'::jsonb),
    'inStockCount', (select count(*) from listings),
    'minPriceCents', (select min(effective_price_cents) from listings),
    'maxPriceCents', (select max(effective_price_cents) from listings)
  ) into v_result;

  -- Enrich with representative Scryfall rules text from any printing
  -- sharing this oracle_id. Cosmetic content only (never price/availability)
  -- so a stale/missing bulk-cache row just means a plainer page, not a
  -- broken one — hence the null guard before merging.
  select jsonb_build_object(
    'typeLine', sc.raw ->> 'type_line',
    'oracleText', coalesce(sc.raw ->> 'oracle_text', sc.raw -> 'card_faces' -> 0 ->> 'oracle_text'),
    'manaCost', coalesce(sc.raw ->> 'mana_cost', sc.raw -> 'card_faces' -> 0 ->> 'mana_cost'),
    'power', coalesce(sc.raw ->> 'power', sc.raw -> 'card_faces' -> 0 ->> 'power'),
    'toughness', coalesce(sc.raw ->> 'toughness', sc.raw -> 'card_faces' -> 0 ->> 'toughness'),
    'loyalty', sc.raw ->> 'loyalty',
    'flavorText', coalesce(sc.raw ->> 'flavor_text', sc.raw -> 'card_faces' -> 0 ->> 'flavor_text'),
    'legalities', sc.raw -> 'legalities'
  )
  into v_enrichment
  from public.scryfall_bulk_cards sc
  where sc.oracle_id = v_oracle_id and sc.lang = 'en'
  order by sc.released_at desc nulls last
  limit 1;

  if v_enrichment is not null then
    v_result := v_result || v_enrichment;
  end if;

  return v_result;
end;
$function$;

revoke all on function public.get_card_detail(text) from public;
grant execute on function public.get_card_detail(text) to anon, authenticated, service_role;

revoke all on function public.slugify_card_name(text) from public;
grant execute on function public.slugify_card_name(text) to anon, authenticated, service_role;

commit;
