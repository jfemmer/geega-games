-- Photo requests: a shopper asks to see the actual copy of a listed card
-- (the storefront shows stock images). Submitted from a card page via
-- POST /api/photo-requests; staff take the photo from the admin Inventory →
-- Photo requests tab, and /api/admin/photo-requests/:id emails it to the
-- shopper as an attachment.
--
-- Same lockdown as referral_leads: no anon/authenticated writes at all —
-- every insert/update goes through the API with the service_role key — and
-- only staff can read. Staff photos live in the private
-- photo-request-photos bucket (paths are stored here; bytes stay in Storage).
--
-- Also adds the 'photo_request' kind to staff push notifications (web push
-- and the iPhone app), keeping every kind that already exists, and turns it
-- on for devices that already have notifications enabled (owner asked for
-- photo-request notifications).

create sequence if not exists public.photo_request_reference_seq start with 1001;

create table if not exists public.photo_requests (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique
    default ('GG-P-' || nextval('public.photo_request_reference_seq')::text),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The listing asked about. Kept as a snapshot below too, so the request
  -- still makes sense if the listing is later deleted.
  inventory_item_id uuid references public.inventory_items (id) on delete set null,
  card_name text not null check (char_length(card_name) between 1 and 200),
  set_code text check (set_code is null or char_length(set_code) <= 20),
  set_name text check (set_name is null or char_length(set_name) <= 200),
  collector_number text check (collector_number is null or char_length(collector_number) <= 20),
  condition text check (condition is null or char_length(condition) <= 10),
  finish text check (finish is null or char_length(finish) <= 20),
  card_path text check (card_path is null or char_length(card_path) <= 300),
  first_name text not null check (char_length(first_name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 320),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'new'
    check (status in ('new', 'sent', 'closed')),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 12),
  staff_message text check (staff_message is null or char_length(staff_message) <= 1000),
  sent_at timestamptz,
  sent_by uuid references auth.users (id) on delete set null,
  send_count integer not null default 0 check (send_count >= 0),
  closed_at timestamptz
);

comment on table public.photo_requests is
  'Shopper requests for a photo of the actual copy of a listed card. Written only by /api/photo-requests and /api/admin/photo-requests/:id (service_role); staff read-only via RLS.';

create index if not exists photo_requests_status_created_at_idx
  on public.photo_requests (status, created_at desc);
create index if not exists photo_requests_email_created_at_idx
  on public.photo_requests (email, created_at desc);
create index if not exists photo_requests_inventory_item_id_idx
  on public.photo_requests (inventory_item_id);

drop trigger if exists photo_requests_set_updated_at on public.photo_requests;
create trigger photo_requests_set_updated_at
  before update on public.photo_requests
  for each row execute function public.tg_set_updated_at();

alter table public.photo_requests enable row level security;

drop policy if exists photo_requests_staff_select on public.photo_requests;
create policy photo_requests_staff_select
  on public.photo_requests for select to authenticated
  using ((select public.is_staff()));

revoke all on public.photo_requests from anon, authenticated;
grant select on public.photo_requests to authenticated;
revoke all on sequence public.photo_request_reference_seq from anon, authenticated;

-- Private bucket for the photos staff take. Uploads use signed upload URLs
-- minted by the API; staff can read (to preview) through their session.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photo-request-photos',
  'photo-request-photos',
  false,
  10485760, -- 10 MB per photo (the admin app downsizes before upload)
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'photo_request_photos_staff_read'
  ) then
    create policy photo_request_photos_staff_read
      on storage.objects for select to authenticated
      using (bucket_id = 'photo-request-photos' and (select public.is_staff()));
  end if;
end$$;

-- Push notification kinds: everything that exists today plus photo_request.
alter table public.staff_push_subscriptions
  drop constraint if exists staff_push_subscriptions_kinds_check;
alter table public.staff_push_subscriptions
  add constraint staff_push_subscriptions_kinds_check
  check (kinds <@ array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup', 'photo_request']::text[]);
alter table public.staff_push_subscriptions
  alter column kinds set default array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup', 'photo_request']::text[];
update public.staff_push_subscriptions
  set kinds = array_append(kinds, 'photo_request'), updated_at = now()
  where not ('photo_request' = any (kinds));

do $$
begin
  if to_regclass('public.staff_apns_devices') is not null then
    alter table public.staff_apns_devices
      drop constraint if exists staff_apns_devices_kinds_check;
    alter table public.staff_apns_devices
      add constraint staff_apns_devices_kinds_check
      check (kinds <@ array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup', 'photo_request']::text[]);
    alter table public.staff_apns_devices
      alter column kinds set default array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup', 'photo_request']::text[];
    update public.staff_apns_devices
      set kinds = array_append(kinds, 'photo_request'), updated_at = now()
      where not ('photo_request' = any (kinds));
  end if;
end$$;
