-- Tournaments: ready-up between rounds, every way to lose, and poison and
-- commander damage tracked on players' phones.
--
--   • tournament_entrants.ready_for: the round a player (or team) is ready
--     to start. When everyone still in is ready for the next round, the API
--     pairs (or deals) it. Nothing to reset: the next round makes it stale.
--   • tournament_matches.loss_reason / tournament_pod_players.out_reason:
--     how the game was lost (life, commander damage, poison, decked, an
--     opponent's alternate win, a card that says you lose, or conceding).
--     Null when staff recorded the result.
--   • tournament_counters: poison counters and commander damage for a side
--     of a match or a player at a free-for-all table, by round (commander
--     damage per source: one opposing commander, partners counted apart).
--   • tournament_change_counter(): adds to one counter in one statement.
--   • tournament_pod_knock_out() and tournament_pod_set_winner() take how
--     the game was lost; tournament_pod_undo() clears it.
--
-- Same lockdown: staff read via RLS; only the API (service_role) writes.
-- Safe to run more than once.

alter table public.tournament_entrants
  add column if not exists ready_for integer check (ready_for between 1 and 501);
comment on column public.tournament_entrants.ready_for is
  'The round this player (or team) is ready to start; stale once that round is paired.';

alter table public.tournament_matches
  add column if not exists loss_reason text
  check (loss_reason in ('life', 'commander', 'poison', 'decked', 'alt_win', 'card', 'concede'));
comment on column public.tournament_matches.loss_reason is
  'How the losing side lost, when a player recorded it. Null for staff results, draws and byes.';

alter table public.tournament_pod_players
  add column if not exists out_reason text
  check (out_reason in ('life', 'commander', 'poison', 'decked', 'alt_win', 'card', 'concede'));
comment on column public.tournament_pod_players.out_reason is
  'How this player went out of a free-for-all game, when recorded. Null for staff calls.';

create table if not exists public.tournament_counters (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round integer not null check (round between 1 and 500),
  -- A side of a match (1v1, Two-Headed Giant)…
  match_id uuid references public.tournament_matches (id) on delete cascade,
  side text check (side in ('a', 'b')),
  -- …or a player at a free-for-all table.
  pod_player_id uuid references public.tournament_pod_players (id) on delete cascade,
  kind text not null check (kind in ('poison', 'commander')),
  -- Commander damage: which commander dealt it ("<entrant id>:<seat>:<partner>"). Poison: empty.
  source text not null default '' check (char_length(source) <= 120),
  value integer not null default 0 check (value between 0 and 999),
  updated_at timestamptz not null default now(),
  target text generated always as (coalesce(match_id::text || ':' || side, pod_player_id::text)) stored,
  check ((match_id is not null and side is not null and pod_player_id is null)
      or (match_id is null and side is null and pod_player_id is not null)),
  check ((kind = 'poison') = (source = '')),
  unique (target, kind, source)
);

comment on table public.tournament_counters is
  'Poison counters and commander damage tracked on players'' phones. Written only by tournament_change_counter().';

create index if not exists tournament_counters_round_idx on public.tournament_counters (tournament_id, round);

drop trigger if exists tournament_counters_touch on public.tournament_counters;
create trigger tournament_counters_touch
  before update on public.tournament_counters
  for each row execute function public.tournament_touch();

-- Adds p_delta to a counter (0–999) while that game is being played: a side
-- of a match (p_match_id + p_side) or a free-for-all seat (p_pod_player_id).
-- Returns the new value.
create or replace function public.tournament_change_counter(
  p_tournament_id uuid,
  p_match_id uuid,
  p_side text,
  p_pod_player_id uuid,
  p_kind text,
  p_source text,
  p_delta integer
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_round integer;
  v_source text := coalesce(p_source, '');
  v_value integer;
begin
  if p_delta is null or p_delta = 0 or abs(p_delta) > 999 then
    raise exception 'That change doesn''t look right.' using errcode = 'GGT01';
  end if;
  if p_kind is null or p_kind not in ('poison', 'commander') then
    raise exception 'Pick poison or commander damage.' using errcode = 'GGT01';
  end if;
  if (p_kind = 'poison') <> (v_source = '') or char_length(v_source) > 120 then
    raise exception 'Pick which commander dealt the damage.' using errcode = 'GGT01';
  end if;
  select t.status into v_status from public.tournaments t where t.id = p_tournament_id;
  if not found then
    raise exception 'That tournament no longer exists.' using errcode = 'GGT03';
  end if;
  if v_status <> 'active' then
    raise exception 'This tournament is finished.' using errcode = 'GGT02';
  end if;

  if p_match_id is not null then
    if p_pod_player_id is not null or p_side is null or p_side not in ('a', 'b') then
      raise exception 'Pick a side.' using errcode = 'GGT01';
    end if;
    select m.round into v_round from public.tournament_matches m
      where m.id = p_match_id and m.tournament_id = p_tournament_id and m.result = 'pending' and m.entrant_b is not null;
  elsif p_pod_player_id is not null then
    if p_side is not null then
      raise exception 'Pick a player.' using errcode = 'GGT01';
    end if;
    select p.round into v_round
      from public.tournament_pod_players pp
      join public.tournament_pods p on p.id = pp.pod_id
      where pp.id = p_pod_player_id and pp.tournament_id = p_tournament_id and pp.out_at is null and p.ended_at is null;
  else
    raise exception 'Pick a game.' using errcode = 'GGT01';
  end if;
  if v_round is null then
    raise exception 'This game is over for you.' using errcode = 'GGT02';
  end if;

  insert into public.tournament_counters (tournament_id, round, match_id, side, pod_player_id, kind, source, value)
  values (p_tournament_id, v_round, p_match_id, p_side, p_pod_player_id, p_kind, v_source, greatest(0, least(999, p_delta)))
  on conflict (target, kind, source)
    do update set value = greatest(0, least(999, public.tournament_counters.value + p_delta))
  returning value into v_value;
  return v_value;
end;
$$;

-- Knock-out and calling a winner now say how the game was lost. The old
-- two- and three-argument versions go, so calls without a reason still
-- resolve to these (the reason defaults to null).
drop function if exists public.tournament_pod_knock_out(uuid, uuid);
drop function if exists public.tournament_pod_set_winner(uuid, uuid, uuid);

create or replace function public.tournament_pod_knock_out(p_tournament_id uuid, p_pod_player_id uuid, p_reason text default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_player public.tournament_pod_players%rowtype;
  v_pod public.tournament_pods%rowtype;
  v_left integer;
begin
  if p_reason is not null and p_reason not in ('life', 'commander', 'poison', 'decked', 'alt_win', 'card', 'concede') then
    raise exception 'Pick how the game was lost.' using errcode = 'GGT01';
  end if;
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
  update public.tournament_pod_players set out_at = now(), place = v_left, out_reason = p_reason where id = v_player.id;
  if v_left - 1 <= 1 then
    update public.tournament_pod_players set place = 1 where pod_id = v_pod.id and out_at is null;
    update public.tournament_pods set ended_at = now() where id = v_pod.id;
  end if;
  return jsonb_build_object('place', v_left, 'ended', v_left - 1 <= 1);
end;
$$;

-- Ends a game: p_entrant_id wins and everyone else still in shares 2nd
-- (staff calling time, or a player's alternate win: p_reason 'alt_win').
create or replace function public.tournament_pod_set_winner(
  p_tournament_id uuid,
  p_pod_id uuid,
  p_entrant_id uuid,
  p_reason text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_pod public.tournament_pods%rowtype;
begin
  if p_reason is not null and p_reason not in ('life', 'commander', 'poison', 'decked', 'alt_win', 'card', 'concede') then
    raise exception 'Pick how the game was lost.' using errcode = 'GGT01';
  end if;
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
    set out_at = now(), place = 2, out_reason = p_reason
    where pod_id = p_pod_id and out_at is null and entrant_id <> p_entrant_id;
  update public.tournament_pod_players set place = 1 where pod_id = p_pod_id and entrant_id = p_entrant_id;
  update public.tournament_pods set ended_at = now() where id = p_pod_id;
end;
$$;

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
  update public.tournament_pod_players set out_at = null, place = null, out_reason = null
    where pod_id = p_pod_id and out_at = v_last;
  update public.tournament_pod_players set place = null where pod_id = p_pod_id and out_at is null;
  update public.tournament_pods set ended_at = null where id = p_pod_id;
end;
$$;

alter table public.tournament_counters enable row level security;
drop policy if exists tournament_counters_staff_select on public.tournament_counters;
create policy tournament_counters_staff_select
  on public.tournament_counters for select to authenticated
  using ((select public.is_staff()));

revoke all on public.tournament_counters from anon, authenticated;
grant select on public.tournament_counters to authenticated;

revoke all on function public.tournament_change_counter(uuid, uuid, text, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.tournament_pod_knock_out(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.tournament_pod_set_winner(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.tournament_pod_undo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tournament_change_counter(uuid, uuid, text, uuid, text, text, integer) to service_role;
grant execute on function public.tournament_pod_knock_out(uuid, uuid, text) to service_role;
grant execute on function public.tournament_pod_set_winner(uuid, uuid, uuid, text) to service_role;
grant execute on function public.tournament_pod_undo(uuid, uuid) to service_role;
