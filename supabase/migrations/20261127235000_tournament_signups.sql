-- Tournaments: players sign themselves up from the player display.
--
-- Staff create a tournament with a number of player spots. Players scan the
-- QR code, enter their name (and commander, if they like) and take a spot.
-- When the last spot fills, the API starts round 1 on its own.
--
--   • tournaments.spots: player spots (players, not teams, for Two-Headed
--     Giant). null = no sign-ups: staff enter everyone, as before.
--   • A Two-Headed Giant sign-up may be on their own for now (player_two
--     null) until round 1: someone can team up with them, and whoever is
--     left gets a random teammate when the tournament starts
--     (tournament_form_teams). Round 1 can't be paired with anyone alone.
--   • tournament_sign_up(): takes a spot in one transaction, so two phones
--     can't both take the last one.
--
-- Same lockdown: only the API (service_role) calls these. Safe to run more
-- than once.

alter table public.tournaments
  add column if not exists spots integer check (spots is null or spots between 2 and 128);

comment on column public.tournaments.spots is
  'Player spots for sign-ups from the player display (players, not teams). null = staff enter everyone.';

-- An entrant matches its tournament's format. A Two-Headed Giant sign-up may
-- be on their own until round 1 is paired.
create or replace function public.tournament_entrant_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_format text;
  v_round integer;
begin
  select t.format, t.current_round into v_format, v_round from public.tournaments t where t.id = new.tournament_id;
  if v_format = '2hg' and new.player_two is null and v_round > 0 then
    raise exception 'A Two-Headed Giant team needs two players.' using errcode = 'GGT01';
  end if;
  if v_format = '1v1' and new.player_two is not null then
    raise exception 'A 1v1 entrant is one player.' using errcode = 'GGT01';
  end if;
  if new.player_two is not null and lower(new.player_one) = lower(new.player_two) then
    raise exception 'A team needs two different players.' using errcode = 'GGT01';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Takes a spot. p_team_with (Two-Headed Giant only) joins someone who signed
-- up on their own, as their teammate. Returns { entrant_id, seat, players, spots }.
-- Errors: GGT01 bad input, GGT03 not found, GGT04 closed or full,
-- GGT05 name taken / teammate already has one.
create or replace function public.tournament_sign_up(
  p_tournament_id uuid,
  p_name text,
  p_commander text,
  p_card uuid,
  p_team_with uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_players integer;
  v_id uuid;
  v_seat integer;
begin
  select * into v_tournament from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'That tournament no longer exists.' using errcode = 'GGT03';
  end if;
  if v_tournament.status <> 'active' or v_tournament.current_round > 0 then
    raise exception 'Sign-ups are closed: this tournament has started.' using errcode = 'GGT04';
  end if;
  if v_tournament.spots is null then
    raise exception 'This tournament isn''t taking sign-ups. Ask the store to add you.' using errcode = 'GGT04';
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'Enter your name.' using errcode = 'GGT01';
  end if;

  select coalesce(sum(case when e.player_two is null then 1 else 2 end), 0)::integer into v_players
  from public.tournament_entrants e
  where e.tournament_id = p_tournament_id and e.dropped_at is null;
  if v_players >= v_tournament.spots then
    raise exception 'Sorry, every spot is taken.' using errcode = 'GGT04';
  end if;

  if exists (
    select 1 from public.tournament_entrants e
    where e.tournament_id = p_tournament_id
      and (lower(e.player_one) = lower(p_name) or lower(coalesce(e.player_two, '')) = lower(p_name))
  ) then
    raise exception 'Someone named % has already signed up. Add your last initial.', p_name using errcode = 'GGT05';
  end if;

  if p_team_with is not null then
    if v_tournament.format <> '2hg' then
      raise exception 'Teammates are only for Two-Headed Giant.' using errcode = 'GGT01';
    end if;
    update public.tournament_entrants e
      set player_two = p_name, commander_two = p_commander, commander_two_card = p_card
      where e.id = p_team_with
        and e.tournament_id = p_tournament_id
        and e.player_two is null
        and e.dropped_at is null
      returning e.id into v_id;
    if v_id is null then
      raise exception 'That player already has a teammate. Pick someone else, or get a random teammate.' using errcode = 'GGT05';
    end if;
    v_seat := 1;
  else
    insert into public.tournament_entrants (tournament_id, player_one, commander_one, commander_one_card)
    values (p_tournament_id, p_name, p_commander, p_card)
    returning id into v_id;
    v_seat := 0;
  end if;

  return jsonb_build_object('entrant_id', v_id, 'seat', v_seat, 'players', v_players + 1, 'spots', v_tournament.spots);
end;
$$;

-- Two-Headed Giant, before round 1: puts players who signed up on their own
-- into teams. p_pairs: [{ "keep": uuid, "merge": uuid }, …]: merge's player
-- (and commander) becomes keep's teammate, and merge's row goes. Afterwards
-- nobody may be left alone.
create or replace function public.tournament_form_teams(p_tournament_id uuid, p_pairs jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_item jsonb;
  v_keep uuid;
  v_merge uuid;
  v_row public.tournament_entrants%rowtype;
  v_count integer := 0;
begin
  select * into v_tournament from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'That tournament no longer exists.' using errcode = 'GGT03';
  end if;
  if v_tournament.format <> '2hg' or v_tournament.status <> 'active' or v_tournament.current_round > 0 then
    raise exception 'Teams can only be made before round 1.' using errcode = 'GGT02';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) loop
    v_keep := nullif(v_item ->> 'keep', '')::uuid;
    v_merge := nullif(v_item ->> 'merge', '')::uuid;
    if v_keep is null or v_merge is null or v_keep = v_merge then
      raise exception 'Each team needs two different players.' using errcode = 'GGT01';
    end if;
    delete from public.tournament_entrants e
      where e.id = v_merge and e.tournament_id = p_tournament_id and e.player_two is null and e.dropped_at is null
      returning * into v_row;
    if not found then
      raise exception 'The sign-up list changed while you were working. Refresh and try again.' using errcode = 'GGT02';
    end if;
    update public.tournament_entrants e
      set player_two = v_row.player_one, commander_two = v_row.commander_one, commander_two_card = v_row.commander_one_card
      where e.id = v_keep and e.tournament_id = p_tournament_id and e.player_two is null and e.dropped_at is null;
    if not found then
      raise exception 'The sign-up list changed while you were working. Refresh and try again.' using errcode = 'GGT02';
    end if;
    v_count := v_count + 1;
  end loop;

  if exists (
    select 1 from public.tournament_entrants e
    where e.tournament_id = p_tournament_id and e.dropped_at is null and e.player_two is null
  ) then
    raise exception 'Every Two-Headed Giant team needs two players.' using errcode = 'GGT02';
  end if;
  return v_count;
end;
$$;

-- As in 20261127200000_tournaments.sql, plus: a Two-Headed Giant round can't
-- be paired while anyone is still without a teammate.
create or replace function public.tournament_pair_round(
  p_tournament_id uuid,
  p_round integer,
  p_replace boolean,
  p_pairings jsonb
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_item jsonb;
  v_a uuid;
  v_b uuid;
  v_seen uuid[] := '{}';
  v_table integer := 0;
  v_active integer;
begin
  select * into v_tournament from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'That tournament no longer exists.' using errcode = 'GGT03';
  end if;
  if v_tournament.status <> 'active' then
    raise exception 'This tournament is finished. Reopen it to pair another round.' using errcode = 'GGT02';
  end if;
  if p_pairings is null or jsonb_typeof(p_pairings) <> 'array' or jsonb_array_length(p_pairings) = 0 then
    raise exception 'There''s nobody to pair.' using errcode = 'GGT01';
  end if;
  if v_tournament.format = '2hg' and exists (
    select 1 from public.tournament_entrants e
    where e.tournament_id = p_tournament_id and e.dropped_at is null and e.player_two is null
  ) then
    raise exception 'Every Two-Headed Giant team needs two players before the round can be paired.' using errcode = 'GGT02';
  end if;

  if coalesce(p_replace, false) then
    if p_round < 1 or v_tournament.current_round <> p_round then
      raise exception 'The rounds changed while you were working. Refresh and try again.' using errcode = 'GGT02';
    end if;
    if exists (
      select 1 from public.tournament_matches m
      where m.tournament_id = p_tournament_id and m.round = p_round and m.result in ('a', 'b', 'draw')
    ) then
      raise exception 'Results are already in for round %, so it can''t be re-paired.', p_round using errcode = 'GGT02';
    end if;
    delete from public.tournament_matches m where m.tournament_id = p_tournament_id and m.round = p_round;
  else
    if v_tournament.current_round <> p_round - 1 then
      raise exception 'Round % is already paired. Refresh to see it.', p_round using errcode = 'GGT02';
    end if;
    if exists (
      select 1 from public.tournament_matches m
      where m.tournament_id = p_tournament_id and m.round = v_tournament.current_round and m.result = 'pending'
    ) then
      raise exception 'Record every result in round % before pairing the next one.', v_tournament.current_round
        using errcode = 'GGT02';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_pairings) loop
    v_a := nullif(v_item ->> 'a', '')::uuid;
    v_b := nullif(v_item ->> 'b', '')::uuid;
    if v_a is null then
      raise exception 'Every pairing needs a player.' using errcode = 'GGT01';
    end if;
    if v_a = any (v_seen) or (v_b is not null and v_b = any (v_seen)) then
      raise exception 'Someone was paired twice in one round.' using errcode = 'GGT01';
    end if;
    v_seen := v_seen || v_a;
    if v_b is not null then
      v_seen := v_seen || v_b;
    end if;
    v_table := v_table + 1;
    insert into public.tournament_matches (tournament_id, round, table_number, entrant_a, entrant_b, result)
    values (p_tournament_id, p_round, v_table, v_a, v_b, case when v_b is null then 'bye' else 'pending' end);
  end loop;

  select count(*) into v_active
  from public.tournament_entrants e
  where e.tournament_id = p_tournament_id and e.dropped_at is null;
  if v_active <> cardinality(v_seen) or exists (
    select 1 from unnest(v_seen) as s(id)
    where not exists (
      select 1 from public.tournament_entrants e
      where e.id = s.id and e.tournament_id = p_tournament_id and e.dropped_at is null
    )
  ) then
    raise exception 'The player list changed while you were working. Refresh and try again.' using errcode = 'GGT02';
  end if;

  update public.tournaments set current_round = p_round where id = p_tournament_id;
  return p_round;
end;
$$;

revoke all on function public.tournament_entrant_check() from public, anon, authenticated;
revoke all on function public.tournament_sign_up(uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.tournament_sign_up(uuid, text, text, uuid, uuid) to service_role;
revoke all on function public.tournament_form_teams(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tournament_form_teams(uuid, jsonb) to service_role;
revoke all on function public.tournament_pair_round(uuid, integer, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.tournament_pair_round(uuid, integer, boolean, jsonb) to service_role;
