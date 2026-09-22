-- Anti-enumeration lookup for the public "respond to your offer" page,
-- mirroring guest_order_lookup()'s pattern exactly: requires an EXACT email
-- match AND the reference number together — neither alone resolves a row.
-- Additionally only resolves when an offer has actually been sent
-- (offer_sent_at is not null): a correct ref+email pair for a submission
-- that hasn't received an offer yet returns no data, identical to a
-- wrong ref/email, so this never leaks whether a given email/reference
-- exists or what stage it's in.
--
-- allow_counter mirrors the exact business rule enforced independently (and
-- authoritatively) by api/sell/respond-to-offer.ts: Counter is only ever
-- offered for large, unsorted collections (no itemized card list). This
-- copy only drives which buttons the page shows — it is never trusted on
-- its own for the actual write.
create or replace function public.sell_submission_offer_lookup(p_reference_number text, p_email text)
returns jsonb
language sql
stable
security definer
set search_path = 'public'
as $function$
  select jsonb_build_object(
    'id', s.id,
    'reference_number', s.reference_number,
    'first_name', s.first_name,
    'offer_value_cents', s.offer_value_cents,
    'offer_sent_at', s.offer_sent_at,
    'offer_response', s.offer_response,
    'counter_offer_cents', s.counter_offer_cents,
    'offer_responded_at', s.offer_responded_at,
    'allow_counter', (s.total_cards = 0 and s.collection_size in ('5000_to_10000', '10000_plus'))
  )
  from public.sell_submissions s
  where s.email is not null
    and lower(s.email) = lower(trim(p_email))
    and upper(s.reference_number) = upper(trim(p_reference_number))
    and s.offer_sent_at is not null
  limit 1;
$function$;

revoke all on function public.sell_submission_offer_lookup(text, text) from public;
grant execute on function public.sell_submission_offer_lookup(text, text) to anon, authenticated, service_role;
