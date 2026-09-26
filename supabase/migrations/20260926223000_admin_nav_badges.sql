-- Admin number badges: one staff-only call that counts what's waiting in each
-- part of the admin. It feeds the sidebar badges, the badge on the phone menu
-- button and the badge on the installed app's icon (see
-- src/admin/hooks/useNavBadges.ts and api/_lib/staffPush.ts).
--
--   needs_packing        paid orders waiting to be packed           Orders
--   open_photo_requests  card photo requests not answered yet       Inventory
--   waiting_pickups      pickup requests waiting to be pulled       Pickup Requests
--   new_leads            buying leads nobody has reviewed yet       Buying Leads
--   new_partner_leads    partner leads nobody has handled yet       Partner Leads
--   new_users            people who signed up (account, checkout    Users
--                        or newsletter) since this staff member
--                        last opened Users
--
-- "Since you last opened Users" is stored per staff member in
-- staff_section_seen, so it matches on every device they use.

create table if not exists public.staff_section_seen (
  user_id uuid not null references auth.users (id) on delete cascade,
  section text not null check (section in ('users')),
  seen_at timestamptz not null default now(),
  primary key (user_id, section)
);

alter table public.staff_section_seen enable row level security;
-- No policies on purpose: only the security-definer functions below use it.
revoke all on table public.staff_section_seen from anon, authenticated;

create or replace function public.admin_nav_badges(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_seen timestamptz;
begin
  if public.is_staff() then
    -- Staff only ever get their own "new users" count.
    v_user := auth.uid();
  elsif public.staff_or_service_role() then
    -- The server asking on a staff member's behalf (app icon badge in pushes).
    v_user := p_user_id;
  else
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_user is not null then
    select s.seen_at into v_seen
    from public.staff_section_seen s
    where s.user_id = v_user and s.section = 'users';
  end if;

  return jsonb_build_object(
    'needs_packing', (select count(*) from public.orders where status = 'paid'),
    'open_photo_requests', (select count(*) from public.photo_requests where status = 'new'),
    'waiting_pickups', (select count(*) from public.pickup_requests where status = 'waiting'),
    'new_leads', (select count(*) from public.sell_submissions where status = 'new'),
    'new_partner_leads', (select count(*) from public.referral_leads where status = 'new'),
    'new_users', case when v_user is null then 0 else (
      select count(*) from public.customers c
      -- Sign-ups only; customers staff added or imported aren't news.
      where c.source in ('account_signup', 'checkout', 'newsletter')
        -- Never opened Users yet: the last week, not every customer ever.
        and c.created_at > coalesce(v_seen, now() - interval '7 days')
    ) end
  );
end;
$$;

revoke all on function public.admin_nav_badges(uuid) from public, anon;
grant execute on function public.admin_nav_badges(uuid) to authenticated, service_role;

-- Called when a staff member opens Users. Returns their previous visit (or a
-- week ago, the first time) so the page can mark who's new since then.
create or replace function public.admin_mark_section_seen(p_section text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_previous timestamptz;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_section is distinct from 'users' then
    raise exception 'unknown section' using errcode = '22023';
  end if;

  select s.seen_at into v_previous
  from public.staff_section_seen s
  where s.user_id = auth.uid() and s.section = p_section;

  insert into public.staff_section_seen (user_id, section, seen_at)
  values (auth.uid(), p_section, now())
  on conflict (user_id, section) do update set seen_at = excluded.seen_at;

  return coalesce(v_previous, now() - interval '7 days');
end;
$$;

revoke all on function public.admin_mark_section_seen(text) from public, anon;
grant execute on function public.admin_mark_section_seen(text) to authenticated;
