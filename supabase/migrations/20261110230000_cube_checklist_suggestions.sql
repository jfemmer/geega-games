-- Cube checklists: a suggestion list of cards to swap in, and CubeCobra draft
-- ratings for the cube's own cards, so the app can suggest upgrades: the
-- lowest-rated cards paired with cards from the suggestion list.
--
--   cube_checklist_suggestions   staff paste a list of card names (best
--                                first); each is looked up once in the local
--                                Scryfall data and stored with what pairing
--                                needs (type, colors, mana value, rarity).
--   cube_checklist_cards.elo     CubeCobra's draft rating for the card (how
--   .pick_count                  highly drafters pick it, across all cubes)
--   .mana_value                  and how many picks that rating rests on.
--   cube_checklists              when the ratings were last fetched.
--     .ratings_updated_at
--
-- Same lockdown as the other checklist tables: written only by the API with
-- the service_role key; staff may read via RLS. Safe to run more than once.

alter table public.cube_checklist_cards
  add column if not exists elo integer check (elo is null or elo between 0 and 10000),
  add column if not exists pick_count integer check (pick_count is null or pick_count >= 0),
  add column if not exists mana_value numeric(4, 1) check (mana_value is null or mana_value >= 0);

alter table public.cube_checklists
  add column if not exists ratings_updated_at timestamptz;

comment on column public.cube_checklist_cards.elo is
  'CubeCobra draft rating (Elo from picks across all CubeCobra drafts). Null for cards swapped in, or not rated yet.';
comment on column public.cube_checklist_cards.pick_count is
  'How many CubeCobra picks the rating rests on. Ratings with few picks are not used to call a card weak.';

create table if not exists public.cube_checklist_suggestions (
  checklist_id uuid not null references public.cube_checklists (id) on delete cascade,
  -- Order in the pasted list: lower is better (it is the priority).
  position integer not null check (position >= 0),
  -- As typed by staff.
  name text not null check (char_length(name) between 1 and 200),
  -- From the local Scryfall data; card_name is null when no card matched.
  card_name text check (card_name is null or char_length(card_name) <= 200),
  type_line text check (type_line is null or char_length(type_line) <= 300),
  colors text[] not null default '{}',
  mana_value numeric(4, 1),
  mana_cost text check (mana_cost is null or char_length(mana_cost) <= 100),
  image_small text check (image_small is null or char_length(image_small) <= 500),
  image_normal text check (image_normal is null or char_length(image_normal) <= 500),
  edhrec_rank integer,
  -- Printed at common (or at common or uncommon) in paper, for the swap rarity rule.
  paper_common boolean not null default false,
  paper_uncommon boolean not null default false,
  primary key (checklist_id, position)
);

comment on table public.cube_checklist_suggestions is
  'Cards staff want suggested as swaps for a cube checklist, best first. Written only by /api/admin/cube-checklists (service_role); staff read-only via RLS.';

alter table public.cube_checklist_suggestions enable row level security;

drop policy if exists cube_checklist_suggestions_staff_select on public.cube_checklist_suggestions;
create policy cube_checklist_suggestions_staff_select
  on public.cube_checklist_suggestions for select to authenticated
  using ((select public.is_staff()));

revoke all on public.cube_checklist_suggestions from anon, authenticated;
grant select on public.cube_checklist_suggestions to authenticated;

-- Front-face name lookups in the local Scryfall data (a list of ~200 names
-- took ~5s as a sequential scan). Matches cardKey() / the checklist's own
-- one-of-each index: lower(btrim(split_part(name, '//', 1))).
create index if not exists scryfall_bulk_cards_front_name_idx
  on public.scryfall_bulk_cards (lower(btrim(split_part(card_name, '//', 1))));

-- Look up card names (front face, case-insensitive) in the local Scryfall
-- data: one row per distinct requested name, with what the checklist needs.
-- The details come from a paper common printing when there is one.
create or replace function public.cube_checklist_lookup_cards(p_names text[])
returns table (
  requested text,
  card_name text,
  type_line text,
  colors text[],
  mana_value numeric,
  mana_cost text,
  image_small text,
  image_normal text,
  edhrec_rank integer,
  paper_common boolean,
  paper_uncommon boolean
)
language sql
stable
set search_path to 'public'
as $$
  with req as (
    -- One row per card (the first way it was typed).
    select distinct on (x.k) x.n as requested, x.k
    from (
      select u.n, lower(btrim(split_part(u.n, '//', 1))) as k, u.ord
      from unnest(p_names) with ordinality as u(n, ord)
      where btrim(coalesce(u.n, '')) <> ''
    ) x
    order by x.k, x.ord
  ),
  hits as (
    select r.requested, b.card_name, b.rarity, b.released_at, b.raw,
           coalesce((b.raw -> 'games') ? 'paper', false) as in_paper
    from req r
    join public.scryfall_bulk_cards b
      on lower(btrim(split_part(b.card_name, '//', 1))) = r.k
  ),
  agg as (
    select h.requested,
           bool_or(h.in_paper and h.rarity = 'common') as pc,
           bool_or(h.in_paper and h.rarity in ('common', 'uncommon')) as pcu
    from hits h
    group by h.requested
  ),
  best as (
    select distinct on (h.requested) h.*
    from hits h
    order by h.requested, (h.in_paper and h.rarity = 'common') desc, h.in_paper desc, h.released_at desc nulls last
  )
  select
    r.requested,
    b.card_name,
    coalesce(b.raw ->> 'type_line', b.raw -> 'card_faces' -> 0 ->> 'type_line'),
    coalesce(
      array(select jsonb_array_elements_text(coalesce(b.raw -> 'colors', b.raw -> 'card_faces' -> 0 -> 'colors', '[]'::jsonb))),
      '{}'::text[]
    ),
    nullif(b.raw ->> 'cmc', '')::numeric,
    coalesce(b.raw ->> 'mana_cost', b.raw -> 'card_faces' -> 0 ->> 'mana_cost'),
    coalesce(b.raw -> 'image_uris' ->> 'small', b.raw -> 'card_faces' -> 0 -> 'image_uris' ->> 'small'),
    coalesce(b.raw -> 'image_uris' ->> 'normal', b.raw -> 'card_faces' -> 0 -> 'image_uris' ->> 'normal'),
    nullif(b.raw ->> 'edhrec_rank', '')::integer,
    coalesce(a.pc, false),
    coalesce(a.pcu, false)
  from req r
  left join best b on b.requested = r.requested
  left join agg a on a.requested = r.requested;
$$;

-- Store CubeCobra ratings for a checklist's cards in one statement.
-- p_ratings: [{ "key": lower(front face), "elo": int, "pick_count": int, "mana_value": numeric }]
-- Only rows whose values change are written (each write bumps updated_at,
-- which makes everyone's page refresh that card).
create or replace function public.cube_checklist_set_ratings(p_checklist_id uuid, p_ratings jsonb)
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  n integer;
begin
  update public.cube_checklist_cards c
     set elo = r.elo,
         pick_count = r.pick_count,
         mana_value = coalesce(r.mana_value, c.mana_value)
    from jsonb_to_recordset(coalesce(p_ratings, '[]'::jsonb))
         as r(key text, elo integer, pick_count integer, mana_value numeric)
   where c.checklist_id = p_checklist_id
     and lower(btrim(split_part(c.name, '//', 1))) = r.key
     and (c.elo is distinct from r.elo
          or c.pick_count is distinct from r.pick_count
          or (r.mana_value is not null and c.mana_value is distinct from r.mana_value));
  get diagnostics n = row_count;
  update public.cube_checklists set ratings_updated_at = now() where id = p_checklist_id;
  return n;
end;
$$;

revoke all on function public.cube_checklist_lookup_cards(text[]) from public, anon, authenticated;
revoke all on function public.cube_checklist_set_ratings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cube_checklist_lookup_cards(text[]) to service_role;
grant execute on function public.cube_checklist_set_ratings(uuid, jsonb) to service_role;
