-- admin_upsert_inventory always wrote reason='manual_add', which is correct
-- for the Add Inventory drawer but wrong for the scanner commit path (Part 13
-- requires scan_add / batch_scan_add movements). Add an optional p_reason
-- (named-arg only; every existing caller uses named args, so this default
-- preserves current behavior with zero call-site changes) rather than
-- reimplementing this function's atomic create-or-increment (`for update`
-- row lock) logic separately for scans, which would risk a second, divergent
-- race-prone code path doing the same thing.
CREATE OR REPLACE FUNCTION public.admin_upsert_inventory(
  p_scryfall_id uuid,
  p_oracle_id uuid,
  p_card_name text,
  p_set_code text,
  p_set_name text,
  p_collector_number text,
  p_rarity text,
  p_type_line text,
  p_image_url text,
  p_condition card_condition,
  p_finish card_finish,
  p_quantity integer,
  p_price_cents integer,
  p_cost_cents integer DEFAULT NULL::integer,
  p_scryfall_price_cents integer DEFAULT NULL::integer,
  p_storage_location text DEFAULT NULL::text,
  p_sku text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_variant_type text DEFAULT ''::text,
  p_language text DEFAULT 'en'::text,
  p_colors text[] DEFAULT '{}'::text[],
  p_creature_types text[] DEFAULT '{}'::text[],
  p_actor text DEFAULT NULL::text,
  p_reason inventory_movement_reason DEFAULT 'manual_add'::inventory_movement_reason
)
 RETURNS inventory_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.inventory_items;
  v_prev integer;
begin
  if not public.inventory_write_authorized() then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1';
  end if;

  select * into v_row
  from public.inventory_items i
  where i.status = 'active'
    and i.condition = p_condition
    and i.finish = p_finish
    and coalesce(i.variant_type, '') = coalesce(p_variant_type, '')
    and coalesce(i.language, 'en') = coalesce(p_language, 'en')
    and (
      (p_scryfall_id is not null and i.scryfall_id = p_scryfall_id)
      or (p_scryfall_id is null and i.scryfall_id is null
          and i.set_code = p_set_code
          and i.collector_number = p_collector_number)
    )
  limit 1
  for update;

  if found then
    v_prev := v_row.quantity;
    update public.inventory_items
      set quantity = quantity + p_quantity,
          price_cents = coalesce(price_cents, p_price_cents),
          image_url = coalesce(image_url, p_image_url),
          scryfall_price_cents = coalesce(p_scryfall_price_cents, scryfall_price_cents)
      where id = v_row.id
      returning * into v_row;
  else
    insert into public.inventory_items (
      scryfall_id, oracle_id, card_name, set_code, set_name, collector_number,
      rarity, type_line, image_url, condition, finish, quantity, price_cents,
      cost_cents, scryfall_price_cents, storage_location, sku, notes,
      variant_type, language, colors, creature_types, status
    ) values (
      p_scryfall_id, p_oracle_id, p_card_name, p_set_code, p_set_name,
      p_collector_number, p_rarity, p_type_line, p_image_url, p_condition,
      p_finish, p_quantity, p_price_cents, p_cost_cents, p_scryfall_price_cents,
      p_storage_location, p_sku, p_notes, coalesce(p_variant_type, ''),
      coalesce(p_language, 'en'), coalesce(p_colors, '{}'),
      coalesce(p_creature_types, '{}'), 'active'
    )
    returning * into v_row;
    v_prev := 0;
  end if;

  insert into public.inventory_movements (
    inventory_item_id, card_name, delta, previous_quantity, resulting_quantity,
    reason, actor
  ) values (
    v_row.id, v_row.card_name, p_quantity, v_prev, v_row.quantity, p_reason, p_actor
  );
  return v_row;
end;
$function$;

-- One-round-trip counts for the scan review queue's filter tabs (mirrors the
-- inventory_facets pattern) instead of 9 separate count queries per page view.
-- plpgsql (not sql) so a non-staff caller gets a real 42501 error, matching
-- every sibling admin RPC, rather than a silently-folded all-zero row.
CREATE OR REPLACE FUNCTION public.scan_filter_counts(p_session_id uuid)
 RETURNS TABLE(
   all_count bigint,
   unreviewed bigint,
   pending_match bigint,
   matched bigint,
   needs_manual_match bigint,
   ready bigint,
   added bigint,
   rejected bigint,
   missing_back bigint,
   error bigint
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_staff() then
    raise exception 'Staff access required' using errcode = '42501';
  end if;

  return query
  select
    count(*) filter (where true),
    count(*) filter (where review_status = 'unreviewed'),
    count(*) filter (where selected_scryfall_id is null and review_status <> 'rejected'),
    count(*) filter (where selected_scryfall_id is not null and review_status = 'matched'),
    count(*) filter (where review_status = 'needs_manual_match'),
    count(*) filter (where review_status = 'ready'),
    count(*) filter (where review_status = 'added'),
    count(*) filter (where review_status = 'rejected'),
    count(*) filter (where back_image_path is null),
    count(*) filter (where review_status = 'error')
  from public.card_scans
  where scan_session_id = p_session_id;
end;
$function$;

revoke all on function public.scan_filter_counts(uuid) from public, anon;
grant execute on function public.scan_filter_counts(uuid) to authenticated;
