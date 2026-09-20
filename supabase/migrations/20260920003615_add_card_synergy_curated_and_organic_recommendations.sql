-- Real synergy data for deck suggestions, in two layers (per product
-- decision: live scraping of EDHREC/Moxfield/Archidekt isn't reachable
-- from this environment and carries its own ToS/reliability risk, so we
-- build on data we fully own instead):
--
-- 1. A hand-curated table of well-known Commander synergy/combo pairs
--    (card_synergy_curated) - things every experienced Commander player
--    knows, not scraped from anyone. Gives real signal from day one.
-- 2. A live, organic "customers who built this commander also played..."
--    signal computed directly from Geega's own saved customer decks
--    (commander_organic_synergy). Produces little/nothing today given how
--    few decks exist yet, but requires zero external dependency and
--    automatically improves as real customers save more decks over time.
--
-- Both are threaded into deck_recommendations as an additive scoring
-- signal on top of the existing color-identity/legality/in-stock filters,
-- which are completely unchanged - a curated or organic match can only
-- ever affect ranking among cards that already passed every existing
-- eligibility check.

create table public.card_synergy_curated (
  id uuid primary key default gen_random_uuid(),
  card_a_name text not null,
  card_b_name text not null,
  card_a_oracle_id uuid,
  card_b_oracle_id uuid,
  synergy_note text not null,
  created_at timestamptz not null default now()
);

comment on table public.card_synergy_curated is
  'Hand-curated, well-known Commander synergy/combo pairs used to boost deck_recommendations. card_a/b_oracle_id are resolved from the names below against scryfall_bulk_cards; a NULL means the name failed to resolve and that row is inert until fixed.';

insert into public.card_synergy_curated (card_a_name, card_b_name, synergy_note) values
('Thassa''s Oracle', 'Demonic Consultation', 'Name a card you know isn''t in your deck to empty your library, then Thassa''s Oracle wins the game on the spot.'),
('Thassa''s Oracle', 'Tainted Pact', 'Same instant-win as Demonic Consultation, but exiles your deck instead of milling it.'),
('Isochron Scepter', 'Dramatic Reversal', 'Imprint Dramatic Reversal, then untap all your mana rocks each activation - infinite mana with three or more rocks out.'),
('Kiki-Jiki, Mirror Breaker', 'Restoration Angel', 'Copy Restoration Angel to blink Kiki-Jiki itself, resetting it to do it again - an infinite combo on the spot.'),
('Splinter Twin', 'Deceiver Exarch', 'Copy the enchanted creature for an endless stream of hasty token copies.'),
('Basalt Monolith', 'Rings of Brighthearth', 'Copy the untap ability for infinite colorless mana.'),
('Grim Monolith', 'Power Artifact', 'Untap Grim Monolith over and over for infinite colorless mana (needs blue mana available).'),
('Palinchron', 'Deadeye Navigator', 'Blink Palinchron repeatedly for a net mana gain each time - infinite mana with enough color fixing.'),
('Sanguine Bond', 'Exquisite Blood', 'Any life you gain drains an opponent for the same amount, which triggers Sanguine Bond again - a fatal loop.'),
('Vito, Thorn of the Dusk Rose', 'Exquisite Blood', 'Vito functions like a creature version of Sanguine Bond - pairs with Exquisite Blood the same way.'),
('Blood Artist', 'Ashnod''s Altar', 'A free way to sacrifice creatures turns every death into a drain trigger and mana.'),
('Zulaport Cutthroat', 'Ashnod''s Altar', 'Free sacrifice fodder becomes repeatable drain and mana.'),
('Entomb', 'Reanimate', 'Put your best creature straight into the graveyard, then bring it back the same turn for a fraction of its cost.'),
('Buried Alive', 'Reanimate', 'Tutor up to three creatures into your graveyard, then reanimate the best one immediately.'),
('Muldrotha, the Gravetide', 'Life from the Loam', 'Recur a land from your graveyard every turn while Muldrotha lets you replay everything else.'),
('Meren of Clan Nel Toth', 'Nether Traitor', 'Meren can bring this creature back from the graveyard at no mana cost every turn once she has experience counters.'),
('Sigarda''s Aid', 'Bonesplitter', 'Cast this equipment for free off Sigarda''s Aid and attach it the same turn, even to a creature you just flashed in.'),
('Puresteel Paladin', 'Bonesplitter', 'Draw a card the instant you cast this equipment, then equip it for free.'),
('Guttersnipe', 'Lightning Bolt', 'Every cheap instant or sorcery like this also deals 2 damage to each opponent.'),
('Young Pyromancer', 'Opt', 'Every cheap instant or sorcery like this also leaves behind a 1/1 Elemental token.'),
('Lotus Cobra', 'Evolving Wilds', 'Cracking this (or any fetch land) triggers an extra burst of mana.'),
('Tatyova, Benevolent Archmage', 'Evolving Wilds', 'Every land you play, including from a fetch like this, draws a card and gains a life.'),
('Hardened Scales', 'Winding Constrictor', 'Both double up on any extra +1/+1 counters you would add - stack them for even more.'),
('The Ozolith', 'Hangarback Walker', 'Keep this creature''s counters when it dies, then use them to rebuild a fresh board of Thopters.'),
('Anointed Procession', 'Krenko, Mob Boss', 'Doubles Krenko''s already-massive Goblin token output.'),
('Krenko, Mob Boss', 'Purphoros, God of the Forge', 'Every Goblin token Krenko makes also pings each opponent for damage.'),
('Impact Tremors', 'Bitterblossom', 'Every token this (or any token generator) makes also deals 1 damage to each opponent.'),
('Edgar Markov', 'Captivating Vampire', 'A Vampire tribal payoff that pumps your team and can steal an opponent''s best creature.'),
('The Ur-Dragon', 'Scion of the Ur-Dragon', 'A cheap Dragon that can search up or discount casting your commander.'),
('Atraxa, Praetors'' Voice', 'Doubling Season', 'Doubles every proliferate trigger, planeswalker loyalty gain, and counter Atraxa adds.'),
('Feldon of the Third Path', 'Massacre Wurm', 'Re-trigger this devastating enter-the-battlefield effect from your graveyard every turn.'),
('Yuriko, the Tiger''s Shadow', 'Ninja of the Deep Hours', 'A cheap ninja you can bounce back to hand to re-trigger Yuriko''s damage-based card draw again and again.'),
('Nekusar, the Mindrazer', 'Wheel of Fortune', 'Everyone drawing a new hand deals a full 7 damage to each opponent off Nekusar.'),
('The Locust God', 'Windfall', 'Big draw-and-discard effects like this fuel a swarm of Insect tokens and extra cards.'),
('Sydri, Galvanic Genius', 'Nevinyrral''s Disk', 'Turns a one-shot board wipe artifact into a deathtouch creature that trades with anything.'),
('Korvold, Fae-Cursed King', 'Pitiless Plunderer', 'Free sacrifice fodder in Treasure form keeps feeding Korvold''s card draw and growth.'),
('Prossh, Skyraider of Kher', 'Ashnod''s Altar', 'Sacrifice the free Kobold tokens Prossh makes for mana, then do it again next turn.'),
('Kess, Dissident Mage', 'Cyclonic Rift', 'Recast a devastating one-sided board bounce from your graveyard every turn.'),
('Tymna the Weaver', 'Kraum, Ludevic''s Opinion', 'A classic partner pairing built around drawing cards off nearly every combat hit.'),
('Thrasios, Triton Hero', 'Tymna the Weaver', 'Another well-known value partner pairing combining card draw with extra mana.'),
('Vial Smasher the Fierce', 'Bruse Tarl, Boorish Herder', 'A classic aggressive partner pairing built around damage output.'),
('Anointed Procession', 'Craterhoof Behemoth', 'Twice as many tokens means a much bigger game-ending overrun swing.'),
('Sneak Attack', 'Blightsteel Colossus', 'Cheat this game-ending infect creature into play for one huge attack.'),
('Show and Tell', 'Omniscience', 'Put this powerful enchantment into play for free, then cast the rest of your hand without paying mana costs.'),
('Sensei''s Divining Top', 'Scroll Rack', 'Shuffle away your hand''s worst cards while filtering the top of your library every turn - a classic card-selection engine.');

-- Resolve each name to its canonical oracle_id, same lookup priority as
-- resolve_deck_card_names (prefer a commander-legal, most-recently-
-- released English printing). A correlated scalar subquery in SET (not a
-- FROM-clause join) is required here since the target row's own columns
-- (card_a_name/card_b_name) need to be visible inside the subquery, and
-- Postgres UPDATE...FROM items cannot reference the update target even
-- when marked LATERAL. A name with no match is silently left NULL rather
-- than failing the whole seed - that row just stays inert until the
-- spelling is fixed in a follow-up update.
update public.card_synergy_curated csc
set card_a_oracle_id = (
  select b.oracle_id::uuid
  from public.scryfall_bulk_cards b
  where b.lang = 'en' and lower(b.card_name) = lower(trim(csc.card_a_name))
  order by (b.raw->'legalities'->>'commander' = 'legal') desc, b.released_at desc nulls last
  limit 1
);

update public.card_synergy_curated csc
set card_b_oracle_id = (
  select b.oracle_id::uuid
  from public.scryfall_bulk_cards b
  where b.lang = 'en' and lower(b.card_name) = lower(trim(csc.card_b_name))
  order by (b.raw->'legalities'->>'commander' = 'legal') desc, b.released_at desc nulls last
  limit 1
);

create index card_synergy_curated_a_idx on public.card_synergy_curated(card_a_oracle_id);
create index card_synergy_curated_b_idx on public.card_synergy_curated(card_b_oracle_id);

alter table public.card_synergy_curated enable row level security;
drop policy if exists "curated synergy is public read" on public.card_synergy_curated;
create policy "curated synergy is public read"
on public.card_synergy_curated for select to authenticated
using (true);

-- Needed so the organic co-occurrence self-join below (which must see
-- every row for a given oracle_id, not just unowned ones) has an index to
-- use - the existing customer_deck_cards_watch_idx is partial on
-- owned=false only.
create index customer_deck_cards_oracle_idx
  on public.customer_deck_cards(oracle_id)
  where oracle_id is not null;

-- Cross-customer aggregate: for a given commander, how many OTHER saved
-- decks (across every Geega customer, not just the caller) with that same
-- commander also include each candidate card. security definer because
-- RLS would otherwise hide every other customer's deck_cards from the
-- caller entirely; this function deliberately narrows what it exposes to
-- an anonymized count only - never which customer, which deck, or any
-- other card in that deck. The >=2 threshold avoids one single other deck
-- creating a huge, statistically meaningless signal (or making that one
-- other deck identifiable).
create or replace function public.commander_organic_synergy(
  p_commander_oracle_id uuid,
  p_exclude_deck_id uuid
)
returns table(oracle_id uuid, deck_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select dc2.oracle_id, count(distinct dc2.deck_id)::int
  from public.customer_deck_cards dc1
  join public.customer_deck_cards dc2
    on dc2.deck_id = dc1.deck_id
   and dc2.oracle_id is not null
   and dc2.oracle_id <> dc1.oracle_id
  where dc1.oracle_id = p_commander_oracle_id
    and dc1.deck_id <> p_exclude_deck_id
  group by dc2.oracle_id
  having count(distinct dc2.deck_id) >= 2;
$$;

revoke all on function public.commander_organic_synergy(uuid, uuid) from public, anon;
grant execute on function public.commander_organic_synergy(uuid, uuid) to authenticated;

-- deck_recommendations: fold in curated + organic synergy as an additive
-- score on top of every existing filter (color identity, commander
-- legality, already-in-deck exclusion, in-stock). Neither signal can ever
-- surface a card that fails those - they only re-rank and re-explain
-- candidates that already passed them. A curated or organic match also
-- bypasses the generic edhrec_rank<=15000 popularity cutoff, since a
-- specific known synergy is stronger evidence than overall popularity.
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
    inv.store_price_cents,
    true as in_stock
  from candidates c
  join lateral (
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
  b.image_url,
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
