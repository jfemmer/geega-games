-- Partner program: agreements signed electronically on approval.
--
--   partner_agreements   One row per agreement sent to a partner: the text
--                        rendered for them (src/store/lib/partnerAgreement.ts)
--                        frozen with its SHA-256, the fee it was rendered with,
--                        the boxes they must tick, the signing link's secret
--                        (as a hash only), and, once signed, the signing record:
--                        typed legal name, title and signature, every box, time,
--                        IP, browser, the record's own SHA-256 and the signed
--                        PDF's path and SHA-256.
--
-- partner_sign_agreement() is the only way an agreement becomes signed. It
-- checks the link is open and unexpired, that the signer saw exactly the
-- frozen text, that every required box was ticked and the signature matches
-- the legal name, then in one transaction records the signature and, for an
-- applicant, makes the partner active. Approving a partner with no signed
-- agreement only sends the agreement: their link (referral partners) and
-- leads (stores) start when they sign.
--
-- Signed agreements are never edited or deleted. A change is a new agreement.
-- Written only by the API (service_role); staff read them through RLS.
--
-- Error codes: GP001-GP019.

create table if not exists public.partner_agreements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  kind text not null check (kind in ('store', 'referrer')),
  version_number integer not null check (version_number >= 1),
  title text not null check (char_length(title) between 3 and 200),
  rendered_md text not null check (char_length(rendered_md) between 500 and 200000),
  rendered_sha256 text not null default '',
  fee_percent numeric(5, 2) not null check (fee_percent >= 0 and fee_percent <= 50),
  required_acks text[] not null check (cardinality(required_acks) between 1 and 20),
  status text not null default 'pending' check (status in ('pending', 'signed', 'void')),
  invited_email text not null check (char_length(invited_email) between 3 and 320),
  invite_token_hash text not null unique check (invite_token_hash ~ '^[0-9a-f]{64}$'),
  invite_expires_at timestamptz not null,
  sent_by uuid references auth.users (id) on delete set null,
  sent_by_email text,
  last_emailed_at timestamptz,
  -- Signing record (set once, by partner_sign_agreement()).
  signed_at timestamptz,
  signer_legal_name text check (signer_legal_name is null or char_length(signer_legal_name) between 2 and 200),
  signer_title text check (signer_title is null or char_length(signer_title) between 2 and 200),
  typed_signature text check (typed_signature is null or char_length(typed_signature) between 2 and 200),
  acknowledgments jsonb,
  signer_ip text,
  signer_user_agent text,
  record_sha256 text,
  pdf_path text,
  pdf_sha256 text,
  pdf_generated_at timestamptz,
  signed_copy_emailed_at timestamptz,
  -- Voiding (a newer agreement replaced it, or the application was declined).
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 500),
  check ((status = 'signed') = (signed_at is not null)),
  check ((status = 'void') = (voided_at is not null)),
  check (status <> 'signed' or (signer_legal_name is not null and typed_signature is not null and record_sha256 is not null))
);

comment on table public.partner_agreements is
  'Partner program agreements: text frozen at sending, signed electronically. Written only by the API and partner_sign_agreement(); staff read-only via RLS. Never edited once signed, never deleted.';

create unique index if not exists partner_agreements_one_open
  on public.partner_agreements (partner_id) where status = 'pending';
create index if not exists partner_agreements_partner_idx
  on public.partner_agreements (partner_id, created_at desc);

-- Text, hash and terms are frozen; a signature is permanent; nothing is deleted.
create or replace function public.tg_partner_agreement_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Agreements are kept for the record. Void one instead.' using errcode = 'GP001';
  end if;
  if tg_op = 'INSERT' then
    new.rendered_sha256 := encode(sha256(convert_to(new.rendered_md, 'UTF8')), 'hex');
    if new.status <> 'pending' then
      raise exception 'A new agreement starts unsigned.' using errcode = 'GP002';
    end if;
    return new;
  end if;
  if new.rendered_md is distinct from old.rendered_md or new.rendered_sha256 is distinct from old.rendered_sha256
     or new.partner_id is distinct from old.partner_id or new.kind is distinct from old.kind
     or new.version_number is distinct from old.version_number or new.title is distinct from old.title
     or new.fee_percent is distinct from old.fee_percent or new.required_acks is distinct from old.required_acks
     or new.invited_email is distinct from old.invited_email or new.invite_token_hash is distinct from old.invite_token_hash
     or new.created_at is distinct from old.created_at then
    raise exception 'An agreement''s text and terms can''t be changed. Send a new agreement instead.' using errcode = 'GP003';
  end if;
  if old.status = 'signed' then
    if new.status <> 'signed' or new.signed_at is distinct from old.signed_at
       or new.signer_legal_name is distinct from old.signer_legal_name or new.signer_title is distinct from old.signer_title
       or new.typed_signature is distinct from old.typed_signature or new.acknowledgments is distinct from old.acknowledgments
       or new.signer_ip is distinct from old.signer_ip or new.signer_user_agent is distinct from old.signer_user_agent
       or new.record_sha256 is distinct from old.record_sha256
       or (old.pdf_path is not null and new.pdf_path is distinct from old.pdf_path)
       or (old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256) then
      raise exception 'A signed agreement can''t be changed.' using errcode = 'GP004';
    end if;
  elsif old.status = 'void' and new.status <> 'void' then
    raise exception 'A voided agreement can''t be reopened. Send a new one.' using errcode = 'GP005';
  elsif new.status = 'signed' and coalesce(current_setting('geega.partner_signing', true), '') <> 'on' then
    raise exception 'Agreements are signed only through the signing page.' using errcode = 'GP006';
  end if;
  return new;
end;
$$;

drop trigger if exists partner_agreement_guard on public.partner_agreements;
create trigger partner_agreement_guard before insert or update or delete on public.partner_agreements
  for each row execute function public.tg_partner_agreement_guard();

-- ------------------------------------------------------------ sending

-- Voids any open agreement for the partner and inserts the new one, in one
-- transaction (so there's never two open links).
create or replace function public.partner_create_agreement(
  p_partner_id uuid,
  p_kind text,
  p_version_number integer,
  p_title text,
  p_rendered_md text,
  p_fee_percent numeric,
  p_required_acks text[],
  p_invited_email text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_sent_by uuid,
  p_sent_by_email text
) returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
  v_partner public.partners%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into v_partner from public.partners where id = p_partner_id for update;
  if not found then
    raise exception 'That partner isn''t there.' using errcode = 'GP010';
  end if;
  if v_partner.kind <> p_kind then
    raise exception 'That agreement is for the wrong kind of partner.' using errcode = 'GP011';
  end if;
  if v_partner.status = 'declined' then
    raise exception 'This application was declined. Approve it to send an agreement.' using errcode = 'GP012';
  end if;
  update public.partner_agreements
     set status = 'void', voided_at = now(), void_reason = 'Replaced by a newer agreement.'
   where partner_id = p_partner_id and status = 'pending';
  insert into public.partner_agreements
    (partner_id, kind, version_number, title, rendered_md, fee_percent, required_acks, invited_email,
     invite_token_hash, invite_expires_at, sent_by, sent_by_email)
  values
    (p_partner_id, p_kind, p_version_number, p_title, p_rendered_md, p_fee_percent, p_required_acks,
     lower(btrim(p_invited_email)), p_token_hash, p_expires_at, p_sent_by, p_sent_by_email)
  returning id into v_id;
  return v_id;
end;
$$;

-- ------------------------------------------------------------ signing

create or replace function public.partner_sign_agreement(
  p_agreement_id uuid,
  p_legal_name text,
  p_title text,
  p_typed_signature text,
  p_acknowledgments jsonb,
  p_agreement_sha256 text,
  p_ip text,
  p_user_agent text
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  a public.partner_agreements%rowtype;
  v_partner public.partners%rowtype;
  v_ack text;
  v_now timestamptz := now();
  v_record jsonb;
  v_name text := regexp_replace(btrim(coalesce(p_legal_name, '')), '\s+', ' ', 'g');
  v_title text := regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g');
  v_sig text := regexp_replace(btrim(coalesce(p_typed_signature, '')), '\s+', ' ', 'g');
  v_activated boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select * into a from public.partner_agreements where id = p_agreement_id for update;
  if not found then
    raise exception 'That agreement isn''t there.' using errcode = 'GP013';
  end if;
  if a.status = 'signed' then
    raise exception 'This agreement is already signed.' using errcode = 'GP014';
  end if;
  if a.status <> 'pending' then
    raise exception 'This link was replaced or cancelled. Use the newest link Geega Games sent you.' using errcode = 'GP015';
  end if;
  if a.invite_expires_at <= v_now then
    raise exception 'This link has expired. Ask Geega Games to send a new one.' using errcode = 'GP015';
  end if;
  if p_agreement_sha256 is distinct from a.rendered_sha256 then
    raise exception 'The agreement changed while you were reading it. Reload the page and review it again.' using errcode = 'GP016';
  end if;
  foreach v_ack in array a.required_acks loop
    if coalesce(p_acknowledgments ->> v_ack, '') <> 'true' then
      raise exception 'Tick every box before signing.' using errcode = 'GP017';
    end if;
  end loop;
  if char_length(v_name) < 3 or char_length(v_sig) < 3 then
    raise exception 'Enter your full legal name and type it again as your signature.' using errcode = 'GP018';
  end if;
  if char_length(v_title) < 2 then
    raise exception 'Enter your title or role.' using errcode = 'GP018';
  end if;
  if lower(v_name) <> lower(v_sig) then
    raise exception 'Your typed signature must match your full legal name exactly.' using errcode = 'GP018';
  end if;

  select * into v_partner from public.partners where id = a.partner_id for update;
  if v_partner.status = 'declined' then
    raise exception 'This partnership is no longer available. Contact Geega Games.' using errcode = 'GP019';
  end if;

  v_record := jsonb_build_object(
    'agreementId', a.id,
    'partnerId', a.partner_id,
    'businessName', v_partner.business_name,
    'kind', a.kind,
    'version', a.version_number,
    'feePercent', a.fee_percent,
    'agreementSha256', a.rendered_sha256,
    'legalName', v_name,
    'title', v_title,
    'typedSignature', v_sig,
    'email', a.invited_email,
    'acknowledgments', (select jsonb_object_agg(k, true) from unnest(a.required_acks) k),
    'signedAt', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'ip', left(p_ip, 100)
  );

  perform set_config('geega.partner_signing', 'on', true);
  update public.partner_agreements
     set status = 'signed',
         signed_at = v_now,
         signer_legal_name = v_name,
         signer_title = v_title,
         typed_signature = v_sig,
         acknowledgments = v_record -> 'acknowledgments',
         signer_ip = left(p_ip, 100),
         signer_user_agent = left(p_user_agent, 400),
         record_sha256 = encode(sha256(convert_to(v_record::text, 'UTF8')), 'hex')
   where id = a.id;
  perform set_config('geega.partner_signing', '', true);

  -- An approved applicant goes live when they sign, at the fee they signed for.
  if v_partner.status = 'applied' then
    update public.partners
       set status = 'active', approved_at = coalesce(approved_at, v_now), fee_percent = a.fee_percent
     where id = v_partner.id;
    v_activated := true;
  end if;

  return jsonb_build_object('partnerId', v_partner.id, 'kind', a.kind, 'activated', v_activated);
end;
$$;

revoke all on function public.partner_create_agreement(uuid, text, integer, text, text, numeric, text[], text, text, timestamptz, uuid, text) from public, anon, authenticated;
revoke all on function public.partner_sign_agreement(uuid, text, text, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.partner_create_agreement(uuid, text, integer, text, text, numeric, text[], text, text, timestamptz, uuid, text) to service_role;
grant execute on function public.partner_sign_agreement(uuid, text, text, text, jsonb, text, text, text) to service_role;

-- ------------------------------------------------------------ access

alter table public.partner_agreements enable row level security;

drop policy if exists partner_agreements_staff_select on public.partner_agreements;
create policy partner_agreements_staff_select
  on public.partner_agreements for select to authenticated
  using ((select public.is_staff()));

revoke all on public.partner_agreements from anon, authenticated;
grant select on public.partner_agreements to authenticated;

-- Signed PDFs: private; the API hands out short-lived links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partner-agreements', 'partner-agreements', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
