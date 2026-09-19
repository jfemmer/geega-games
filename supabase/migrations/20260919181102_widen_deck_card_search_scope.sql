-- Widen deck card-name search/resolution beyond Commander-legal-only.
--
-- card_recommendation_catalog was built for one purpose (Commander upgrade
-- suggestions) but got reused as the data source for search_deck_card_names
-- and resolve_deck_card_names too, which serve EVERY format (Standard,
-- Modern, Freeform, ...). Since it only ever contained commander-legal
-- cards, any card on Commander's specific (short) banlist was unsearchable
-- and unresolvable in a decklist for ANY format, not just Commander.
--
-- Fix: keep one catalog (avoid duplicating ~39k rows of extracted Scryfall
-- data into a second table), but stop filtering it down at population time.
-- Add a commander_legal column so deck_recommendations — which genuinely
-- must stay commander-only, since suggesting a banned card as an upgrade
-- would be wrong — filters on that column explicitly instead of relying on
-- "present in the catalog" to mean "commander-legal".

alter table public.card_recommendation_catalog
  add column if not exists commander_legal boolean not null default false;

-- The catalog's populate-from-scryfall_bulk_cards logic, previously inlined
-- directly in a migration (so it only ever ran once, at migration time),
-- extracted into a callable function so it can be re-run — by hand, or on
-- the schedule added in the next migration — whenever scryfall_bulk_cards
-- is refreshed with new sets. Logic is otherwise unchanged from the
-- original migration; only the commander-legal WHERE filter moved from the
-- population query into a stored column.
create or replace function public.rebuild_card_recommendation_catalog()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate table public.card_recommendation_catalog;

  insert into public.card_recommendation_catalog(
    oracle_id, card_name, color_identity, type_line, oracle_text,
    image_url, scryfall_price_cents, edhrec_rank, primary_category, themes,
    commander_legal, updated_at
  )
  select
    x.oracle_id,
    x.card_name,
    x.color_identity,
    x.type_line,
    x.oracle_text,
    x.image_url,
    x.scryfall_price_cents,
    x.edhrec_rank,
    case
      when lower(x.type_line) like '%land%' then 'Mana Base'
      when lower(x.oracle_text) ~ '(draw (a|two|three|x|that many|cards)|draw [0-9]+ cards)' then 'Card Draw'
      when lower(x.oracle_text) ~ '(destroy all|exile all|all creatures get -)' then 'Board Wipe'
      when lower(x.oracle_text) ~ '(destroy target|exile target|counter target spell|deals? [0-9x]+ damage to target)' then 'Interaction'
      when lower(x.oracle_text) ~ '(add \{|search your library for .*land card|untap target land)' then 'Ramp'
      when lower(x.oracle_text) ~ '(hexproof|indestructible|phase out|protection from)' then 'Protection'
      else 'Synergy'
    end,
    array_remove(array[
      case when lower(x.oracle_text || ' ' || x.type_line) like '%graveyard%' then 'graveyard' end,
      case when lower(x.oracle_text || ' ' || x.type_line) like '%token%' then 'token' end,
      case when lower(x.oracle_text || ' ' || x.type_line) like '%sacrifice%' then 'sacrifice' end,
      case when lower(x.oracle_text || ' ' || x.type_line) like '%artifact%' then 'artifact' end,
      case when lower(x.oracle_text || ' ' || x.type_line) like '%enchantment%' then 'enchantment' end,
      case when lower(x.oracle_text || ' ' || x.type_line) like '%counter%' then 'counters' end,
      case when lower(x.oracle_text || ' ' || x.type_line) like '%instant%'
             or lower(x.oracle_text || ' ' || x.type_line) like '%sorcery%' then 'spells' end,
      case when lower(x.oracle_text || ' ' || x.type_line) like '%land%' then 'lands' end,
      case when lower(x.oracle_text || ' ' || x.type_line) like '%creature%' then 'creatures' end
    ], null),
    x.commander_legal,
    now()
  from (
    select distinct on (b.oracle_id)
      b.oracle_id::uuid as oracle_id,
      b.card_name,
      coalesce(
        array(select jsonb_array_elements_text(coalesce(b.raw->'color_identity','[]'::jsonb))),
        '{}'
      )::text[] as color_identity,
      coalesce(b.raw->>'type_line','') as type_line,
      coalesce(b.raw->>'oracle_text','') as oracle_text,
      coalesce(
        b.raw->'image_uris'->>'normal',
        b.raw->'card_faces'->0->'image_uris'->>'normal'
      ) as image_url,
      case
        when nullif(b.raw->'prices'->>'usd','') is not null
        then round((b.raw->'prices'->>'usd')::numeric * 100)::int
        else null
      end as scryfall_price_cents,
      case
        when nullif(b.raw->>'edhrec_rank','') is not null
        then (b.raw->>'edhrec_rank')::int
        else null
      end as edhrec_rank,
      -- Widened: was "where ... and legalities.commander = 'legal'" here.
      -- Now every English card with an oracle_id is included; legality is
      -- captured instead of used as an inclusion filter.
      (b.raw->'legalities'->>'commander' = 'legal') as commander_legal
    from public.scryfall_bulk_cards b
    where b.lang = 'en'
      and b.oracle_id is not null
    order by b.oracle_id, b.released_at desc nulls last
  ) x;
end;
$$;

revoke all on function public.rebuild_card_recommendation_catalog() from public, anon, authenticated;
grant execute on function public.rebuild_card_recommendation_catalog() to service_role;

-- Note: this migration deliberately does NOT call
-- rebuild_card_recommendation_catalog() yet. The single-pass version above
-- extracts every JSONB field for every candidate row before deduping,
-- which reliably exceeds Postgres's statement_timeout once the
-- commander-legal prefilter is removed and the candidate set grows from
-- ~32k to ~39k rows — see the next migration, which replaces this function
-- with a two-phase version and then actually runs the rebuild.

-- deck_recommendations must stay commander-only (recommending a
-- commander-banned card as an "upgrade" would be wrong) — filter on the
-- new column explicitly instead of relying on catalog membership.
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
    end as popularity_score
  from public.card_recommendation_catalog c
  cross join commander cmd
  where c.commander_legal
    and c.oracle_id <> cmd.oracle_id
    and c.color_identity <@ cmd.color_identity
    and not exists (select 1 from deck_cards dc where dc.oracle_id=c.oracle_id)
    and (c.edhrec_rank is null or c.edhrec_rank <= 15000)
),
with_stock as (
  select
    c.*,
    inv.id as inventory_item_id,
    inv.store_price_cents,
    (inv.id is not null) as in_stock
  from candidates c
  left join lateral (
    select
      i.id,
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
    when b.primary_category='Ramp' then 'Helps your deck accelerate mana and develop earlier.'
    when b.primary_category='Card Draw' then 'Adds card advantage so you are less likely to run out of options.'
    when b.primary_category='Interaction' then 'Gives you another way to answer opposing threats.'
    when b.primary_category='Board Wipe' then 'Provides a reset button when opponents get too far ahead.'
    when b.primary_category='Protection' then 'Helps protect important permanents from removal.'
    when b.primary_category='Mana Base' then 'Adds a commonly played land or utility land that fits your commander’s color identity.'
    when b.theme_overlap > 0 then 'Shares themes and mechanics with your commander.'
    else 'Fits your commander color identity and fills a useful deck role.'
  end,
  b.image_url,
  b.in_stock,
  b.inventory_item_id,
  b.store_price_cents,
  b.scryfall_price_cents,
  (
    b.role_score
    + least(b.theme_overlap * 8, 24)
    + b.popularity_score
    + case when b.in_stock then 1 else 0 end
  )::int
from budgeted b
where b.role_score > 2 or b.theme_overlap > 0
order by
  (
    b.role_score
    + least(b.theme_overlap * 8, 24)
    + b.popularity_score
  ) desc,
  b.edhrec_rank asc nulls last,
  b.scryfall_price_cents asc nulls last,
  b.card_name
limit greatest(1,least(coalesce(p_limit,24),60));
$$;

grant execute on function public.deck_recommendations(uuid,integer)
to authenticated;

-- resolve_deck_card_names previously reported "found in the (then
-- commander-only) catalog" as commander_legal, which is now wrong since
-- the catalog includes every format's cards. Report the real column.
create or replace function public.resolve_deck_card_names(p_names text[])
returns table(
  input_name text,
  card_name text,
  oracle_id uuid,
  scryfall_id uuid,
  type_line text,
  image_url text,
  commander_legal boolean
)
language sql
stable
security invoker
set search_path=public
as $$
  select
    n.input_name,
    c.card_name,
    c.oracle_id,
    null::uuid as scryfall_id,
    c.type_line,
    c.image_url,
    coalesce(c.commander_legal, false) as commander_legal
  from unnest(p_names) with ordinality as n(input_name, ord)
  left join lateral (
    select rc.*
    from public.card_recommendation_catalog rc
    where lower(rc.card_name)=lower(trim(n.input_name))
    order by rc.edhrec_rank asc nulls last
    limit 1
  ) c on true
  order by n.ord;
$$;

grant execute on function public.resolve_deck_card_names(text[])
to authenticated;
