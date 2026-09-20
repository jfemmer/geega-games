-- Suggestions showed card_recommendation_catalog's image_url, which is
-- whichever printing rebuild_card_recommendation_catalog picked as
-- canonical (most recently released) - not necessarily the printing
-- Geega actually has in stock. Since every returned suggestion is now
-- guaranteed in-stock (prior migration switched the inventory join to
-- INNER), show that exact listing's own photo instead, matching the
-- pattern deck_inventory_matches already uses for "Your Deck"/"Missing".
-- Falls back to the catalog image only if that specific listing has no
-- photo of its own.
create or replace function public.deck_recommendations(
  p_deck_id uuid,
  p_limit integer default 24
)
returns table(
  oracle_id uuid,
  card_name text,
  category text,
  reason text,
  image_url text,
  in_stock boolean,
  inventory_item_id uuid,
  store_price_cents integer,
  scryfall_price_cents integer,
  score integer
)
language sql
stable
security invoker
set search_path=public
as $$
with deck as (
  select d.*
  from public.customer_decks d
  where d.id=p_deck_id and d.user_id=auth.uid()
),
commander as (
  select c.*
  from deck d
  join public.card_recommendation_catalog c on c.oracle_id=d.commander_oracle_id
),
deck_cards as (
  select dc.oracle_id
  from public.customer_deck_cards dc
  join deck d on d.id=dc.deck_id
  where dc.oracle_id is not null
),
curated_synergy as (
  select distinct on (suggested_oracle_id)
    case when csc.card_a_oracle_id = dc.oracle_id then csc.card_b_oracle_id else csc.card_a_oracle_id end as suggested_oracle_id,
    csc.synergy_note
  from deck_cards dc
  join public.card_synergy_curated csc
    on (csc.card_a_oracle_id = dc.oracle_id or csc.card_b_oracle_id = dc.oracle_id)
   and csc.card_a_oracle_id is not null
   and csc.card_b_oracle_id is not null
  order by suggested_oracle_id
),
organic_synergy as (
  select os.oracle_id, os.deck_count
  from deck d
  cross join public.commander_organic_synergy(d.commander_oracle_id, d.id) os
  where d.commander_oracle_id is not null
),
candidates as (
  select
    c.*,
    coalesce(
      cardinality(array(select unnest(c.themes) intersect select unnest(cmd.themes))),
      0
    ) as theme_overlap,
    case c.primary_category
      when 'Ramp' then 15
      when 'Card Draw' then 15
      when 'Tutor' then 14
      when 'Interaction' then 13
      when 'Board Wipe' then 11
      when 'Protection' then 9
      when 'Mana Base' then 8
      else 2
    end as role_score,
    case
      when c.edhrec_rank is null then 0
      when c.edhrec_rank <= 100 then 20
      when c.edhrec_rank <= 500 then 14
      when c.edhrec_rank <= 2000 then 8
      when c.edhrec_rank <= 5000 then 4
      else 0
    end as popularity_score,
    cs.synergy_note as curated_synergy_note,
    coalesce(os.deck_count, 0) as organic_deck_count,
    (
      case when cs.suggested_oracle_id is not null then 26 else 0 end
      + least(coalesce(os.deck_count, 0) * 6, 24)
    ) as synergy_bonus
  from public.card_recommendation_catalog c
  cross join commander cmd
  left join curated_synergy cs on cs.suggested_oracle_id = c.oracle_id
  left join organic_synergy os on os.oracle_id = c.oracle_id
  where c.commander_legal
    and c.oracle_id <> cmd.oracle_id
    and c.color_identity <@ cmd.color_identity
    and not exists (select 1 from deck_cards dc where dc.oracle_id=c.oracle_id)
    and (
      c.edhrec_rank is null
      or c.edhrec_rank <= 15000
      or cs.suggested_oracle_id is not null
      or os.deck_count > 0
    )
),
with_stock as (
  select
    c.*,
    inv.id as inventory_item_id,
    inv.image_url as stocked_image_url,
    inv.store_price_cents,
    true as in_stock
  from candidates c
  join lateral (
    select
      i.id,
      i.image_url,
      public.storefront_effective_price(
        i.price_cents,i.original_price_cents,i.is_deal
      ) as store_price_cents
    from public.inventory_items i
    where i.oracle_id=c.oracle_id
      and i.status='active'
      and i.quantity>0
    order by public.storefront_effective_price(
      i.price_cents,i.original_price_cents,i.is_deal
    ) asc nulls last
    limit 1
  ) inv on true
),
budgeted as (
  select ws.*, d.budget_mode, d.max_card_price_cents
  from with_stock ws
  cross join deck d
  where d.budget_mode='unlimited'
     or coalesce(ws.store_price_cents,ws.scryfall_price_cents,0)
        <= coalesce(
          d.max_card_price_cents,
          case when d.budget_mode='budget' then 500 else 2000 end
        )
)
select
  b.oracle_id,
  b.card_name,
  b.primary_category,
  case
    when b.curated_synergy_note is not null then b.curated_synergy_note
    when b.primary_category='Ramp' then 'Helps your deck accelerate mana and develop earlier.'
    when b.primary_category='Card Draw' then 'Adds card advantage so you are less likely to run out of options.'
    when b.primary_category='Tutor' then 'Tutors up almost any card, so you can find your best play or a missing piece.'
    when b.primary_category='Interaction' then 'Gives you another way to answer opposing threats.'
    when b.primary_category='Board Wipe' then 'Provides a reset button when opponents get too far ahead.'
    when b.primary_category='Protection' then 'Helps protect important permanents from removal.'
    when b.primary_category='Mana Base' then 'Adds a commonly played land or utility land that fits your commander’s color identity.'
    when b.organic_deck_count > 0 then 'Other Geega customers building this commander often play this card too.'
    when b.theme_overlap > 0 then 'Shares themes and mechanics with your commander.'
    else 'Fits your commander color identity and fills a useful deck role.'
  end,
  coalesce(b.stocked_image_url, b.image_url),
  b.in_stock,
  b.inventory_item_id,
  b.store_price_cents,
  b.scryfall_price_cents,
  (
    b.role_score
    + least(b.theme_overlap * 8, 24)
    + b.popularity_score
    + b.synergy_bonus
    + case when b.in_stock then 1 else 0 end
  )::int
from budgeted b
where b.role_score > 2 or b.theme_overlap > 0 or b.synergy_bonus > 0
order by
  (
    b.role_score
    + least(b.theme_overlap * 8, 24)
    + b.popularity_score
    + b.synergy_bonus
  ) desc,
  b.edhrec_rank asc nulls last,
  b.scryfall_price_cents asc nulls last,
  b.card_name
limit greatest(1,least(coalesce(p_limit,24),60));
$$;

grant execute on function public.deck_recommendations(uuid,integer)
to authenticated;
