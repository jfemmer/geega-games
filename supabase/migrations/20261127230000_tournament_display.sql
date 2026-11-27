-- Tournaments: the player display (/tournament?t=<token>) and commanders.
--
--   • tournaments.share_token / share_enabled: the secret link players open
--     on their phones (or staff put on a TV) to see pairings, results and
--     standings. Every tournament gets one; staff can turn it off or replace
--     it. Read through POST /api/tournament with the service_role key.
--   • tournament_entrants.commander_one / commander_two: the commander each
--     player is on (optional), lined up with player_one / player_two, plus the
--     Scryfall card id of the card picked from the search, for its art.
--
-- Still no anon/authenticated writes: players set commanders through the API,
-- which checks the share link. Safe to run more than once.

alter table public.tournaments
  add column if not exists share_token text not null
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
    check (char_length(share_token) between 20 and 100);
alter table public.tournaments
  add column if not exists share_enabled boolean not null default true;

create unique index if not exists tournaments_share_token_uidx on public.tournaments (share_token);

comment on column public.tournaments.share_token is
  'Secret for the player display link. Anyone with it can see the tournament and set commanders while share_enabled.';

alter table public.tournament_entrants
  add column if not exists commander_one text
    check (commander_one is null or char_length(commander_one) between 1 and 120);
alter table public.tournament_entrants
  add column if not exists commander_one_card uuid;
alter table public.tournament_entrants
  add column if not exists commander_two text
    check (commander_two is null or char_length(commander_two) between 1 and 120);
alter table public.tournament_entrants
  add column if not exists commander_two_card uuid;

do $$
begin
  -- A card id only goes with a commander name, and a second commander only
  -- with a second player (Two-Headed Giant).
  if not exists (select 1 from pg_constraint where conname = 'tournament_entrants_commander_cards_check') then
    alter table public.tournament_entrants add constraint tournament_entrants_commander_cards_check check (
      (commander_one_card is null or commander_one is not null)
      and (commander_two_card is null or commander_two is not null)
      and (commander_two is null or player_two is not null)
    );
  end if;
end;
$$;
