-- Store-credit payout option for Sell Your Cards (+20% over PayPal).
--
-- When a seller accepts an offer they now choose how to be paid:
--   paypal        -> offer amount via PayPal Goods & Services (as before)
--   store_credit  -> offer amount + store_credit_bonus_percent, as Geega
--                    Games store credit on their account
-- Store credit needs an account to hold it, so /api/sell/respond-to-offer
-- only accepts store_credit from a signed-in seller and links the submission
-- to that account.
--
-- Staff don't issue the credit by hand: when a store_credit submission is
-- moved to 'completed', the trigger below writes ONE trade_in_payout ledger
-- row (store_credit_issued_at guards against doing it twice) for
--   coalesce(purchase_amount_cents, offer_value_cents) * (100 + bonus) / 100
-- purchase_amount_cents is the PayPal-equivalent amount staff settled on
-- (e.g. after inspection); the bonus is applied on top of it.

alter table public.sell_submissions
  add column if not exists payout_method text
    check (payout_method is null or payout_method in ('paypal', 'store_credit')),
  add column if not exists store_credit_bonus_percent integer
    check (store_credit_bonus_percent is null or store_credit_bonus_percent between 0 and 100),
  add column if not exists store_credit_cents integer,
  add column if not exists store_credit_issued_at timestamptz;

comment on column public.sell_submissions.payout_method is
  'Seller''s payout choice when accepting the offer: paypal or store_credit (null = not chosen / legacy).';
comment on column public.sell_submissions.store_credit_bonus_percent is
  'Store-credit bonus promised to the seller at acceptance (snapshot, e.g. 20).';
comment on column public.sell_submissions.store_credit_cents is
  'Store credit actually issued (set when the submission is completed).';

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
    v_base := coalesce(new.purchase_amount_cents, new.offer_value_cents);
    if v_base is not null and v_base > 0 then
      v_amount := round(v_base * (100 + coalesce(new.store_credit_bonus_percent, 20)) / 100.0)::int;
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

drop trigger if exists sell_submission_issue_store_credit_trg on public.sell_submissions;
create trigger sell_submission_issue_store_credit_trg
  before update of status on public.sell_submissions
  for each row execute function public.sell_submission_issue_store_credit();

-- The seller-facing offer lookup also reports the payout they chose.
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
