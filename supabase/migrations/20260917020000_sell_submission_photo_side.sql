-- Lets a seller-attached card photo record which side of the card it shows
-- (front or back). A condition claim can only be verified with both sides
-- visible, so staff need to tell them apart rather than see two
-- unlabeled thumbnails under a card.

alter table public.sell_submission_photos
  add column if not exists side text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sell_submission_photos_side_check'
  ) then
    alter table public.sell_submission_photos
      add constraint sell_submission_photos_side_check
        check (side is null or side in ('front', 'back'));
  end if;
end$$;

comment on column public.sell_submission_photos.side is
  'Which side of the card this photo shows (front/back) when attached to a specific card via client_card_id. Null for a general collection photo.';
