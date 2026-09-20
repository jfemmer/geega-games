-- Deck-list card thumbnails were picking the most-recently-released English
-- printing of each card, which for popular reprinted staples is very often a
-- Secret Lair / showcase / borderless / promo treatment rather than the
-- plain, widely-recognized art most players expect in a decklist. Re-rank
-- candidate printings to prefer a "standard" one first (not promo, not
-- full-art/textless, not borderless, not a showcase/extended-art/etched
-- treatment, and not from a non-mainstream product line like Secret Lair,
-- Masterpieces, Un-sets, or memorabilia), falling back to the most recent
-- printing overall only when no standard printing exists at all for that
-- card. Also drops the old "prefer the exact recorded scryfall_id" tiebreak,
-- since standard-ness should win even if a specific (possibly special)
-- printing was recorded against the deck card.
create or replace function public.deck_card_images(p_deck_id uuid)
returns table(deck_card_id uuid, image_url text)
language sql
stable
set search_path to 'public'
as $function$
  select dc.id,
    coalesce(b.raw->'image_uris'->>'normal', b.raw->'card_faces'->0->'image_uris'->>'normal')
  from public.customer_deck_cards dc
  join public.customer_decks d on d.id=dc.deck_id and d.user_id=auth.uid()
  left join lateral (
    select sb.raw
    from public.scryfall_bulk_cards sb
    where sb.oracle_id=dc.oracle_id and sb.lang='en'
    order by
      (
        coalesce(sb.promo, false) = false
        and coalesce(sb.full_art, false) = false
        and coalesce(sb.textless, false) = false
        and coalesce(sb.variation, false) = false
        and coalesce(sb.border_color, 'black') = 'black'
        and not (coalesce(sb.frame_effects, '{}'::text[]) && array['showcase','extendedart','etched']::text[])
        and coalesce(sb.raw->>'set_type', '') not in
          ('promo','masterpiece','box','funny','memorabilia','minigame','exhibit','alchemy')
      ) desc,
      sb.released_at desc nulls last
    limit 1
  ) b on true
  where dc.deck_id=p_deck_id
  order by dc.card_name;
$function$;
