-- Follow-up round of get_advisors findings, all behavior-preserving:
--
-- 1) admin_search_inventory had the same current_user bug already fixed
--    elsewhere this session: inside a SECURITY DEFINER function,
--    current_user is the function OWNER, never the caller, so
--    `current_user <> 'service_role'` is always true and that half of the
--    check is dead code. Not exploitable today (this RPC is only ever
--    called from the browser as the logged-in staff user, never with the
--    service-role key), but a real bug: a legitimate future service-role
--    caller would be wrongly rejected. Switched to auth.role().
--
-- 2) admin_inventory_set_codes was EXECUTE-granted to `anon` and `PUBLIC`
--    (every other admin_* RPC is authenticated-only). The function already
--    self-gates via inventory_write_authorized() in its WHERE clause (a
--    non-staff caller gets zero rows back, not an error), so this was not
--    exploitable, but there's no reason an unauthenticated visitor should
--    even be able to invoke a staff-only RPC. Revoked to match every
--    sibling function.
--
-- 3) card_printings had two permissive SELECT policies for `authenticated`
--    (card_printings_public_read: true, and card_printings_staff_write:
--    FOR ALL ... is_staff()), so every read evaluated both. Since the
--    public-read policy already unconditionally allows SELECT, the
--    is_staff() check never actually restricted a read. Split the ALL
--    policy into insert/update/delete so SELECT is only ever evaluated
--    once, with identical effective permissions.

create or replace function public.admin_search_inventory(
  p_query text default null,
  p_status text default 'all',
  p_stock text default 'all',
  p_condition text default 'all',
  p_finish text default 'all',
  p_set_code text default 'all',
  p_sort text default 'updated',
  p_sort_dir text default 'desc',
  p_low_stock_threshold integer default 2,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table(
  id uuid, scryfall_id uuid, oracle_id uuid, set_code text, collector_number text,
  card_name text, set_name text, rarity text, type_line text, colors text[],
  creature_types text[], image_url text, condition card_condition, finish card_finish,
  foil boolean, variant_type text, quantity integer, price_cents integer,
  cost_cents integer, scryfall_price_cents integer, storage_location text, sku text,
  notes text, status inventory_status, created_at timestamptz, updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_staff() and auth.role() <> 'service_role' then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  return query
  with filtered as (
    select i.* from public.inventory_items i
    where
      (p_query is null or p_query = ''
        or i.card_name ilike '%' || p_query || '%'
        or i.set_name  ilike '%' || p_query || '%'
        or i.set_code  ilike '%' || p_query || '%'
        or coalesce(i.sku,'') ilike '%' || p_query || '%')
      and (p_status = 'all' or i.status::text = p_status)
      and (
        p_stock = 'all'
        or (p_stock = 'out' and i.quantity = 0)
        or (p_stock = 'in'  and i.quantity > 0)
        or (p_stock = 'low' and i.quantity > 0 and i.quantity <= greatest(0, p_low_stock_threshold))
      )
      and (p_condition = 'all' or i.condition::text = p_condition)
      and (p_finish = 'all' or i.finish::text = p_finish)
      and (p_set_code = 'all' or i.set_code = p_set_code)
  ),
  counted as (select count(*) as n from filtered)
  select
    f.id, f.scryfall_id, f.oracle_id, f.set_code, f.collector_number,
    f.card_name, f.set_name, f.rarity, f.type_line, f.colors, f.creature_types,
    f.image_url, f.condition, f.finish, f.foil, f.variant_type, f.quantity,
    f.price_cents, f.cost_cents, f.scryfall_price_cents, f.storage_location,
    f.sku, f.notes, f.status, f.created_at, f.updated_at, c.n as total_count
  from filtered f cross join counted c
  order by
    case when p_sort = 'name'     and p_sort_dir = 'asc'  then f.card_name end asc nulls last,
    case when p_sort = 'name'     and p_sort_dir = 'desc' then f.card_name end desc nulls last,
    case when p_sort = 'quantity' and p_sort_dir = 'asc'  then f.quantity end asc nulls last,
    case when p_sort = 'quantity' and p_sort_dir = 'desc' then f.quantity end desc nulls last,
    case when p_sort = 'price'    and p_sort_dir = 'asc'  then f.price_cents end asc nulls last,
    case when p_sort = 'price'    and p_sort_dir = 'desc' then f.price_cents end desc nulls last,
    case when p_sort = 'updated'  and p_sort_dir = 'asc'  then f.updated_at end asc nulls last,
    case when p_sort = 'updated'  and p_sort_dir = 'desc' then f.updated_at end desc nulls last,
    f.updated_at desc, f.id asc
  limit greatest(1, least(coalesce(p_limit, 25), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

revoke execute on function public.admin_inventory_set_codes() from public;
revoke execute on function public.admin_inventory_set_codes() from anon;

drop policy if exists card_printings_staff_write on public.card_printings;

create policy card_printings_staff_insert on public.card_printings
  for insert to authenticated
  with check (is_staff());

create policy card_printings_staff_update on public.card_printings
  for update to authenticated
  using (is_staff())
  with check (is_staff());

create policy card_printings_staff_delete on public.card_printings
  for delete to authenticated
  using (is_staff());
