-- Admin push notifications: add "signup" (a new customer account becomes
-- active — see api/account/new-account.ts). Devices that already turned
-- notifications on get it too, since the owner asked for it.

alter table public.staff_push_subscriptions
  drop constraint if exists staff_push_subscriptions_kinds_check;

alter table public.staff_push_subscriptions
  add constraint staff_push_subscriptions_kinds_check
  check (kinds <@ array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup']::text[]);

alter table public.staff_push_subscriptions
  alter column kinds set default array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup']::text[];

update public.staff_push_subscriptions
  set kinds = array_append(kinds, 'signup'), updated_at = now()
  where not ('signup' = any (kinds));
