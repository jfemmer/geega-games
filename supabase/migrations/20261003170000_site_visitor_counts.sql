-- Visitor counts for the daily staff digest.
--
-- site_visitor_counts(start, end) returns how many visitors and page views
-- the storefront had in a time window, from site_page_views (see
-- 20260924070000_site_visitor_tracking.sql). A visitor is one anonymous
-- daily id (visitor_hash), the same definition the admin Overview uses, so
-- someone who comes back after the id rotates (midnight UTC) counts again.
--
-- The digest worker (api/staff-digest/process.ts) calls it with the service
-- role; a "count distinct" can't be asked for through the table API. Nobody
-- else may call it: the table itself is closed to anon and authenticated,
-- and the function runs with the caller's rights (security invoker).

create or replace function public.site_visitor_counts(p_start timestamptz, p_end timestamptz)
returns table(visitors bigint, page_views bigint)
language sql
stable
set search_path to 'public'
as $function$
  select count(distinct visitor_hash), count(*)
  from public.site_page_views
  where viewed_at >= p_start and viewed_at < p_end;
$function$;

revoke all on function public.site_visitor_counts(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.site_visitor_counts(timestamptz, timestamptz) to service_role;
