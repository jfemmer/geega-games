-- Tournaments: free-for-all (big casual Commander games).
--
-- Format 'ffa': each round, players are dealt at random onto tables of up to
-- table_size players (8 per table = everyone in one game). Players track
-- their life on their phones; when one is out ("Did you lose?") they get the
-- next finishing place from the bottom, and the last one left wins. Points
-- by finishing place are worked out from these rows
-- (src/admin/utils/tournament.ts).
--
--   • tournaments.table_size: players per table (free-for-all only).
--   • tournament_pods: one table's game in a round (ended_at when decided).
--   • tournament_pod_players: who sat there, their life, when they went out
--     and their finishing place (1 = won).
--   • tournament_deal_pods(): writes a round's tables in one transaction.
--   • tournament_pod_change_life(), tournament_pod_knock_out(),
--     tournament_pod_set_winner(), tournament_pod_undo(): the game itself.
--
-- Same lockdown: staff read via RLS; only the API (service_role) writes.
-- Safe to run more than once.

alter table public.tournaments drop constraint if exists tournaments_format_check;
alter table public.tournaments
  add constraint tournaments_format_check check (format in ('1v1', '2hg', 'ffa'));

alter table public.tournaments
  add column if not exists table_size integer check (table_size between 3 and 12);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_table_size_format_check') then
    alter table public.tournaments add constraint tournaments_table_size_format_check
      check ((format = 'ffa') = (table_size is not null));
  end if;
end;
$$;

comment on column public.tournaments.table_size is
  'Free-for-all: most players per table (8 = everyone in one game when 8 play). Null for 1v1 and Two-Headed Giant.';

-- Entrants: one player each in free-for-all, as in 1v1.
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
  if v_format in ('1v1', 'ffa') and new.player_two is not null then
    raise exception 'Each entrant is one player in this format.' using errcode = 'GGT01';
  end if;
  if new.player_two is not null and lower(new.player_one) = lower(new.player_two) then
    raise exception 'A team needs two different players.' using errcode = 'GGT01';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.tournament_pods (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round integer not null check (round between 1 and 500),
  table_number integer not null check (table_number between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- When the game was decided (the last player standing, or staff picked the winner).
  ended_at timestamptz,
  unique (tournament_id, round, table_number),
  unique (id, tournament_id)
);

comment on table public.tournament_pods is
  'A free-for-all table''s game in one round. Written only by the tournament_deal_pods() family of functions.';

create table if not exists public.tournament_pod_players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null,
  pod_id uuid not null,
  entrant_id uuid not null,
  seat integer not null check (seat between 1 and 20),
  -- Life now (null = the tournament's starting life).
  life integer check (life between -999 and 9999),
  -- Out of the game, and where they finished (1 = won; the first out finishes last).
  out_at timestamptz,
  place integer check (place between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (pod_id, tournament_id) references public.tournament_pods (id, tournament_id) on delete cascade,
  foreign key (entrant_id, tournament_id) references public.tournament_entrants (id, tournament_id) on delete cascade,
  unique (pod_id, entrant_id),
  unique (pod_id, seat),
  check (out_at is null or place is not null)
);

comment on table public.tournament_pod_players is
  'A player at a free-for-all table: life, when they went out, and their finishing place.';

create index if not exists tournament_pods_tournament_idx on public.tournament_pods (tournament_id, round);
create index if not exists tournament_pod_players_tournament_idx on public.tournament_pod_players (tournament_id);
create index if not exists tournament_pod_players_entrant_idx on public.tournament_pod_players (entrant_id);

drop trigger if exists tournament_pods_touch on public.tournament_pods;
create trigger tournament_pods_touch
  before update on public.tournament_pods
  for each row execute function public.tournament_touch();

drop trigger if exists tournament_pod_players_touch on public.tournament_pod_players;
create trigger tournament_pod_players_touch
  before update on public.tournament_pod_players
  for each row execute function public.tournament_touch();

-- Deals a round: p_pods is [[entrant id, …], …], one list per table, seats in
-- order. Everyone still in, exactly once. p_replace re-deals the current
-- round while nobody is out yet; otherwise it's the next round, once every
-- game in the current one is decided.
create or replace function public.tournament_deal_pods(
  p_tournament_id uuid,
  p_round integer,
  p_replace boolean,
  p_pods jsonb
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_pod jsonb;
  v_entrant jsonb;
  v_id uuid;
  v_pod_id uuid;
  v_seen uuid[] := '{}';
  v_table integer := 0;
  v_seat integer;
  v_active integer;
begin
  select * into v_tournament from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'That tournament no longer exists.' using errcode = 'GGT03';
  end if;
  if v_tournament.format <> 'ffa' then
    raise exception 'Tables are for free-for-all tournaments.' using errcode = 'GGT01';
  end if;
  if v_tournament.status <> 'active' then
    raise exception 'This tournament is finished. Reopen it to play another round.' using errcode = 'GGT02';
  end if;
  if p_pods is null or jsonb_typeof(p_pods) <> 'array' or jsonb_array_length(p_pods) = 0 then
    raise exception 'There''s nobody to seat.' using errcode = 'GGT01';
  end if;

  if coalesce(p_replace, false) then
    if p_round < 1 or v_tournament.current_round <> p_round then
      raise exception 'The rounds changed while you were working. Refresh and try again.' using errcode = 'GGT02';
    end if;
    if exists (
      select 1 from public.tournament_pod_players pp
      join public.tournament_pods p on p.id = pp.pod_id
      where p.tournament_id = p_tournament_id and p.round = p_round and (pp.out_at is not null or p.ended_at is not null)
    ) then
      raise exception 'Someone is already out in round %, so it can''t be re-dealt.', p_round using errcode = 'GGT02';
    end if;
    delete from public.tournament_pods p where p.tournament_id = p_tournament_id and p.round = p_round;
  else
    if v_tournament.current_round <> p_round - 1 then
      raise exception 'Round % is already dealt. Refresh to see it.', p_round using errcode = 'GGT02';
    end if;
    if exists (
      select 1 from public.tournament_pods p
      where p.tournament_id = p_tournament_id and p.round = v_tournament.current_round and p.ended_at is null
    ) then
      raise exception 'Finish every game in round % before dealing the next one.', v_tournament.current_round
        using errcode = 'GGT02';
    end if;
  end if;

  for v_pod in select value from jsonb_array_elements(p_pods) loop
    if jsonb_typeof(v_pod) <> 'array' or jsonb_array_length(v_pod) < 2 then
      raise exception 'Every table needs at least two players.' using errcode = 'GGT01';
    end if;
    v_table := v_table + 1;
    insert into public.tournament_pods (tournament_id, round, table_number)
    values (p_tournament_id, p_round, v_table)
    returning id into v_pod_id;
    v_seat := 0;
    for v_entrant in select value from jsonb_array_elements(v_pod) loop
      v_id := nullif(v_entrant #>> '{}', '')::uuid;
      if v_id is null or v_id = any (v_seen) then
        raise exception 'Someone was seated twice in one round.' using errcode = 'GGT01';
      end if;
      v_seen := v_seen || v_id;
      v_seat := v_seat + 1;
      insert into public.tournament_pod_players (tournament_id, pod_id, entrant_id, seat)
      values (p_tournament_id, v_pod_id, v_id, v_seat);
    end loop;
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

-- Adds p_delta to a player's life while they're still in a game being played.
create or replace function public.tournament_pod_change_life(
  p_tournament_id uuid,
  p_pod_player_id uuid,
  p_delta integer
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_start integer;
  v_status text;
  v_life integer;
begin
  if p_delta is null or p_delta = 0 or abs(p_delta) > 999 then
    raise exception 'That life change doesn''t look right.' using errcode = 'GGT01';
  end if;
  select t.starting_life, t.status into v_start, v_status from public.tournaments t where t.id = p_tournament_id;
  if not found then
    raise exception 'That tournament no longer exists.' using errcode = 'GGT03';
  end if;
  if v_status <> 'active' then
    raise exception 'This tournament is finished.' using errcode = 'GGT02';
  end if;
  update public.tournament_pod_players pp
    set life = greatest(-999, least(9999, coalesce(pp.life, v_start) + p_delta))
    from public.tournament_pods p
    where pp.id = p_pod_player_id
      and pp.tournament_id = p_tournament_id
      and p.id = pp.pod_id
      and p.ended_at is null
      and pp.out_at is null
    returning pp.life into v_life;
  if not found then
    raise exception 'This game is over for you.' using errcode = 'GGT02';
  end if;
  return v_life;
end;
$$;

-- A player is out: they finish in the highest place still open (8th of 8 for
-- the first one out). When one player is left, they win and the game ends.
-- Returns { place, ended }.
create or replace function public.tournament_pod_knock_out(p_tournament_id uuid, p_pod_player_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_player public.tournament_pod_players%rowtype;
  v_pod public.tournament_pods%rowtype;
  v_left integer;
begin
  select * into v_player from public.tournament_pod_players
    where id = p_pod_player_id and tournament_id = p_tournament_id;
  if not found then
    raise exception 'That player isn''t at a table anymore. Refresh and try again.' using errcode = 'GGT03';
  end if;
  select * into v_pod from public.tournament_pods where id = v_player.pod_id for update;
  if v_pod.ended_at is not null then
    raise exception 'This game is over.' using errcode = 'GGT02';
  end if;
  -- Re-read under the table's lock: two phones can't both take the same place.
  select * into v_player from public.tournament_pod_players where id = p_pod_player_id;
  if v_player.out_at is not null then
    raise exception 'That player is already out.' using errcode = 'GGT02';
  end if;

  select count(*) into v_left from public.tournament_pod_players where pod_id = v_pod.id and out_at is null;
  update public.tournament_pod_players set out_at = now(), place = v_left where id = v_player.id;
  if v_left - 1 <= 1 then
    update public.tournament_pod_players set place = 1 where pod_id = v_pod.id and out_at is null;
    update public.tournament_pods set ended_at = now() where id = v_pod.id;
  end if;
  return jsonb_build_object('place', v_left, 'ended', v_left - 1 <= 1);
end;
$$;

-- Staff end a game: p_entrant_id wins; everyone else still in shares 2nd.
create or replace function public.tournament_pod_set_winner(p_tournament_id uuid, p_pod_id uuid, p_entrant_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_pod public.tournament_pods%rowtype;
begin
  select * into v_pod from public.tournament_pods where id = p_pod_id and tournament_id = p_tournament_id for update;
  if not found then
    raise exception 'That table isn''t there anymore. Refresh and try again.' using errcode = 'GGT03';
  end if;
  if v_pod.ended_at is not null then
    raise exception 'This game is already over. Undo it first to change the winner.' using errcode = 'GGT02';
  end if;
  if not exists (
    select 1 from public.tournament_pod_players
    where pod_id = p_pod_id and entrant_id = p_entrant_id and out_at is null
  ) then
    raise exception 'The winner has to be someone still in the game.' using errcode = 'GGT01';
  end if;
  update public.tournament_pod_players
    set out_at = now(), place = 2
    where pod_id = p_pod_id and out_at is null and entrant_id <> p_entrant_id;
  update public.tournament_pod_players set place = 1 where pod_id = p_pod_id and entrant_id = p_entrant_id;
  update public.tournament_pods set ended_at = now() where id = p_pod_id;
end;
$$;

-- Staff undo the last thing that happened at a table: whoever went out last
-- (or everyone who went out together when staff picked a winner) is back in,
-- and a decided game is open again.
create or replace function public.tournament_pod_undo(p_tournament_id uuid, p_pod_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_pod public.tournament_pods%rowtype;
  v_last timestamptz;
begin
  select * into v_pod from public.tournament_pods where id = p_pod_id and tournament_id = p_tournament_id for update;
  if not found then
    raise exception 'That table isn''t there anymore. Refresh and try again.' using errcode = 'GGT03';
  end if;
  select max(out_at) into v_last from public.tournament_pod_players where pod_id = p_pod_id;
  if v_last is null then
    raise exception 'Nobody is out at this table yet.' using errcode = 'GGT02';
  end if;
  update public.tournament_pod_players set out_at = null, place = null where pod_id = p_pod_id and out_at = v_last;
  update public.tournament_pod_players set place = null where pod_id = p_pod_id and out_at is null;
  update public.tournament_pods set ended_at = null where id = p_pod_id;
end;
$$;

alter table public.tournament_pods enable row level security;
alter table public.tournament_pod_players enable row level security;

drop policy if exists tournament_pods_staff_select on public.tournament_pods;
create policy tournament_pods_staff_select
  on public.tournament_pods for select to authenticated
  using ((select public.is_staff()));

drop policy if exists tournament_pod_players_staff_select on public.tournament_pod_players;
create policy tournament_pod_players_staff_select
  on public.tournament_pod_players for select to authenticated
  using ((select public.is_staff()));

revoke all on public.tournament_pods from anon, authenticated;
revoke all on public.tournament_pod_players from anon, authenticated;
grant select on public.tournament_pods to authenticated;
grant select on public.tournament_pod_players to authenticated;

revoke all on function public.tournament_entrant_check() from public, anon, authenticated;
revoke all on function public.tournament_deal_pods(uuid, integer, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.tournament_pod_change_life(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.tournament_pod_knock_out(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tournament_pod_set_winner(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.tournament_pod_undo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tournament_deal_pods(uuid, integer, boolean, jsonb) to service_role;
grant execute on function public.tournament_pod_change_life(uuid, uuid, integer) to service_role;
grant execute on function public.tournament_pod_knock_out(uuid, uuid) to service_role;
grant execute on function public.tournament_pod_set_winner(uuid, uuid, uuid) to service_role;
grant execute on function public.tournament_pod_undo(uuid, uuid) to service_role;
