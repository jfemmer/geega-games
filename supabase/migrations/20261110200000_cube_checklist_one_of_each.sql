-- Cube checklists: one of each card, counting a two-part card by its front face.
--
-- CubeCobra lists two-part cards by their front face ("Ardenvale Tactician")
-- while Scryfall names them in full ("Ardenvale Tactician // Dizzying Swoop"),
-- so the original unique index on lower(name) let both onto the same list.
-- This one keys on the front face, matching cardKey() in
-- src/store/lib/cubeChecklist.ts (the app also ignores accents). Front-face
-- names are unique across Magic, so this is stricter than the old index and
-- replaces it. The new index is built before the old one is dropped, so the
-- list is never unguarded.
--
-- Safe to run more than once.

create unique index if not exists cube_checklist_cards_card_uidx
  on public.cube_checklist_cards (checklist_id, lower(btrim(split_part(name, '//', 1))));

drop index if exists public.cube_checklist_cards_name_uidx;
