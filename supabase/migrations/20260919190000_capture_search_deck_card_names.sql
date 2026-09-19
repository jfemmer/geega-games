-- Capture public.search_deck_card_names into version control.
--
-- This function was already live in production (created directly, outside
-- the migration pipeline — confirmed via pg_proc), so the deck card-name
-- autocomplete has been working correctly at the database layer all along.
-- But since no migration file defined it, a fresh environment, branch, or
-- disaster-recovery restore would silently NOT have it: the RPC call from
-- MyDecksPage.tsx would then fail (function not found) with no visible
-- error, since the caller swallows RPC errors into an empty suggestion
-- list. Capturing the existing definition here closes that gap.
--
-- Definition matches what was already running live (confirmed via
-- pg_get_functiondef); this is a no-op against the current database and
-- only makes the state reproducible going forward.

create or replace function public.search_deck_card_names(p_query text, p_limit integer default 8)
returns table(card_name text, image_url text, type_line text)
language sql stable security invoker set search_path = public
as $$
  select c.card_name, c.image_url, c.type_line
  from public.card_recommendation_catalog c
  where length(trim(p_query)) >= 2
    and lower(c.card_name) like '%' || lower(trim(p_query)) || '%'
  order by
    case when lower(c.card_name) = lower(trim(p_query)) then 0
         when lower(c.card_name) like lower(trim(p_query)) || '%' then 1
         else 2 end,
    position(lower(trim(p_query)) in lower(c.card_name)),
    coalesce(c.edhrec_rank, 2147483647),
    length(c.card_name),
    c.card_name
  limit greatest(1, least(coalesce(p_limit, 8), 12));
$$;

-- The live grants included anon/PUBLIC; card_recommendation_catalog's RLS
-- already restricts actual row access to `authenticated` (`using (true)`
-- for that role only), so this was not an exposure — but every sibling
-- deck function in this file grants only to authenticated, so match that
-- for consistency and least-privilege going forward.
revoke all on function public.search_deck_card_names(text, integer) from public, anon;
grant execute on function public.search_deck_card_names(text, integer) to authenticated;

-- card_recommendation_catalog had no index at all on card_name — every
-- autocomplete keystroke was a sequential scan. Fine at 32k rows today, but
-- add the same trigram index already used for scryfall_bulk_cards so it
-- stays fast (and supports ILIKE/substring search well) as the catalog
-- grows.
create index if not exists card_rec_name_trgm_idx
  on public.card_recommendation_catalog using gin (card_name gin_trgm_ops);
