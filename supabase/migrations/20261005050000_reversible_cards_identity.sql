-- Reversible cards: give them their oracle id, one name and one type line.
--
-- Scryfall's "reversible_card" layout is ONE card printed on both sides (two
-- arts of the same borderless land, for example). Scryfall describes such a
-- printing only through its two faces: the card object has no top-level
-- oracle_id or type_line, and its name is doubled — "Steam Vents // Steam
-- Vents".
--
-- The code that stores cards read the top-level fields, so these printings
-- were saved with oracle_id = NULL, the doubled name and a doubled type line.
-- Without an oracle id public.get_card_detail finds no card, so their pages
-- said "Card not found" (three in-stock cards, 2026-10-05), and wishlist,
-- deck and stock-alert matching — all keyed on oracle id — couldn't see them.
--
-- The code is fixed in src/admin/services/scryfall.ts (scryfallOracleId,
-- scryfallCardName, scryfallTypeLine), which every path that stores a card
-- now goes through. This repairs the rows already saved. It is safe to run
-- again: it only touches rows that still have the problem.

-- 1. The Scryfall mirror. scripts/refreshScryfallBulkIndex.ts fills this in
--    from now on; these are the reversible printings loaded before the fix.
--    (card_name is left as Scryfall's own: this table mirrors Scryfall.)
update public.scryfall_bulk_cards sc
set oracle_id = (
  select (face ->> 'oracle_id')::uuid
  from jsonb_array_elements(sc.raw -> 'card_faces') with ordinality as faces(face, position)
  where face ->> 'oracle_id' is not null
  order by position
  limit 1
)
where sc.oracle_id is null
  and sc.layout = 'reversible_card'
  and jsonb_typeof(sc.raw -> 'card_faces') = 'array';

-- 2. Inventory lines and cached printings of those cards.
--    * oracle id: filled in where it's missing.
--    * name: "X // X" becomes "X" — only when every face has that one name.
--      A reversible card whose sides are named differently keeps its name.
--    * type line: the same, for "T // T".
--    inventory_movements keeps the name each movement was recorded under.
with reversible as (
  select
    sc.scryfall_id,
    sc.oracle_id,
    sc.raw -> 'card_faces' -> 0 ->> 'name' as face_name,
    sc.raw -> 'card_faces' -> 0 ->> 'type_line' as face_type,
    (select count(distinct face ->> 'name') from jsonb_array_elements(sc.raw -> 'card_faces') as face) = 1 as one_name,
    (select count(distinct face ->> 'type_line') from jsonb_array_elements(sc.raw -> 'card_faces') as face) = 1 as one_type
  from public.scryfall_bulk_cards sc
  where sc.layout = 'reversible_card'
    and jsonb_typeof(sc.raw -> 'card_faces') = 'array'
),
inventory as (
  update public.inventory_items i
  set oracle_id = coalesce(i.oracle_id, r.oracle_id),
      card_name = case
        when r.one_name and i.card_name = r.face_name || ' // ' || r.face_name then r.face_name
        else i.card_name
      end,
      type_line = case
        when r.one_type and i.type_line = r.face_type || ' // ' || r.face_type then r.face_type
        else i.type_line
      end
  from reversible r
  where i.scryfall_id = r.scryfall_id
    and (
      (i.oracle_id is null and r.oracle_id is not null)
      or (r.one_name and i.card_name = r.face_name || ' // ' || r.face_name)
      or (r.one_type and i.type_line = r.face_type || ' // ' || r.face_type)
    )
  returning i.id
),
printings as (
  update public.card_printings p
  set oracle_id = coalesce(p.oracle_id, r.oracle_id),
      card_name = case
        when r.one_name and p.card_name = r.face_name || ' // ' || r.face_name then r.face_name
        else p.card_name
      end,
      card_type = case
        when r.one_type and p.card_type = r.face_type || ' // ' || r.face_type then r.face_type
        else p.card_type
      end
  from reversible r
  where p.scryfall_id = r.scryfall_id
    and (
      (p.oracle_id is null and r.oracle_id is not null)
      or (r.one_name and p.card_name = r.face_name || ' // ' || r.face_name)
      or (r.one_type and p.card_type = r.face_type || ' // ' || r.face_type)
    )
  returning p.scryfall_id
)
select (select count(*) from inventory) as inventory_lines_repaired,
       (select count(*) from printings) as cached_printings_repaired;
