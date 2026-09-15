import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "../../supabase";
import { storefrontImageUrl } from "../../cards";

// Server-backed catalog. Uses the reservation-aware public.search_inventory RPC
// (fixed in migration 20260914000000) which returns SELLABLE quantity and a
// window total_count for pagination. We never download the whole inventory.

export type CatalogSort =
  | "name_asc"
  | "name_desc"
  | "price_asc"
  | "price_desc"
  | "newest";

export type CatalogFilters = {
  query: string;
  sets: string[];
  rarities: string[];
  conditions: string[];
  minPriceCents: number | null;
  maxPriceCents: number | null;
  sort: CatalogSort;
};

export type CatalogCard = {
  id: string;
  name: string;
  set: string | null;
  setName: string | null;
  collectorNumber: string | null;
  type: string | null;
  rarity: string | null;
  /** SELLABLE quantity (physical minus active reservations). */
  quantity: number;
  imageUrl: string | null;
  priceCents: number | null;
  condition: string;
  finish: string;
  foil: boolean;
  scryfallId: string | null;
};

export const PAGE_SIZE = 24;

export const DEFAULT_FILTERS: CatalogFilters = {
  query: "",
  sets: [],
  rarities: [],
  conditions: [],
  minPriceCents: null,
  maxPriceCents: null,
  sort: "name_asc",
};

type SearchRow = {
  id: string;
  scryfall_id: string | null;
  set_code: string | null;
  set_name: string | null;
  collector_number: string | null;
  card_name: string | null;
  rarity: string | null;
  type_line: string | null;
  finish: string | null;
  condition: string | null;
  quantity: number | null;
  price_cents: number | null;
  total_count: number | null;
};

function mapRow(row: SearchRow): CatalogCard {
  return {
    id: row.id,
    name: row.card_name ?? "Unknown card",
    set: row.set_code ?? null,
    setName: row.set_name ?? null,
    collectorNumber: row.collector_number ?? null,
    type: row.type_line ?? null,
    rarity: row.rarity ?? null,
    quantity: row.quantity ?? 0,
    imageUrl: storefrontImageUrl(
      (row as SearchRow & { image_url?: string | null }).image_url ?? null,
    ),
    priceCents: row.price_cents,
    condition: row.condition ?? "NM",
    finish: row.finish ?? "nonfoil",
    foil: !!row.finish && row.finish !== "nonfoil",
    scryfallId: row.scryfall_id ?? null,
  };
}

/**
 * Debounced, paginated catalog search. Returns the current page of cards plus
 * total count and load/error state. `page` is 0-based.
 */
export function useCatalog(filters: CatalogFilters, page: number) {
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  // Serialize filters for a stable effect dependency + debounce key.
  const key = useMemo(() => JSON.stringify({ filters, page }), [filters, page]);

  const run = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError("The catalog isn’t configured yet. Please try again later.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("search_inventory", {
        p_query: filters.query.trim() || undefined,
        p_sets: filters.sets.length ? filters.sets : undefined,
        p_rarities: filters.rarities.length ? filters.rarities : undefined,
        p_conditions: filters.conditions.length
          ? (filters.conditions as SearchRow["condition"][])
          : undefined,
        p_min_price_cents: filters.minPriceCents ?? undefined,
        p_max_price_cents: filters.maxPriceCents ?? undefined,
        p_in_stock_only: true,
        p_sort: filters.sort,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (rpcError) throw new Error(rpcError.message);
      const rows = (data ?? []) as SearchRow[];
      setCards(rows.map(mapRow));
      setTotal(rows.length ? (rows[0].total_count ?? 0) : 0);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load the catalog.",
      );
      setCards([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    // Debounce so typing in search doesn't fire a request per keystroke.
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(run, 300);
    return () => window.clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { cards, total, loading, error, refetch: run };
}

export type Facets = {
  sets: string[];
  rarities: string[];
  creatureTypes: string[];
  priceMinCents: number | null;
  priceMaxCents: number | null;
};

/** Load filter facet options (reservation-aware) once. */
export function useFacets() {
  const [facets, setFacets] = useState<Facets | null>(null);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    supabase
      .rpc("inventory_facets")
      .then(({ data, error }) => {
        if (!active || error || !data || !data[0]) return;
        const f = data[0] as {
          sets: string[] | null;
          rarities: string[] | null;
          creature_types: string[] | null;
          price_min_cents: number | null;
          price_max_cents: number | null;
        };
        setFacets({
          sets: f.sets ?? [],
          rarities: f.rarities ?? [],
          creatureTypes: f.creature_types ?? [],
          priceMinCents: f.price_min_cents,
          priceMaxCents: f.price_max_cents,
        });
      });
    return () => {
      active = false;
    };
  }, []);
  return facets;
}
