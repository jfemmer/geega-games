-- Tournaments: live life totals and game times.
--
-- Players track their life (or their team's, in Two-Headed Giant) on their
-- phones from the player display; the TV shows it as it changes. At 0 the
-- phone asks "Did you lose?" and, if so, records the game for the opponent.
--
--   • tournaments.starting_life: everyone's life at the start of a game
--     (Commander: 40; Two-Headed Giant Commander: 60 per team).
--   • tournament_matches.life_a / life_b: each side's life now (null =
--     still the starting life). Only while the game is being played.
--   • tournament_matches.ended_at: when the game's result was first
--     recorded. With created_at (when the round was paired) it gives the
--     game's run time. Cleared if the result is cleared.
--   • tournament_change_life(): adds to a side's life in one statement, so
--     teammates tapping at the same time both count.
--
-- Same lockdown: only the API (service_role) writes. Safe to run more than once.

alter table public.tournaments
  add column if not exists starting_life integer not null default 40 check (starting_life between 1 and 999);

-- Two-Headed Giant teams share a life total: 60 in Commander.
update public.tournaments set starting_life = 60 where format = '2hg' and starting_life = 40;

comment on column public.tournaments.starting_life is
  'Life at the start of each game (per player in 1v1, per team in Two-Headed Giant).';

alter table public.tournament_matches
  add column if not exists life_a integer check (life_a between -999 and 9999);
alter table public.tournament_matches
  add column if not exists life_b integer check (life_b between -999 and 9999);
alter table public.tournament_matches
  add column if not exists ended_at timestamptz;

-- Games already decided ended when their result was recorded.
update public.tournament_matches
  set ended_at = reported_at
  where ended_at is null and reported_at is not null;

comment on column public.tournament_matches.ended_at is
  'When the result was first recorded (run time = ended_at - created_at). Null while the game is being played.';

-- Adds p_delta to one side's life (a or b) while the game is being played.
-- Returns { life_a, life_b } with the starting life filled in.
-- Errors: GGT01 bad input, GGT02 the game is over / tournament finished, GGT03 not found.
create or replace function public.tournament_change_life(
  p_tournament_id uuid,
  p_match_id uuid,
  p_side text,
  p_delta integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_start integer;
  v_status text;
  v_row public.tournament_matches%rowtype;
begin
  if p_side is null or p_side not in ('a', 'b') then
    raise exception 'Pick a side.' using errcode = 'GGT01';
  end if;
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

  update public.tournament_matches m
    set life_a = case when p_side = 'a' then greatest(-999, least(9999, coalesce(m.life_a, v_start) + p_delta)) else m.life_a end,
        life_b = case when p_side = 'b' then greatest(-999, least(9999, coalesce(m.life_b, v_start) + p_delta)) else m.life_b end
    where m.id = p_match_id
      and m.tournament_id = p_tournament_id
      and m.result = 'pending'
      and m.entrant_b is not null
    returning * into v_row;
  if not found then
    raise exception 'This game is over.' using errcode = 'GGT02';
  end if;

  return jsonb_build_object('life_a', coalesce(v_row.life_a, v_start), 'life_b', coalesce(v_row.life_b, v_start));
end;
$$;

revoke all on function public.tournament_change_life(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.tournament_change_life(uuid, uuid, text, integer) to service_role;
