-- Trade Center: save the cards and TCG low prices staff enter at a local
-- pickup meetup before finishing the trade.
--
-- At the meetup, staff list each of the customer's cards they're taking with
-- its condition, quantity and TCG low. Until now those only lived on the
-- screen until "Finish the trade" (trade_complete_local); closing the trade,
-- reloading or switching devices lost them. Staff can now save them as a
-- draft on the trade, and the meetup screen starts from it.
--
-- The draft is staff's working list only: it changes nothing about the trade,
-- its totals or its holds, customers never see it (trade tables are
-- server-only, and the customer's view doesn't include it), and finishing
-- the trade still takes the cards staff submit then. Shape: an array of
--   { scryfall_id, card_name, set_code, set_name, collector_number, finish,
--     image_url, condition, quantity, unit_cents (null: not priced yet),
--     reference_price_cents, note }
-- checked by the server (api/admin/trade-center.ts, saveMeetupDraft).
--
-- Safe to run more than once.

alter table public.trade_requests
  add column if not exists meetup_draft jsonb,
  add column if not exists meetup_draft_saved_at timestamptz,
  add column if not exists meetup_draft_saved_by text;

alter table public.trade_requests drop constraint if exists trade_requests_meetup_draft_check;
alter table public.trade_requests add constraint trade_requests_meetup_draft_check
  check (meetup_draft is null or (jsonb_typeof(meetup_draft) = 'array' and jsonb_array_length(meetup_draft) <= 500));

comment on column public.trade_requests.meetup_draft is
  'Local pickup: the cards, conditions, quantities and TCG low prices staff saved at the meetup before finishing (staff only).';
comment on column public.trade_requests.meetup_draft_saved_at is 'Local pickup: when staff last saved the meetup draft.';
comment on column public.trade_requests.meetup_draft_saved_by is 'Local pickup: who last saved the meetup draft.';
