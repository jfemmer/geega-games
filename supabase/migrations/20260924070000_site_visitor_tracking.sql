-- First-party, privacy-friendly visitor tracking for the admin Overview.
--
-- Recording: the storefront sends one beacon per page view to /api/track,
-- which inserts here with the service role. No cookies, no IP addresses and
-- no user ids are stored. A visitor is identified only by visitor_hash, an
-- HMAC of (UTC day, IP, user agent) keyed with a server secret, so it
-- changes every day and can't be traced back to a person or linked across
-- days. Staff, bots, /admin pages, Do Not Track and Global Privacy Control
-- are excluded before anything is sent/stored.
--
-- Reading: admin_site_traffic(range) — staff only — returns everything the
-- Overview's "Website visitors" section shows. Because the visitor id
-- rotates daily, "visitors" over a range is the sum of each day's unique
-- visitors (a returning visitor on two days counts twice).

create table if not exists public.site_page_views (
  id bigint generated always as identity primary key,
  viewed_at timestamptz not null default now(),
  visitor_hash text not null check (char_length(visitor_hash) = 32),
  path text not null check (char_length(path) between 1 and 300),
  referrer_host text check (char_length(referrer_host) <= 255),
  country text check (char_length(country) <= 2),
  device text not null check (device in ('mobile', 'tablet', 'desktop'))
);

create index if not exists site_page_views_viewed_at_idx on public.site_page_views (viewed_at);

alter table public.site_page_views enable row level security;
revoke all on table public.site_page_views from anon, authenticated;

create or replace function public.admin_site_traffic(p_range text default '30d')
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_end timestamptz := now();
  v_start timestamptz;
  v_prev_start timestamptz;
  v_visitors bigint;
  v_visitors_prev bigint;
  v_views bigint;
  v_views_prev bigint;
  v_live bigint;
  v_series jsonb;
  v_pages jsonb;
  v_referrers jsonb;
  v_devices jsonb;
  v_countries jsonb;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  case p_range
    when '7d' then v_start := v_end - interval '7 days';
    when '90d' then v_start := v_end - interval '90 days';
    when 'ytd' then v_start := date_trunc('year', v_end);
    else v_start := v_end - interval '30 days';
  end case;
  v_prev_start := v_start - (v_end - v_start);

  -- Visitors = sum of per-day uniques (the hash rotates daily).
  select coalesce(sum(n), 0) into v_visitors from (
    select count(distinct visitor_hash) n from site_page_views
    where viewed_at >= v_start and viewed_at < v_end
    group by date_trunc('day', viewed_at)) d;
  select coalesce(sum(n), 0) into v_visitors_prev from (
    select count(distinct visitor_hash) n from site_page_views
    where viewed_at >= v_prev_start and viewed_at < v_start
    group by date_trunc('day', viewed_at)) d;

  select count(*) into v_views from site_page_views
    where viewed_at >= v_start and viewed_at < v_end;
  select count(*) into v_views_prev from site_page_views
    where viewed_at >= v_prev_start and viewed_at < v_start;

  select count(distinct visitor_hash) into v_live from site_page_views
    where viewed_at >= v_end - interval '5 minutes';

  with days as (
    select generate_series(date_trunc('day', v_start), date_trunc('day', v_end), interval '1 day')::date d
  ), daily as (
    select date_trunc('day', viewed_at)::date d, count(distinct visitor_hash) n
    from site_page_views
    where viewed_at >= v_start and viewed_at < v_end
    group by 1
  )
  select jsonb_agg(jsonb_build_object('date', to_char(days.d, 'YYYY-MM-DD'), 'value', coalesce(daily.n, 0)) order by days.d)
    into v_series
  from days left join daily on daily.d = days.d;

  select coalesce(jsonb_agg(jsonb_build_object('label', path, 'value', n) order by n desc, path), '[]'::jsonb)
    into v_pages
  from (
    select path, count(*) n from site_page_views
    where viewed_at >= v_start and viewed_at < v_end
    group by path order by n desc, path limit 8
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('label', src, 'value', n) order by n desc, src), '[]'::jsonb)
    into v_referrers
  from (
    select coalesce(referrer_host, 'Direct / unknown') src, count(distinct visitor_hash) n
    from site_page_views
    where viewed_at >= v_start and viewed_at < v_end
    group by 1 order by n desc, src limit 6
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('label', initcap(device), 'value', n) order by n desc), '[]'::jsonb)
    into v_devices
  from (
    select device, count(distinct visitor_hash) n
    from site_page_views
    where viewed_at >= v_start and viewed_at < v_end
    group by device
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('label', c, 'value', n) order by n desc, c), '[]'::jsonb)
    into v_countries
  from (
    select coalesce(country, '??') c, count(distinct visitor_hash) n
    from site_page_views
    where viewed_at >= v_start and viewed_at < v_end
    group by 1 order by n desc, c limit 6
  ) t;

  return jsonb_build_object(
    'visitors', v_visitors,
    'visitorsPrev', v_visitors_prev,
    'pageViews', v_views,
    'pageViewsPrev', v_views_prev,
    'liveNow', v_live,
    'series', coalesce(v_series, '[]'::jsonb),
    'topPages', v_pages,
    'referrers', v_referrers,
    'devices', v_devices,
    'countries', v_countries
  );
end;
$function$;

revoke all on function public.admin_site_traffic(text) from public;
grant execute on function public.admin_site_traffic(text) to authenticated, service_role;

-- Keep 13 months of raw page views (enough for year-over-year), nothing more.
select cron.schedule(
  'geega-site-page-views-retention',
  '20 4 * * *',
  $cmd$ delete from public.site_page_views where viewed_at < now() - interval '13 months'; $cmd$
);
