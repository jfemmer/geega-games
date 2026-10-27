-- Visitor insights: count people, not machines; record what visitors search
-- for in the shop; and see which posts bring visitors.
--
-- 1. People, not machines. About a third of recorded visits were machines
--    that load one page and never do anything: Facebook's own servers
--    checking links (several Meta data centers in the same second) and bots
--    running a real browser from server farms. From now on:
--      * /api/track drops requests from Meta's own network (AS32934);
--      * the storefront sends a page view once the visitor scrolls, taps,
--        types or moves the mouse (engaged = true), or when they leave
--        without doing any of that (engaged = false); automated browsers
--        (navigator.webdriver) send nothing.
--    A visit (one anonymous daily id) counts as a person when none of its
--    page views is a known machine (is_bot) and it has an engaged view,
--    more than one page, or was recorded before this change (engaged null).
--    Past visits are marked once, below: Facebook-referred views from Meta's
--    data centers, and one-page visits from outside the US with no referring
--    site (or from Bing).
--
-- 2. Shop searches (site_searches): what visitors type into the shop search
--    and how many cards it found, so searches that found nothing show what
--    people want that isn't in stock. Same privacy rules as page views: no
--    IP, no user id, the same daily-rotating anonymous id; /api/track
--    lower-cases and trims the query, caps it at 80 characters and drops
--    anything that looks like an email address or phone number. Kept 13
--    months, like page views.
--
-- 3. Campaign tags: the utm_source / utm_medium / utm_campaign of the link a
--    visitor arrived on (the admin's "Copy Facebook post link" adds them),
--    stored on the landing page view only.
--
-- admin_site_traffic() now counts people only and adds four keys:
-- filteredVisits (visits left out), searches, missedSearches and campaigns.
-- Referrers now count each visit once, by the site it arrived from (before,
-- a visitor's later pages also counted under "Direct / unknown"). Existing
-- keys keep their shape, so an older admin build keeps working.
-- site_visitor_counts() (the daily staff digest) counts people only too.

begin;

-- ---------------------------------------------------------------------------
-- Page views: engagement, known machines, campaign tags
-- ---------------------------------------------------------------------------

alter table public.site_page_views
  add column if not exists engaged boolean,
  add column if not exists is_bot boolean not null default false,
  add column if not exists utm_source text check (char_length(utm_source) between 1 and 60),
  add column if not exists utm_medium text check (char_length(utm_medium) between 1 and 60),
  add column if not exists utm_campaign text check (char_length(utm_campaign) between 1 and 80);

comment on column public.site_page_views.engaged is
  'true: the visitor scrolled, tapped, typed or moved the mouse on this page; false: they left without doing any of that; null: recorded before engagement was tracked (October 27, 2026).';
comment on column public.site_page_views.is_bot is
  'A known machine, left out of visitor numbers: a past visit marked by 20261027050000_visitor_insights.sql (Meta''s network is dropped by /api/track before anything is stored).';
comment on column public.site_page_views.utm_campaign is
  'The utm_campaign of the link the visitor arrived on (landing page view only).';

-- Past visits from Facebook's servers: Meta data centers, arriving "from"
-- Facebook. Only rows recorded before engagement tracking are touched, so
-- running this again never marks a newer view.
update public.site_page_views
set is_bot = true
where engaged is null
  and not is_bot
  and referrer_host like '%facebook.com'
  and city in ('Prineville', 'Luleå', 'Forest City', 'Altoona', 'Fort Worth', 'Boardman');

-- Past one-page visits from outside the US with no referring site (or from
-- Bing): bots running a browser from server farms. The shop sells and buys
-- in the US only, so nothing a customer did is lost here.
update public.site_page_views p
set is_bot = true
from (
  select date_trunc('day', viewed_at) as day, visitor_hash
  from public.site_page_views
  where engaged is null
  group by 1, 2
  having count(*) = 1
     and bool_and(coalesce(country, '??') <> 'US')
     and bool_and(referrer_host is null or referrer_host = 'bing.com')
) v
where p.engaged is null
  and not p.is_bot
  and date_trunc('day', p.viewed_at) = v.day
  and p.visitor_hash = v.visitor_hash;

-- ---------------------------------------------------------------------------
-- Shop searches
-- ---------------------------------------------------------------------------

create table if not exists public.site_searches (
  id bigint generated always as identity primary key,
  searched_at timestamptz not null default now(),
  visitor_hash text not null check (char_length(visitor_hash) = 32),
  query text not null check (char_length(query) between 2 and 80),
  results integer not null check (results >= 0),
  filtered boolean not null default false,
  deals boolean not null default false,
  device text not null check (device in ('mobile', 'tablet', 'desktop'))
);

comment on table public.site_searches is
  'Anonymous shop searches (query and how many cards it found) for the admin Overview. Written by /api/track with the service role; no IP, cookie or user id.';
comment on column public.site_searches.filtered is
  'Shop filters (set, color, price…) were on, so a search with no results may only have been filtered out.';

create index if not exists site_searches_searched_at_idx on public.site_searches (searched_at);

alter table public.site_searches enable row level security;
revoke all on table public.site_searches from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Visits: one row per anonymous daily id, and whether it was a person
-- ---------------------------------------------------------------------------

create or replace function public.site_visits(p_start timestamptz, p_end timestamptz)
returns table(
  day date,
  visitor_hash text,
  views bigint,
  is_person boolean,
  first_at timestamptz,
  last_at timestamptz,
  referrer_host text,
  utm_source text,
  utm_campaign text,
  device text,
  country text,
  region text,
  city text,
  last_page text
)
language sql
stable
set search_path to 'public'
as $function$
  select
    date_trunc('day', v.viewed_at)::date,
    v.visitor_hash,
    count(*),
    not bool_or(v.is_bot) and (bool_or(coalesce(v.engaged, true)) or count(*) > 1),
    min(v.viewed_at),
    max(v.viewed_at),
    (array_agg(v.referrer_host order by v.viewed_at, v.id))[1],
    (array_agg(v.utm_source order by v.viewed_at, v.id))[1],
    (array_agg(v.utm_campaign order by v.viewed_at, v.id))[1],
    (array_agg(v.device order by v.viewed_at, v.id))[1],
    (array_agg(v.country order by v.viewed_at, v.id))[1],
    (array_agg(v.region order by v.viewed_at, v.id))[1],
    (array_agg(v.city order by v.viewed_at, v.id))[1],
    (array_agg(v.path order by v.viewed_at desc, v.id desc))[1]
  from public.site_page_views v
  where v.viewed_at >= p_start and v.viewed_at < p_end
  group by 1, 2
$function$;

revoke all on function public.site_visits(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.site_visits(timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- The admin Overview's "Website visitors": people only
-- ---------------------------------------------------------------------------

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
  v_filtered bigint;
  v_live bigint;
  v_series jsonb;
  v_pages jsonb;
  v_referrers jsonb;
  v_devices jsonb;
  v_countries jsonb;
  v_cities jsonb;
  v_regions jsonb;
  v_recent jsonb;
  v_searches jsonb;
  v_missed jsonb;
  v_campaigns jsonb;
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

  -- Visitors = visits by people (one per anonymous daily id); machines are
  -- counted apart, as filteredVisits.
  select count(*) filter (where is_person),
         coalesce(sum(views) filter (where is_person), 0),
         count(*) filter (where not is_person)
    into v_visitors, v_views, v_filtered
  from public.site_visits(v_start, v_end);

  select count(*) filter (where is_person),
         coalesce(sum(views) filter (where is_person), 0)
    into v_visitors_prev, v_views_prev
  from public.site_visits(v_prev_start, v_start);

  select count(*) into v_live
  from public.site_visits(v_end - interval '5 minutes', v_end)
  where is_person;

  with days as (
    select generate_series(date_trunc('day', v_start), date_trunc('day', v_end), interval '1 day')::date d
  ), daily as (
    select day as d, count(*) n
    from public.site_visits(v_start, v_end)
    where is_person
    group by day
  )
  select jsonb_agg(jsonb_build_object('date', to_char(days.d, 'YYYY-MM-DD'), 'value', coalesce(daily.n, 0)) order by days.d)
    into v_series
  from days left join daily on daily.d = days.d;

  select coalesce(jsonb_agg(jsonb_build_object('label', path, 'value', n) order by n desc, path), '[]'::jsonb)
    into v_pages
  from (
    select p.path, count(*) n
    from public.site_page_views p
    join public.site_visits(v_start, v_end) s
      on s.is_person
     and s.day = date_trunc('day', p.viewed_at)::date
     and s.visitor_hash = p.visitor_hash
    where p.viewed_at >= v_start and p.viewed_at < v_end
    group by p.path
    order by n desc, p.path
    limit 8
  ) t;

  -- Each visit once, by the site it arrived from.
  select coalesce(jsonb_agg(jsonb_build_object('label', src, 'value', n) order by n desc, src), '[]'::jsonb)
    into v_referrers
  from (
    select coalesce(referrer_host, 'Direct / unknown') src, count(*) n
    from public.site_visits(v_start, v_end)
    where is_person
    group by 1
    order by n desc, src
    limit 6
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('label', initcap(device), 'value', n) order by n desc), '[]'::jsonb)
    into v_devices
  from (
    select device, count(*) n
    from public.site_visits(v_start, v_end)
    where is_person
    group by device
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('label', c, 'value', n) order by n desc, c), '[]'::jsonb)
    into v_countries
  from (
    select coalesce(country, '??') c, count(*) n
    from public.site_visits(v_start, v_end)
    where is_person
    group by 1
    order by n desc, c
    limit 6
  ) t;

  -- Approximate location from Vercel's edge geo-IP headers (the IP itself
  -- is never stored). Unknown locations are left out of these two lists.
  select coalesce(jsonb_agg(jsonb_build_object('city', city, 'region', region, 'country', country, 'value', n)
           order by n desc, city), '[]'::jsonb)
    into v_cities
  from (
    select city, region, country, count(*) n
    from public.site_visits(v_start, v_end)
    where is_person and city is not null
    group by city, region, country
    order by n desc, city
    limit 10
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('region', region, 'country', country, 'value', n)
           order by n desc, region), '[]'::jsonb)
    into v_regions
  from (
    select region, country, count(*) n
    from public.site_visits(v_start, v_end)
    where is_person and region is not null
    group by region, country
    order by n desc, region
    limit 10
  ) t;

  -- The 15 most recently active people (one row per anonymous daily id),
  -- where they are, and what they looked at. Independent of the range.
  select coalesce(jsonb_agg(to_jsonb(t) order by t."lastSeen" desc), '[]'::jsonb)
    into v_recent
  from (
    select
      last_at as "lastSeen",
      city,
      region,
      country,
      device,
      referrer_host as referrer,
      last_page as "lastPage",
      views as pages
    from public.site_visits(v_end - interval '2 days', v_end)
    where is_person
    order by last_at desc
    limit 15
  ) t;

  -- What visitors searched the shop for. A query counts as "not found" when
  -- its most recent search found nothing with no filters on.
  with q as (
    select
      s.query,
      count(*) as times,
      count(distinct s.visitor_hash) as people,
      max(s.searched_at) as last_at,
      (array_agg(s.results order by s.searched_at desc, s.id desc))[1] as results,
      (array_agg(s.filtered order by s.searched_at desc, s.id desc))[1] as filtered
    from public.site_searches s
    where s.searched_at >= v_start and s.searched_at < v_end
    group by s.query
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object('query', query, 'searches', times, 'people', people, 'results', results, 'lastSearchedAt', last_at)
               order by times desc, last_at desc)
      from (select * from q order by times desc, last_at desc limit 10) top
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('query', query, 'searches', times, 'people', people, 'results', results, 'lastSearchedAt', last_at)
               order by times desc, last_at desc)
      from (select * from q where results = 0 and not filtered order by times desc, last_at desc limit 10) missed
    ), '[]'::jsonb)
    into v_searches, v_missed;

  -- Visits that arrived on a tagged link (utm_source / utm_campaign).
  select coalesce(jsonb_agg(jsonb_build_object('source', utm_source, 'campaign', utm_campaign, 'value', n)
           order by n desc, utm_campaign), '[]'::jsonb)
    into v_campaigns
  from (
    select utm_source, utm_campaign, count(*) n
    from public.site_visits(v_start, v_end)
    where is_person and (utm_source is not null or utm_campaign is not null)
    group by utm_source, utm_campaign
    order by n desc, utm_campaign
    limit 10
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
    'recentVisitors', v_recent,
    'filteredVisits', v_filtered,
    'searches', v_searches,
    'missedSearches', v_missed,
    'campaigns', v_campaigns
  );
end;
$function$;

revoke all on function public.admin_site_traffic(text) from public;
grant execute on function public.admin_site_traffic(text) to authenticated, service_role;
-- Supabase's default privileges grant EXECUTE on new public functions to
-- anon directly; the function refuses non-staff anyway (is_staff()).
revoke execute on function public.admin_site_traffic(text) from anon;

-- ---------------------------------------------------------------------------
-- The daily staff digest's visitor counts: people only
-- ---------------------------------------------------------------------------

create or replace function public.site_visitor_counts(p_start timestamptz, p_end timestamptz)
returns table(visitors bigint, page_views bigint)
language sql
stable
set search_path to 'public'
as $function$
  select count(*) filter (where is_person),
         coalesce(sum(views) filter (where is_person), 0)::bigint
  from public.site_visits(p_start, p_end);
$function$;

revoke all on function public.site_visitor_counts(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.site_visitor_counts(timestamptz, timestamptz) to service_role;

-- Keep 13 months of searches, like page views.
select cron.schedule(
  'geega-site-searches-retention',
  '25 4 * * *',
  $cmd$ delete from public.site_searches where searched_at < now() - interval '13 months'; $cmd$
);

commit;
