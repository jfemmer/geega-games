-- Sell Your Cards: staff now set the store-credit amount on each offer.
--
-- Until now an offer carried one number (offer_value_cents, paid by PayPal)
-- and store credit was always that number + store_credit_bonus_percent (20).
-- The owner's published terms (2026-11-02) don't fit one bonus on the whole
-- offer: shipped singles pay up to 70% of TCG low by PayPal, on a tier scale,
-- and 80% of TCG low in store credit only on singles worth $20 or more. So
-- staff work out both amounts and send them together:
--
--   offer_value_cents   PayPal Goods & Services amount (unchanged)
--   credit_offer_cents  store-credit amount offered alongside it (new)
--
-- Offers sent before this change have credit_offer_cents = null and keep the
-- old rule (PayPal + store_credit_bonus_percent), so nothing a seller was
-- already promised changes.
--
-- When the seller takes store credit and staff mark the lead completed, the
-- trigger issues:
--   credit_offer_cents set:   credit_offer_cents, scaled by
--                             purchase_amount_cents / offer_value_cents when
--                             staff settled on a different PayPal-equivalent
--                             amount after inspection (same ratio as offered);
--   credit_offer_cents null:  coalesce(purchase_amount_cents, offer_value_cents)
--                             * (100 + bonus) / 100, as before.
-- The admin lead drawer shows the exact amount before it's issued.

alter table public.sell_submissions
  add column if not exists credit_offer_cents integer
    check (credit_offer_cents is null or credit_offer_cents > 0);

comment on column public.sell_submissions.credit_offer_cents is
  'Store-credit amount offered alongside offer_value_cents (PayPal), set by staff with Send offer. Null = an offer sent before 2026-11-02: credit is the PayPal amount + store_credit_bonus_percent.';

create or replace function public.sell_submission_issue_store_credit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_base integer;
  v_amount integer;
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and new.payout_method = 'store_credit'
     and new.store_credit_issued_at is null
     and new.user_id is not null
  then
    if new.credit_offer_cents is not null then
      -- The credit amount staff offered, scaled only if they settled on a
      -- different PayPal-equivalent amount after inspection.
      if new.purchase_amount_cents is not null
         and new.offer_value_cents is not null
         and new.offer_value_cents > 0
      then
        v_amount := round(
          new.credit_offer_cents::numeric * new.purchase_amount_cents / new.offer_value_cents
        )::int;
      else
        v_amount := new.credit_offer_cents;
      end if;
    else
      v_base := coalesce(new.purchase_amount_cents, new.offer_value_cents);
      if v_base is not null and v_base > 0 then
        v_amount := round(v_base * (100 + coalesce(new.store_credit_bonus_percent, 20)) / 100.0)::int;
      end if;
    end if;

    if v_amount is not null and v_amount > 0 then
      insert into public.store_credit_transactions
        (user_id, amount_cents, type, reason, reference_type, reference_id, created_by)
      values (
        new.user_id, v_amount, 'trade_in_payout',
        'Sell submission ' || coalesce(new.reference_number, new.id::text),
        'sell_submission', new.id, auth.uid()
      );
      new.store_credit_cents := v_amount;
      new.store_credit_issued_at := now();
    end if;
  end if;
  return new;
end;
$function$;

-- The seller-facing offer lookup also returns the store-credit amount offered.
create or replace function public.sell_submission_offer_lookup(p_reference_number text, p_email text)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', s.id,
    'reference_number', s.reference_number,
    'first_name', s.first_name,
    'offer_value_cents', s.offer_value_cents,
    'credit_offer_cents', s.credit_offer_cents,
    'offer_sent_at', s.offer_sent_at,
    'offer_response', s.offer_response,
    'counter_offer_cents', s.counter_offer_cents,
    'offer_responded_at', s.offer_responded_at,
    'allow_counter', (s.total_cards = 0 and s.collection_size in ('5000_to_10000', '10000_plus')),
    'payout_method', s.payout_method,
    'store_credit_bonus_percent', s.store_credit_bonus_percent
  )
  from public.sell_submissions s
  where s.email is not null
    and lower(s.email) = lower(trim(p_email))
    and upper(s.reference_number) = upper(trim(p_reference_number))
    and s.offer_sent_at is not null
  limit 1;
$function$;
