do $$
begin
  if not exists (select 1 from pg_type where typname = 'sell_offer_response') then
    create type public.sell_offer_response as enum ('accepted', 'declined', 'countered');
  end if;
end
$$;

alter table public.sell_submissions add column if not exists offer_response public.sell_offer_response;
alter table public.sell_submissions
  add column if not exists counter_offer_cents integer check (counter_offer_cents >= 0);
alter table public.sell_submissions add column if not exists offer_responded_at timestamptz;

comment on column public.sell_submissions.offer_response is
  'How the seller responded to the sent offer, via the public /sell/offer page. Independent of status: status tracks OUR workflow, this tracks THEIR reply to the specific offer_value_cents that was sent.';
comment on column public.sell_submissions.counter_offer_cents is
  'The seller''s counter amount, set only when offer_response = ''countered''. Only ever offered as an option for large, unsorted (no card list) collections — see api/sell/respond-to-offer.ts.';
comment on column public.sell_submissions.offer_responded_at is
  'When the seller submitted their response. Also used to gate against responding twice.';
