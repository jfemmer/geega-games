-- Lets a seller attach a photo to a specific card in their sell submission
-- (rather than only the general collection-photos uploader), and lets staff
-- see which photo goes with which card claim. There is no server-generated
-- card id at upload time — the browser only has SellCardLine.localId — so
-- this is a plain correlation key scoped to one submission, not a foreign
-- key: the client tags both the card and its photo(s) with the same string,
-- and the server stores it as-is without ever trusting it for anything
-- beyond display grouping.

alter table public.sell_submission_cards
  add column if not exists client_card_id text;

alter table public.sell_submission_photos
  add column if not exists client_card_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sell_submission_cards_client_card_id_len'
  ) then
    alter table public.sell_submission_cards
      add constraint sell_submission_cards_client_card_id_len
        check (client_card_id is null or char_length(client_card_id) <= 100);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'sell_submission_photos_client_card_id_len'
  ) then
    alter table public.sell_submission_photos
      add constraint sell_submission_photos_client_card_id_len
        check (client_card_id is null or char_length(client_card_id) <= 100);
  end if;
end$$;

comment on column public.sell_submission_cards.client_card_id is
  'Client-generated id (SellCardLine.localId) unique within one submission. A photo in sell_submission_photos with the same client_card_id was attached to this specific card on the seller-facing form. Not a foreign key — purely a correlation key for display grouping.';

comment on column public.sell_submission_photos.client_card_id is
  'Matches sell_submission_cards.client_card_id when this photo was attached to a specific card rather than the general collection-photos uploader. Null means it is a general collection photo.';
