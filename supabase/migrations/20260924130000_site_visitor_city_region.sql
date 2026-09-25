-- Visitor city / state for the admin Overview.
--
-- /api/track now also records the approximate city and state/region that
-- Vercel's edge derives from the visitor's IP (x-vercel-ip-city and
-- x-vercel-ip-country-region). As before, the IP itself is never stored —
-- only these coarse labels, next to the existing country column.
--
-- admin_site_traffic() gains three keys: cities, regions (top 10 each by
-- visitors in the range) and recentVisitors (the 15 most recently active
-- anonymous visitors in the last 2 days: location, device, first external
-- referrer, pages viewed, last page). Existing keys are unchanged, so an
-- older admin build keeps working against it.

alter table public.site_page_views
  add column if not exists region text check (char_length(region) <= 3),
  add column if not exists city text check (char_length(city) <= 100);

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
  v_cities jsonb;
  v_regions jsonb;
  v_recent jsonb;
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

  -- Approximate location from Vercel's edge geo-IP headers (the IP itself
  -- is never stored). Unknown locations are left out of these two lists.
  select coalesce(jsonb_agg(jsonb_build_object('city', city, 'region', region, 'country', country, 'value', n)
           order by n desc, city), '[]'::jsonb)
    into v_cities
  from (
    select city, region, country, count(distinct visitor_hash) n
    from site_page_views
    where viewed_at >= v_start and viewed_at < v_end and city is not null
    group by city, region, country order by n desc, city limit 10
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('region', region, 'country', country, 'value', n)
           order by n desc, region), '[]'::jsonb)
    into v_regions
  from (
    select region, country, count(distinct visitor_hash) n
    from site_page_views
    where viewed_at >= v_start and viewed_at < v_end and region is not null
    group by region, country order by n desc, region limit 10
  ) t;

  -- The 15 most recently active visitors (one row per anonymous daily id),
  -- where they are, and what they looked at. Independent of the range.
  select coalesce(jsonb_agg(to_jsonb(t) order by t."lastSeen" desc), '[]'::jsonb)
    into v_recent
  from (
    select
      max(viewed_at) as "lastSeen",
      (array_agg(city order by viewed_at desc))[1] as city,
      (array_agg(region order by viewed_at desc))[1] as region,
      (array_agg(country order by viewed_at desc))[1] as country,
      (array_agg(device order by viewed_at desc))[1] as device,
      (array_agg(referrer_host order by viewed_at) filter (where referrer_host is not null))[1] as referrer,
      (array_agg(path order by viewed_at desc))[1] as "lastPage",
      count(*) as pages
    from site_page_views
    where viewed_at >= v_end - interval '2 days'
    group by visitor_hash
    order by max(viewed_at) desc
    limit 15
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
    'countries', v_countries,
    'cities', v_cities,
    'regions', v_regions,
    'recentVisitors', v_recent
  );
end;
$function$;

revoke all on function public.admin_site_traffic(text) from public;
grant execute on function public.admin_site_traffic(text) to authenticated, service_role;
-- Supabase's default privileges grant EXECUTE on new public functions to
-- anon directly, so "revoke ... from public" alone doesn't remove it. The
-- function already refuses non-staff (is_staff()), this just closes the door.
revoke execute on function public.admin_site_traffic(text) from anon;
