-- Cube checklists: price and popularity for every card, so the checklist can
-- sort by price, by CubeCobra draft rating and by how widely a card is
-- played, and show them next to each swap option.
--
--   cube_checklist_cards.price_cents   cheapest paper printing (non-foil when
--                                      there is one), in US cents
--   cube_checklist_cards.edhrec_rank   EDHREC popularity rank (1 = most played)
--   cube_checklists.stats_updated_at   when the list's stats were last refreshed
--   cube_checklists.prices_as_of       when the Scryfall data they came from
--                                      was downloaded
--
-- Everything comes from the local Scryfall data (scryfall_bulk_cards), looked
-- up by front-face name (the same key as cardKey() in
-- src/store/lib/cubeChecklist.ts). The stats belong to the card's name, so:
--   - a trigger fills them in whenever a slot's name changes (a swap or an
--     undo), along with that card's mana value;
--   - cube_checklist_refresh_card_stats() refreshes a whole list. The API runs
--     it at most once a day, so new prices from `npm run scryfall:refresh`
--     reach the checklist within a day. Only rows whose values change are
--     written (each write bumps updated_at, which makes everyone's page pick
--     the card up).
--
-- Same lockdown as the other checklist tables: written only by the API with
-- the service_role key; staff may read via RLS. Safe to run more than once.

alter table public.cube_checklist_cards
  add column if not exists price_cents integer check (price_cents is null or price_cents >= 0),
  add column if not exists edhrec_rank integer check (edhrec_rank is null or edhrec_rank > 0);

alter table public.cube_checklists
  add column if not exists stats_updated_at timestamptz,
  add column if not exists prices_as_of timestamptz;

comment on column public.cube_checklist_cards.price_cents is
  'Cheapest paper printing in US cents (non-foil when there is one), from scryfall_bulk_cards. Null = no price.';
comment on column public.cube_checklist_cards.edhrec_rank is
  'EDHREC popularity rank from Scryfall (1 = most played). Null = not ranked.';
comment on column public.cube_checklists.prices_as_of is
  'When the Scryfall data behind the cards'' prices was downloaded (scryfall_bulk_cards.bulk_updated_at).';

-- Price, popularity and mana value for one card. p_key is the front face,
-- lower-cased and trimmed. Paper printings only; art-series cards, tokens and
-- oversized cards share names with real cards but aren't the card.
create or replace function public.cube_checklist_card_stats(p_key text)
returns table (price_cents integer, edhrec_rank integer, mana_value numeric, prices_as_of timestamptz)
language sql
stable
set search_path to 'public'
as $$
  select
    round(100 * coalesce(min(h.usd), min(h.usd_other)))::integer,
    min(h.edhrec)::integer,
    min(h.cmc),
    max(h.bulk_updated_at)
  from (
    select
      nullif(b.raw -> 'prices' ->> 'usd', '')::numeric as usd,
      least(
        nullif(b.raw -> 'prices' ->> 'usd_foil', '')::numeric,
        nullif(b.raw -> 'prices' ->> 'usd_etched', '')::numeric
      ) as usd_other,
      nullif(b.raw ->> 'edhrec_rank', '')::integer as edhrec,
      -- mana_value columns are numeric(4,1); a joke card's 1,000,000 doesn't fit.
      case when nullif(b.raw ->> 'cmc', '')::numeric between 0 and 999 then nullif(b.raw ->> 'cmc', '')::numeric end as cmc,
      b.bulk_updated_at
    from public.scryfall_bulk_cards b
    where lower(btrim(split_part(b.card_name, '//', 1))) = p_key
      and coalesce((b.raw -> 'games') ? 'paper', false)
      and coalesce(b.raw ->> 'layout', '') not in ('art_series', 'token', 'double_faced_token', 'emblem')
      and coalesce(b.raw ->> 'oversized', 'false') <> 'true'
  ) h;
$$;

-- A slot that now holds a different card gets that card's stats.
create or replace function public.cube_checklist_card_stats_on_rename()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  s record;
begin
  select * into s from public.cube_checklist_card_stats(lower(btrim(split_part(new.name, '//', 1))));
  new.price_cents := s.price_cents;
  new.edhrec_rank := s.edhrec_rank;
  new.mana_value := s.mana_value;
  return new;
end;
$$;

drop trigger if exists cube_checklist_cards_stats on public.cube_checklist_cards;
create trigger cube_checklist_cards_stats
  before update of name on public.cube_checklist_cards
  for each row
  when (old.name is distinct from new.name)
  execute function public.cube_checklist_card_stats_on_rename();

-- Refresh a whole list's prices and popularity in one statement. Returns how
-- many cards changed.
create or replace function public.cube_checklist_refresh_card_stats(p_checklist_id uuid)
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  n integer;
  v_as_of timestamptz;
begin
  with s as (
    select c.id, st.price_cents, st.edhrec_rank, st.prices_as_of
    from public.cube_checklist_cards c
    cross join lateral public.cube_checklist_card_stats(lower(btrim(split_part(c.name, '//', 1)))) st
    where c.checklist_id = p_checklist_id
  ),
  up as (
    update public.cube_checklist_cards c
       set price_cents = s.price_cents,
           edhrec_rank = s.edhrec_rank
      from s
     where c.id = s.id
       and (c.price_cents is distinct from s.price_cents or c.edhrec_rank is distinct from s.edhrec_rank)
    returning 1
  )
  select (select count(*) from up), (select max(s.prices_as_of) from s) into n, v_as_of;

  update public.cube_checklists
     set stats_updated_at = now(),
         prices_as_of = coalesce(v_as_of, prices_as_of)
   where id = p_checklist_id;
  return n;
end;
$$;

-- Price and popularity for cards that aren't on a list yet (swap options).
-- One row per distinct name given, at most 50.
create or replace function public.cube_checklist_prices(p_names text[])
returns table (requested text, price_cents integer, edhrec_rank integer)
language sql
stable
set search_path to 'public'
as $$
  select r.n, st.price_cents, st.edhrec_rank
  from (
    select distinct u.n
    from unnest(p_names) as u(n)
    where btrim(coalesce(u.n, '')) <> ''
    limit 50
  ) r
  cross join lateral public.cube_checklist_card_stats(lower(btrim(split_part(r.n, '//', 1)))) st;
$$;

revoke all on function public.cube_checklist_card_stats(text) from public, anon, authenticated;
revoke all on function public.cube_checklist_card_stats_on_rename() from public, anon, authenticated;
revoke all on function public.cube_checklist_refresh_card_stats(uuid) from public, anon, authenticated;
revoke all on function public.cube_checklist_prices(text[]) from public, anon, authenticated;
grant execute on function public.cube_checklist_card_stats(text) to service_role;
grant execute on function public.cube_checklist_refresh_card_stats(uuid) to service_role;
grant execute on function public.cube_checklist_prices(text[]) to service_role;

-- Fill in the lists that already exist.
select public.cube_checklist_refresh_card_stats(id) from public.cube_checklists;
