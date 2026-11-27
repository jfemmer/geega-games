-- Tournaments (admin → Tournaments): casual 1v1 and Two-Headed Giant events.
-- Staff enter players (or teams of two), the API pairs each round at random
-- with opponents who haven't played each other yet, and staff record who won.
-- Standings are worked out from these rows (src/admin/utils/tournament.ts).
--
-- Same lockdown as cube_checklists: no anon/authenticated writes at all.
-- Every write goes through /api/admin/tournaments with the service_role key
-- after requireStaff(). Staff may read directly via RLS.
--
-- Safe to run more than once.

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  -- '1v1' = one player per entrant; '2hg' = Two-Headed Giant, fixed teams of two.
  format text not null check (format in ('1v1', '2hg')),
  status text not null default 'active' check (status in ('active', 'finished')),
  -- The last round paired (0 = not started).
  current_round integer not null default 0 check (current_round between 0 and 500),
  created_by text check (created_by is null or char_length(created_by) <= 320),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((status = 'finished') = (finished_at is not null))
);

comment on table public.tournaments is
  'Casual 1v1 / Two-Headed Giant tournaments. Written only by /api/admin/tournaments (service_role); staff read-only via RLS.';

create index if not exists tournaments_created_idx on public.tournaments (created_at desc);

create table if not exists public.tournament_entrants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_one text not null check (char_length(player_one) between 1 and 40),
  -- Set for a Two-Headed Giant team, null for 1v1 (the trigger below checks).
  player_two text check (player_two is null or char_length(player_two) between 1 and 40),
  -- Left the tournament: kept in the standings, not paired again.
  dropped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lets matches require both entrants to belong to the match's tournament.
  unique (id, tournament_id)
);

comment on table public.tournament_entrants is
  'A player (1v1) or a team of two (Two-Headed Giant) in a tournament.';

create index if not exists tournament_entrants_tournament_idx
  on public.tournament_entrants (tournament_id, created_at);
-- The same player (or team) can't be entered twice.
create unique index if not exists tournament_entrants_name_uidx
  on public.tournament_entrants (tournament_id, lower(player_one), lower(coalesce(player_two, '')));

create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round integer not null check (round between 1 and 500),
  table_number integer not null check (table_number between 1 and 1000),
  entrant_a uuid not null,
  -- null = a bye for entrant_a.
  entrant_b uuid,
  result text not null default 'pending' check (result in ('pending', 'a', 'b', 'draw', 'bye')),
  reported_by text check (reported_by is null or char_length(reported_by) <= 320),
  reported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (entrant_a, tournament_id)
    references public.tournament_entrants (id, tournament_id) on delete cascade,
  foreign key (entrant_b, tournament_id)
    references public.tournament_entrants (id, tournament_id) on delete cascade,
  check (entrant_a <> entrant_b),
  check ((entrant_b is null) = (result = 'bye')),
  check ((result in ('a', 'b', 'draw')) = (reported_at is not null))
);

comment on table public.tournament_matches is
  'One pairing in a tournament round (entrant_b null = a bye). Rounds are written only by tournament_pair_round().';

create unique index if not exists tournament_matches_table_uidx
  on public.tournament_matches (tournament_id, round, table_number);
-- No rematches: two entrants meet at most once per tournament.
create unique index if not exists tournament_matches_no_rematch_uidx
  on public.tournament_matches (tournament_id, least(entrant_a, entrant_b), greatest(entrant_a, entrant_b))
  where entrant_b is not null;
create index if not exists tournament_matches_entrant_a_idx on public.tournament_matches (entrant_a);
create index if not exists tournament_matches_entrant_b_idx on public.tournament_matches (entrant_b);

-- updated_at from the database clock.
create or replace function public.tournament_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tournaments_touch on public.tournaments;
create trigger tournaments_touch
  before update on public.tournaments
  for each row execute function public.tournament_touch();

drop trigger if exists tournament_matches_touch on public.tournament_matches;
create trigger tournament_matches_touch
  before update on public.tournament_matches
  for each row execute function public.tournament_touch();

-- An entrant matches its tournament's format: one player for 1v1, two
-- different players for Two-Headed Giant.
create or replace function public.tournament_entrant_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_format text;
begin
  select t.format into v_format from public.tournaments t where t.id = new.tournament_id;
  if v_format = '2hg' and new.player_two is null then
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

drop trigger if exists tournament_entrants_check on public.tournament_entrants;
create trigger tournament_entrants_check
  before insert or update on public.tournament_entrants
  for each row execute function public.tournament_entrant_check();

-- Pairs a round in one transaction, so two staff tapping "Pair next round"
-- at once can't both create it, and a round can't be paired around someone
-- who was just added or dropped.
--
--   p_round:    the round being written (current_round + 1, or current_round
--               when p_replace re-pairs a round that has no results yet).
--   p_pairings: [{ "a": uuid, "b": uuid | null }, …]; b null = a bye.
--               Every entrant still in must appear exactly once.
--
-- Errors: GGT01 bad input, GGT02 the tournament changed (refresh and retry),
-- GGT03 not found. A rematch fails tournament_matches_no_rematch_uidx (23505).
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

  -- Everyone still in, and nobody else, is in the round.
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

alter table public.tournaments enable row level security;
alter table public.tournament_entrants enable row level security;
alter table public.tournament_matches enable row level security;

drop policy if exists tournaments_staff_select on public.tournaments;
create policy tournaments_staff_select
  on public.tournaments for select to authenticated
  using ((select public.is_staff()));

drop policy if exists tournament_entrants_staff_select on public.tournament_entrants;
create policy tournament_entrants_staff_select
  on public.tournament_entrants for select to authenticated
  using ((select public.is_staff()));

drop policy if exists tournament_matches_staff_select on public.tournament_matches;
create policy tournament_matches_staff_select
  on public.tournament_matches for select to authenticated
  using ((select public.is_staff()));

revoke all on public.tournaments from anon, authenticated;
revoke all on public.tournament_entrants from anon, authenticated;
revoke all on public.tournament_matches from anon, authenticated;
grant select on public.tournaments to authenticated;
grant select on public.tournament_entrants to authenticated;
grant select on public.tournament_matches to authenticated;

revoke all on function public.tournament_touch() from public, anon, authenticated;
revoke all on function public.tournament_entrant_check() from public, anon, authenticated;
revoke all on function public.tournament_pair_round(uuid, integer, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.tournament_pair_round(uuid, integer, boolean, jsonb) to service_role;
