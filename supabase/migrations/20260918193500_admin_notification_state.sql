-- Persist per-staff read/dismiss state for the admin notification bell.
-- Notification CONTENT is derived from live operational tables at request time;
-- this table stores only each staff user's interaction state.

create table if not exists public.admin_notification_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_key text not null,
  read_at timestamptz null,
  dismissed_at timestamptz null,
  updated_at timestamptz not null default now(),
  primary key (user_id, notification_key)
);

create index if not exists admin_notification_state_user_unread_idx
  on public.admin_notification_state (user_id, read_at, dismissed_at);

alter table public.admin_notification_state enable row level security;

-- The browser never reads/writes this table directly. Staff interaction flows
-- through /api/admin/notifications, which verifies requireStaff() and then uses
-- the service-role client. Keep the table out of the exposed anon/authenticated
-- API surface.
revoke all on table public.admin_notification_state from anon, authenticated;

comment on table public.admin_notification_state is
  'Per-staff read/dismiss state for live admin notifications. Notification content itself is derived from orders, inventory, pickup requests, sell submissions, and scan sessions at request time.';
