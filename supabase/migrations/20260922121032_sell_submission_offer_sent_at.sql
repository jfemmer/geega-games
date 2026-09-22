alter table public.sell_submissions add column if not exists offer_sent_at timestamptz;

comment on column public.sell_submissions.offer_sent_at is
  'When staff actually sent this offer to the seller via the Send Offer action (api/admin/sell-submissions/[id]/send-offer.ts). Null means any offer_value_cents on file is still just a private note, never communicated to the seller.';
