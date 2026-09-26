-- Native push for the "Geega Admin" iPhone app (docs/IOS_APP.md).
--
-- One row per iPhone/iPad that turned notifications on in the app: its APNs
-- device token (lowercase hex) and which kinds of events it wants — the same
-- kinds as staff_push_subscriptions (the web push table). Written and read
-- only by the API with the service_role key (api/admin/native-push.ts
-- registers devices, api/_lib/staffPush.ts sends through api/_lib/apns.ts),
-- so there is no grant or policy for anon/authenticated at all.

create table if not exists public.staff_apns_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{32,400}$'),
  kinds text[] not null
    default array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup']::text[]
    check (kinds <@ array['order', 'buying_lead', 'partner_lead', 'signup', 'offer_response', 'pickup']::text[]),
  device_name text check (device_name is null or char_length(device_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz
);

comment on table public.staff_apns_devices is
  'Geega Admin iPhone app push devices (APNs tokens), one per device. service_role only (api/admin/native-push.ts, api/_lib/staffPush.ts).';

create index if not exists staff_apns_devices_user_id_idx
  on public.staff_apns_devices (user_id);

alter table public.staff_apns_devices enable row level security;
revoke all on public.staff_apns_devices from anon, authenticated;
