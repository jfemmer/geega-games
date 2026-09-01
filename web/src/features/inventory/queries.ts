/**
 * queries.ts — Server-side data access for inventory (Server Components only).
 *
 * Wraps the search_inventory / inventory_facets RPCs. Runs with the user's
 * session (RLS applies). Returns a page of results plus the total count so the
 * caller can render pagination without a second query.
 */
import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { PAGE_SIZE, type InventoryFilters } from './search-params';
import type { CardCondition, CardFinish } from '@/lib/domain/enums';

export interface InventoryCard {
  id: string;
  scryfall_id: string | null;
  oracle_id: string | null;
  set_code: string;
  collector_number: string;
  card_name: string;
  set_name: string | null;
  rarity: string | null;
  type_line: string | null;
  colors: string[];
  creature_types: string[];
  image_url: string | null;
  condition: CardCondition;
  finish: CardFinish;
  foil: boolean;
  variant_type: string;
  quantity: number;
  price_cents: number | null;
}

export interface InventorySearchResult {
  cards: InventoryCard[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function searchInventory(
  filters: InventoryFilters
): Promise<InventorySearchResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('search_inventory', {
    p_query: filters.q || null,
    p_sets: filters.sets.length ? filters.sets : null,
    p_colors: filters.colors.length ? filters.colors : null,
    p_rarities: filters.rarities.length ? filters.rarities : null,
    p_conditions: filters.conditions.length ? filters.conditions : null,
    p_finishes: filters.finishes.length ? filters.finishes : null,
    p_creature_types: filters.creatureTypes.length ? filters.creatureTypes : null,
    p_min_price_cents: filters.minPriceCents,
    p_max_price_cents: filters.maxPriceCents,
    p_in_stock_only: true,
    p_sort: filters.sort,
    p_limit: PAGE_SIZE,
    p_offset: (filters.page - 1) * PAGE_SIZE,
  });

  if (error) {
    // Surface a clean error; the page renders an error state.
    throw new Error(`Inventory search failed: ${error.message}`);
  }

  const rows = (data ?? []) as (InventoryCard & { total_count: number })[];
  const totalCount = rows[0]?.total_count ?? 0;
  const cards = rows.map(({ total_count: _drop, ...card }) => card);

  return {
    cards,
    totalCount,
    page: filters.page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
  };
}

export interface InventoryFacets {
  sets: string[];
  rarities: string[];
  creatureTypes: string[];
  priceMinCents: number | null;
  priceMaxCents: number | null;
}

export async function getInventoryFacets(): Promise<InventoryFacets> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('inventory_facets');
  if (error || !data || !data.length) {
    return {
      sets: [],
      rarities: [],
      creatureTypes: [],
      priceMinCents: null,
      priceMaxCents: null,
    };
  }
  const f = data[0] as {
    sets: string[] | null;
    rarities: string[] | null;
    creature_types: string[] | null;
    price_min_cents: number | null;
    price_max_cents: number | null;
  };
  return {
    sets: f.sets ?? [],
    rarities: f.rarities ?? [],
    creatureTypes: f.creature_types ?? [],
    priceMinCents: f.price_min_cents,
    priceMaxCents: f.price_max_cents,
  };
}

/** Fetch a single in-stock card by id (for the card detail page). */
export async function getInventoryCard(
  id: string
): Promise<InventoryCard | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('inventory_public')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return data as InventoryCard;
}
