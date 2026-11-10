-- Partner program: more "Works as" choices for referral partners in the
-- trading-card world, and a record of emails staff send an applicant or
-- partner from the admin Partners page ("Message them").
--
-- 1. partners.profession — mirrors PARTNER_PROFESSIONS in
--    src/store/lib/partnerTypes.ts. Only adds values, so every existing row
--    still passes.
-- 2. partner_messages — one row per email staff send. Written only by the API
--    (service_role, api/admin/partners/[id].ts action "message"); staff read
--    them through RLS to show the history in the partner drawer. Replies go
--    to the store's reply-to inbox, not back into this table.

alter table public.partners drop constraint if exists partners_profession_check;
alter table public.partners
  add constraint partners_profession_check check (
    profession is null or profession in (
      'estate_sale', 'estate_attorney', 'realtor', 'move_manager', 'auction',
      'cleanout', 'pawn_resale',
      'card_shop', 'card_reseller', 'card_show', 'tournament_organizer',
      'grading_consignment', 'content_creator', 'collector',
      'other'
    )
  );

create table if not exists public.partner_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  sent_by uuid references auth.users (id) on delete set null,
  sent_by_email text check (sent_by_email is null or char_length(sent_by_email) <= 320),
  to_email text not null check (char_length(to_email) between 3 and 320),
  subject text not null check (char_length(subject) between 1 and 150),
  body text not null check (char_length(body) between 1 and 5000),
  -- sent | failed (the email didn't go out; staff are told to email by hand)
  email_status text not null default 'sent' check (email_status in ('sent', 'failed'))
);

comment on table public.partner_messages is
  'Emails staff sent a partner or applicant from the admin Partners page. Written only by the API (service_role); staff read-only via RLS.';

create index if not exists partner_messages_partner_created_idx
  on public.partner_messages (partner_id, created_at desc);

alter table public.partner_messages enable row level security;

drop policy if exists partner_messages_staff_select on public.partner_messages;
create policy partner_messages_staff_select
  on public.partner_messages for select to authenticated
  using ((select public.is_staff()));

revoke all on public.partner_messages from anon, authenticated;
grant select on public.partner_messages to authenticated;
