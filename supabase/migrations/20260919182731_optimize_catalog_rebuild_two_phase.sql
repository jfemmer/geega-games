-- rebuild_card_recommendation_catalog() (previous migration) reliably hit
-- Postgres's statement_timeout (2 minutes on this project) once the
-- commander-legal prefilter was removed: it extracted every JSONB field
-- (color_identity, type_line, oracle_text, image_url, price, edhrec_rank)
-- for every English printing candidate BEFORE deduping down to one row per
-- oracle_id, so ~100k+ rows worth of JSONB decompression happened just to
-- keep the ~39k winners.
--
-- Two-phase fix: dedupe first on lightweight columns only (oracle_id,
-- released_at — backed by the scryfall_bulk_cards_en_oracle_released_idx
-- partial index added alongside this migration, so no JSONB is touched and
-- no sort is needed), THEN join back to extract the expensive fields for
-- only the ~39k winning rows. Confirmed to complete in well under the
-- statement_timeout.
create or replace function public.rebuild_card_recommendation_catalog()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate table public.card_recommendation_catalog;

  with winners as (
    select distinct on (b.oracle_id) b.oracle_id, b.scryfall_id
    from public.scryfall_bulk_cards b
    where b.lang = 'en' and b.oracle_id is not null
    order by b.oracle_id, b.released_at desc nulls last
  )
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
    select
      w.oracle_id::uuid as oracle_id,
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
      (b.raw->'legalities'->>'commander' = 'legal') as commander_legal
    from winners w
    join public.scryfall_bulk_cards b on b.scryfall_id = w.scryfall_id
  ) x;
end;
$$;
