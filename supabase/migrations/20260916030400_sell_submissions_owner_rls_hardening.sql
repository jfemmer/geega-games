-- Row Level Security is ROW-level, not COLUMN-level: the previous
-- sell_submissions_select policy ("is_staff() or user_id = auth.uid()")
-- correctly restricted a customer to their OWN row, but that row includes
-- staff-only columns (internal_notes, offer_value_cents,
-- purchase_amount_cents, priority, favorited) that must never reach the
-- seller — "internal", "never shown to the seller" per the feature spec.
-- The account page only ever asked for a narrow column list, but a
-- technically inclined signed-in customer could still run
-- `supabase.from('sell_submissions').select('*')` with their own valid
-- session and read those columns directly, since RLS had already let the
-- ROW through.
--
-- Fix: direct table reads become staff-only. A self-service RPC
-- (my_sell_submissions) — the SAME pattern this project already uses for
-- my_store_credit_balance — returns ONLY the safe columns for the caller's
-- own rows. sell_submission_cards / sell_submission_photos get the same
-- staff-only tightening; nothing customer-facing currently needs direct
-- access to those (the account page shows status only), so this closes the
-- same class of gap preemptively rather than leaving it available unused.

begin;

drop policy if exists sell_submissions_select on public.sell_submissions;
create policy sell_submissions_select
  on public.sell_submissions for select to authenticated
  using (public.is_staff());

drop policy if exists sell_submission_cards_select on public.sell_submission_cards;
create policy sell_submission_cards_select
  on public.sell_submission_cards for select to authenticated
  using (public.is_staff());

drop policy if exists sell_submission_photos_select on public.sell_submission_photos;
create policy sell_submission_photos_select
  on public.sell_submission_photos for select to authenticated
  using (public.is_staff());

create or replace function public.my_sell_submissions()
returns table (
  id uuid,
  reference_number text,
  created_at timestamptz,
  status public.sell_submission_status
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select s.id, s.reference_number, s.created_at, s.status
  from public.sell_submissions s
  where s.user_id = auth.uid()
  order by s.created_at desc;
$function$;

revoke all on function public.my_sell_submissions() from public, anon;
grant execute on function public.my_sell_submissions() to authenticated;

commit;
