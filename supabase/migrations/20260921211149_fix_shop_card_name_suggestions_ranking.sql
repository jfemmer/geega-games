-- Fixes a real bug in the just-applied shop_card_name_suggestions: DISTINCT
-- ON requires its leading ORDER BY expression to match, which forced the
-- final output to sort alphabetically regardless of the intended
-- starts-with-first ranking (the ranking expression could never take effect
-- as anything but a same-group tiebreak). Restructured so DISTINCT and
-- ranking are separate steps.
create or replace function public.shop_card_name_suggestions(p_query text)
returns table(card_name text)
language sql
stable
set search_path to 'public'
as $function$
  with distinct_names as (
    select distinct i.card_name
    from public.inventory_items i
    where i.status = 'active'
      and i.quantity > 0
      and length(trim(coalesce(p_query, ''))) >= 2
      and i.card_name ilike '%' || trim(p_query) || '%'
  )
  select card_name
  from distinct_names
  order by
    (lower(card_name) like lower(trim(p_query)) || '%') desc,
    card_name
  limit 8;
$function$;

revoke all on function public.shop_card_name_suggestions(text) from public;
grant execute on function public.shop_card_name_suggestions(text) to anon, authenticated, service_role;
