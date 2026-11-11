-- Partner agreements, version 2 of the Referral Partner Agreement: the
-- partner signs first, naming the legal entity they sign for (section 3.1),
-- and the agreement takes effect only when Geega Games countersigns it
-- (section 16.6). Builds on 20261111010000_partner_agreements.sql.
--
--   pending               sent, waiting for the partner
--   awaiting_countersign  the partner signed (requires_countersign agreements):
--                         nothing is live yet; the owner countersigns or voids it
--   signed                fully executed: the partner's signature, plus Geega
--                         Games' countersignature when one was required.
--                         Referral fees and store leads need one of these.
--   void                  replaced, declined or cancelled
--
-- partner_sign_agreement() now records the entity details and, for an
-- agreement that needs a countersignature, stops at awaiting_countersign
-- without activating the partner. partner_countersign_agreement() (owner,
-- through the API) records Geega Games' signature in one transaction, makes
-- the agreement signed and, for an applicant, makes the partner active at the
-- fee they signed for. Store agreements (version 1) are signed in one step as
-- before.
--
-- Both RPCs keep their old named parameters, with the new ones defaulted, so
-- the code deployed before this migration keeps working until the new code is
-- live.
--
-- Unsigned version 1 Referral Partner Agreement links are voided: those
-- partners are sent version 2 instead.
--
-- Error codes: GP001-GP023 (GP020-GP023 new here).

alter table public.partner_agreements
  add column if not exists requires_countersign boolean not null default false,
  -- The legal entity the partner signed for (section 3.1).
  add column if not exists signer_entity_name text
    check (signer_entity_name is null or char_length(signer_entity_name) between 2 and 200),
  add column if not exists signer_entity_type text
    check (signer_entity_type is null or signer_entity_type in ('individual', 'llc', 'corporation', 'partnership', 'nonprofit', 'other')),
  add column if not exists signer_entity_state text
    check (signer_entity_state is null or signer_entity_state ~ '^[A-Z]{2}$'),
  add column if not exists signer_business_address text
    check (signer_business_address is null or char_length(signer_business_address) between 8 and 300),
  -- Geega Games' countersignature (set once, by partner_countersign_agreement()).
  add column if not exists countersigned_at timestamptz,
  add column if not exists countersigned_by uuid references auth.users (id) on delete set null,
  add column if not exists countersigned_by_email text,
  add column if not exists countersigner_name text
    check (countersigner_name is null or char_length(countersigner_name) between 2 and 200),
  add column if not exists countersigner_title text
    check (countersigner_title is null or char_length(countersigner_title) between 2 and 200),
  add column if not exists countersign_typed_signature text
    check (countersign_typed_signature is null or char_length(countersign_typed_signature) between 2 and 200),
  add column if not exists countersign_ip text,
  add column if not exists countersign_user_agent text,
  add column if not exists countersign_record_sha256 text;

alter table public.partner_agreements drop constraint if exists partner_agreements_status_check;
alter table public.partner_agreements add constraint partner_agreements_status_check
  check (status in ('pending', 'awaiting_countersign', 'signed', 'void'));

-- Was: signed ⇔ signed_at. Now the partner's signature exists from
-- awaiting_countersign on, and a voided agreement may or may not have one.
alter table public.partner_agreements drop constraint if exists partner_agreements_check;
alter table public.partner_agreements drop constraint if exists partner_agreements_partner_signed_check;
alter table public.partner_agreements add constraint partner_agreements_partner_signed_check
  check (
    (status in ('awaiting_countersign', 'signed') and signed_at is not null)
    or (status = 'pending' and signed_at is null)
    or status = 'void'
  );

alter table public.partner_agreements drop constraint if exists partner_agreements_check2;
alter table public.partner_agreements drop constraint if exists partner_agreements_signature_check;
alter table public.partner_agreements add constraint partner_agreements_signature_check
  check (
    signed_at is null
    or (signer_legal_name is not null and typed_signature is not null and record_sha256 is not null)
  );

alter table public.partner_agreements drop constraint if exists partner_agreements_awaiting_check;
alter table public.partner_agreements add constraint partner_agreements_awaiting_check
  check (status <> 'awaiting_countersign' or requires_countersign);

alter table public.partner_agreements drop constraint if exists partner_agreements_countersign_check;
alter table public.partner_agreements add constraint partner_agreements_countersign_check
  check (
    (countersigned_at is null and countersigner_name is null and countersign_record_sha256 is null)
    or (status = 'signed' and requires_countersign and countersigner_name is not null
        and countersign_typed_signature is not null and countersign_record_sha256 is not null)
  );

alter table public.partner_agreements drop constraint if exists partner_agreements_executed_check;
alter table public.partner_agreements add constraint partner_agreements_executed_check
  check (status <> 'signed' or not requires_countersign or countersigned_at is not null);

-- One open agreement per partner: sent, or signed by them and waiting for us.
drop index if exists public.partner_agreements_one_open;
create unique index partner_agreements_one_open
  on public.partner_agreements (partner_id) where status in ('pending', 'awaiting_countersign');

comment on table public.partner_agreements is
  'Partner program agreements: text frozen at sending, signed electronically by the partner and, where required, countersigned by Geega Games. Written only by the API and the partner_*_agreement() functions; staff read-only via RLS. Never edited once signed, never deleted.';

-- ------------------------------------------------------------ guard

create or replace function public.tg_partner_agreement_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_signing boolean := coalesce(current_setting('geega.partner_signing', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    raise exception 'Agreements are kept for the record. Void one instead.' using errcode = 'GP001';
  end if;
  if tg_op = 'INSERT' then
    new.rendered_sha256 := encode(sha256(convert_to(new.rendered_md, 'UTF8')), 'hex');
    if new.status <> 'pending' or new.signed_at is not null or new.countersigned_at is not null then
      raise exception 'A new agreement starts unsigned.' using errcode = 'GP002';
    end if;
    return new;
  end if;

  -- Text and terms are frozen from the start.
  if new.rendered_md is distinct from old.rendered_md or new.rendered_sha256 is distinct from old.rendered_sha256
     or new.partner_id is distinct from old.partner_id or new.kind is distinct from old.kind
     or new.version_number is distinct from old.version_number or new.title is distinct from old.title
     or new.fee_percent is distinct from old.fee_percent or new.required_acks is distinct from old.required_acks
     or new.invited_email is distinct from old.invited_email or new.invite_token_hash is distinct from old.invite_token_hash
     or new.requires_countersign is distinct from old.requires_countersign
     or new.created_at is distinct from old.created_at then
    raise exception 'An agreement''s text and terms can''t be changed. Send a new agreement instead.' using errcode = 'GP003';
  end if;

  -- The partner's signature is permanent once given.
  if old.signed_at is not null and (
       new.signed_at is distinct from old.signed_at
       or new.signer_legal_name is distinct from old.signer_legal_name or new.signer_title is distinct from old.signer_title
       or new.typed_signature is distinct from old.typed_signature or new.acknowledgments is distinct from old.acknowledgments
       or new.signer_ip is distinct from old.signer_ip or new.signer_user_agent is distinct from old.signer_user_agent
       or new.record_sha256 is distinct from old.record_sha256
       or new.signer_entity_name is distinct from old.signer_entity_name or new.signer_entity_type is distinct from old.signer_entity_type
       or new.signer_entity_state is distinct from old.signer_entity_state
       or new.signer_business_address is distinct from old.signer_business_address) then
    raise exception 'A signed agreement can''t be changed.' using errcode = 'GP004';
  end if;

  if old.status = 'signed' then
    -- Fully executed: only the PDF may be filled in, once.
    if new.status <> 'signed'
       or new.countersigned_at is distinct from old.countersigned_at or new.countersigned_by is distinct from old.countersigned_by
       or new.countersigned_by_email is distinct from old.countersigned_by_email
       or new.countersigner_name is distinct from old.countersigner_name or new.countersigner_title is distinct from old.countersigner_title
       or new.countersign_typed_signature is distinct from old.countersign_typed_signature
       or new.countersign_ip is distinct from old.countersign_ip or new.countersign_user_agent is distinct from old.countersign_user_agent
       or new.countersign_record_sha256 is distinct from old.countersign_record_sha256
       or (old.pdf_path is not null and new.pdf_path is distinct from old.pdf_path)
       or (old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256) then
      raise exception 'A signed agreement can''t be changed.' using errcode = 'GP004';
    end if;
  elsif old.status = 'void' and new.status <> 'void' then
    raise exception 'A voided agreement can''t be reopened. Send a new one.' using errcode = 'GP005';
  elsif new.status in ('signed', 'awaiting_countersign') and new.status is distinct from old.status and not v_signing then
    raise exception 'Agreements are signed only through the signing page and the countersign step.' using errcode = 'GP006';
  elsif new.status <> 'signed' and new.countersigned_at is not null then
    raise exception 'Agreements are countersigned only through the countersign step.' using errcode = 'GP006';
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------ sending

drop function if exists public.partner_create_agreement(uuid, text, integer, text, text, numeric, text[], text, text, timestamptz, uuid, text);

-- Voids any open agreement for the partner (sent, or signed by them and not
-- yet countersigned) and inserts the new one, in one transaction.
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
  p_sent_by_email text,
  p_requires_countersign boolean default false
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
   where partner_id = p_partner_id and status in ('pending', 'awaiting_countersign');
  insert into public.partner_agreements
    (partner_id, kind, version_number, title, rendered_md, fee_percent, required_acks, invited_email,
     invite_token_hash, invite_expires_at, sent_by, sent_by_email, requires_countersign)
  values
    (p_partner_id, p_kind, p_version_number, p_title, p_rendered_md, p_fee_percent, p_required_acks,
     lower(btrim(p_invited_email)), p_token_hash, p_expires_at, p_sent_by, p_sent_by_email, coalesce(p_requires_countersign, false))
  returning id into v_id;
  return v_id;
end;
$$;

-- ------------------------------------------------------------ the partner signs

drop function if exists public.partner_sign_agreement(uuid, text, text, text, jsonb, text, text, text);

create or replace function public.partner_sign_agreement(
  p_agreement_id uuid,
  p_legal_name text,
  p_title text,
  p_typed_signature text,
  p_acknowledgments jsonb,
  p_agreement_sha256 text,
  p_ip text,
  p_user_agent text,
  p_entity_name text default null,
  p_entity_type text default null,
  p_entity_state text default null,
  p_business_address text default null
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
  v_entity_name text := nullif(regexp_replace(btrim(coalesce(p_entity_name, '')), '\s+', ' ', 'g'), '');
  v_entity_type text := nullif(btrim(coalesce(p_entity_type, '')), '');
  v_entity_state text := nullif(upper(btrim(coalesce(p_entity_state, ''))), '');
  v_address text := nullif(regexp_replace(btrim(coalesce(p_business_address, '')), '\s+', ' ', 'g'), '');
  v_activated boolean := false;
  v_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select * into a from public.partner_agreements where id = p_agreement_id for update;
  if not found then
    raise exception 'That agreement isn''t there.' using errcode = 'GP013';
  end if;
  if a.status in ('signed', 'awaiting_countersign') then
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

  -- Countersigned agreements name the legal entity that's bound (section 3.1).
  if a.requires_countersign then
    if v_entity_name is null or char_length(v_entity_name) < 2 or char_length(v_entity_name) > 200 then
      raise exception 'Enter the legal name of the business (or your own name, if you''re an individual).' using errcode = 'GP020';
    end if;
    if v_entity_type is null or v_entity_type not in ('individual', 'llc', 'corporation', 'partnership', 'nonprofit', 'other') then
      raise exception 'Choose what kind of business it is.' using errcode = 'GP020';
    end if;
    if v_entity_state is null or v_entity_state !~ '^[A-Z]{2}$' then
      raise exception 'Choose the state the business is organized in (or where you live).' using errcode = 'GP020';
    end if;
    if v_address is null or char_length(v_address) < 8 or char_length(v_address) > 300 then
      raise exception 'Enter the business''s mailing address.' using errcode = 'GP020';
    end if;
  else
    v_entity_name := null;
    v_entity_type := null;
    v_entity_state := null;
    v_address := null;
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
  if a.requires_countersign then
    v_record := v_record || jsonb_build_object(
      'entity', jsonb_build_object('name', v_entity_name, 'type', v_entity_type, 'state', v_entity_state, 'address', v_address)
    );
  end if;

  v_status := case when a.requires_countersign then 'awaiting_countersign' else 'signed' end;

  perform set_config('geega.partner_signing', 'on', true);
  update public.partner_agreements
     set status = v_status,
         signed_at = v_now,
         signer_legal_name = v_name,
         signer_title = v_title,
         typed_signature = v_sig,
         acknowledgments = v_record -> 'acknowledgments',
         signer_ip = left(p_ip, 100),
         signer_user_agent = left(p_user_agent, 400),
         signer_entity_name = v_entity_name,
         signer_entity_type = v_entity_type,
         signer_entity_state = v_entity_state,
         signer_business_address = v_address,
         record_sha256 = encode(sha256(convert_to(v_record::text, 'UTF8')), 'hex')
   where id = a.id;
  perform set_config('geega.partner_signing', '', true);

  -- One-step agreements: an approved applicant goes live when they sign, at
  -- the fee they signed for. Countersigned ones wait for Geega Games.
  if v_status = 'signed' and v_partner.status = 'applied' then
    update public.partners
       set status = 'active', approved_at = coalesce(approved_at, v_now), fee_percent = a.fee_percent
     where id = v_partner.id;
    v_activated := true;
  end if;

  return jsonb_build_object(
    'partnerId', v_partner.id,
    'kind', a.kind,
    'activated', v_activated,
    'awaitingCountersign', v_status = 'awaiting_countersign'
  );
end;
$$;

-- ------------------------------------------------------------ Geega Games countersigns

create or replace function public.partner_countersign_agreement(
  p_agreement_id uuid,
  p_name text,
  p_title text,
  p_typed_signature text,
  p_user_id uuid,
  p_user_email text,
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
  v_now timestamptz := now();
  v_record jsonb;
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
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
    raise exception 'This agreement is already countersigned.' using errcode = 'GP021';
  end if;
  if a.status <> 'awaiting_countersign' then
    raise exception 'This agreement isn''t waiting for a countersignature.' using errcode = 'GP022';
  end if;
  if char_length(v_name) < 3 or char_length(v_sig) < 3 then
    raise exception 'Enter your full legal name and type it again as your signature.' using errcode = 'GP023';
  end if;
  if char_length(v_title) < 2 then
    raise exception 'Enter your title.' using errcode = 'GP023';
  end if;
  if lower(v_name) <> lower(v_sig) then
    raise exception 'Your typed signature must match your full legal name exactly.' using errcode = 'GP023';
  end if;

  select * into v_partner from public.partners where id = a.partner_id for update;
  if v_partner.status = 'declined' then
    raise exception 'This application was declined. Approve it again to send a new agreement.' using errcode = 'GP019';
  end if;

  v_record := jsonb_build_object(
    'agreementId', a.id,
    'partnerId', a.partner_id,
    'agreementSha256', a.rendered_sha256,
    'partnerRecordSha256', a.record_sha256,
    'for', 'Geega Games LLC',
    'name', v_name,
    'title', v_title,
    'typedSignature', v_sig,
    'userId', p_user_id,
    'email', p_user_email,
    'countersignedAt', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'ip', left(p_ip, 100)
  );

  perform set_config('geega.partner_signing', 'on', true);
  update public.partner_agreements
     set status = 'signed',
         countersigned_at = v_now,
         countersigned_by = p_user_id,
         countersigned_by_email = left(p_user_email, 320),
         countersigner_name = v_name,
         countersigner_title = v_title,
         countersign_typed_signature = v_sig,
         countersign_ip = left(p_ip, 100),
         countersign_user_agent = left(p_user_agent, 400),
         countersign_record_sha256 = encode(sha256(convert_to(v_record::text, 'UTF8')), 'hex')
   where id = a.id;
  perform set_config('geega.partner_signing', '', true);

  -- The agreement is in effect: an approved applicant goes live at the fee
  -- they signed for.
  if v_partner.status = 'applied' then
    update public.partners
       set status = 'active', approved_at = coalesce(approved_at, v_now), fee_percent = a.fee_percent
     where id = v_partner.id;
    v_activated := true;
  end if;

  return jsonb_build_object('partnerId', v_partner.id, 'kind', a.kind, 'activated', v_activated);
end;
$$;

revoke all on function public.partner_create_agreement(uuid, text, integer, text, text, numeric, text[], text, text, timestamptz, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.partner_sign_agreement(uuid, text, text, text, jsonb, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.partner_countersign_agreement(uuid, text, text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.partner_create_agreement(uuid, text, integer, text, text, numeric, text[], text, text, timestamptz, uuid, text, boolean) to service_role;
grant execute on function public.partner_sign_agreement(uuid, text, text, text, jsonb, text, text, text, text, text, text, text) to service_role;
grant execute on function public.partner_countersign_agreement(uuid, text, text, text, uuid, text, text, text) to service_role;

-- ------------------------------------------------------------ version 1 links still open

-- Partners who were sent version 1 of the Referral Partner Agreement and
-- haven't signed get version 2 instead (Partners page: "Approve & send
-- agreement" again).
update public.partner_agreements
   set status = 'void', voided_at = now(), void_reason = 'Replaced by version 2 of the Referral Partner Agreement. Send the new version.'
 where kind = 'referrer' and version_number < 2 and status = 'pending';
