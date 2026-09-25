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

/**
 * Storefront color buckets, matched server-side by
 * public.mtg_matches_color_groups. A single color means mono-colored (exactly
 * that color); Multicolor is any 2+ colors; Colorless excludes lands; Land
 * means a colorless land. Named combinations use `combo:<letters>` values —
 * see COLOR_COMBOS / colorComboValue.
 */
export type ColorGroup =
  | "white"
  | "blue"
  | "black"
  | "red"
  | "green"
  | "multicolor"
  | "colorless"
  | "land";

export const COLOR_GROUPS: { value: ColorGroup; label: string }[] = [
  { value: "white", label: "White" },
  { value: "blue", label: "Blue" },
  { value: "black", label: "Black" },
  { value: "red", label: "Red" },
  { value: "green", label: "Green" },
  { value: "multicolor", label: "Multicolor" },
  { value: "colorless", label: "Colorless" },
  { value: "land", label: "Land" },
];

export type ColorLetter = "W" | "U" | "B" | "R" | "G";

/** Filter-dot class suffix for each mana letter (see .gg-color-dot-*). */
export const COLOR_LETTER_GROUP: Record<ColorLetter, ColorGroup> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

/**
 * Named multicolor combinations, in the conventional display order: guilds,
 * then shards, wedges, four-color, five-color. `colors` is in WUBRG order for
 * display; matching is on the exact color set, order-independent.
 */
export const COLOR_COMBOS: { name: string; colors: ColorLetter[] }[] = [
  // Allied guilds
  { name: "Azorius", colors: ["W", "U"] },
  { name: "Dimir", colors: ["U", "B"] },
  { name: "Rakdos", colors: ["B", "R"] },
  { name: "Gruul", colors: ["R", "G"] },
  { name: "Selesnya", colors: ["G", "W"] },
  // Enemy guilds
  { name: "Orzhov", colors: ["W", "B"] },
  { name: "Izzet", colors: ["U", "R"] },
  { name: "Golgari", colors: ["B", "G"] },
  { name: "Boros", colors: ["R", "W"] },
  { name: "Simic", colors: ["G", "U"] },
  // Shards
  { name: "Esper", colors: ["W", "U", "B"] },
  { name: "Grixis", colors: ["U", "B", "R"] },
  { name: "Jund", colors: ["B", "R", "G"] },
  { name: "Naya", colors: ["R", "G", "W"] },
  { name: "Bant", colors: ["G", "W", "U"] },
  // Wedges
  { name: "Abzan", colors: ["W", "B", "G"] },
  { name: "Jeskai", colors: ["U", "R", "W"] },
  { name: "Sultai", colors: ["B", "G", "U"] },
  { name: "Mardu", colors: ["R", "W", "B"] },
  { name: "Temur", colors: ["G", "U", "R"] },
  // Four-color
  { name: "Glint-Eye (no White)", colors: ["U", "B", "R", "G"] },
  { name: "Dune-Brood (no Blue)", colors: ["W", "B", "R", "G"] },
  { name: "Ink-Treader (no Black)", colors: ["W", "U", "R", "G"] },
  { name: "Witch-Maw (no Red)", colors: ["W", "U", "B", "G"] },
  { name: "Yore-Tiller (no Green)", colors: ["W", "U", "B", "R"] },
  // Five-color
  { name: "Five-Color", colors: ["W", "U", "B", "R", "G"] },
];

/** Canonical key for a color set: letters sorted alphabetically ("UB" -> "BU"). */
export function colorComboKey(colors: readonly string[]): string {
  return [...colors].map((c) => c.toUpperCase()).sort().join("");
}

/** Filter value sent in p_color_groups for a named combination. */
export function colorComboValue(colors: readonly string[]): string {
  return `combo:${colorComboKey(colors)}`;
}

export type CatalogFilters = {
  query: string;
  sets: string[];
  rarities: string[];
  conditions: string[];
  colorGroups: string[];
  cardTypes: string[];
  creatureTypes: string[];
  minPriceCents: number | null;
  maxPriceCents: number | null;
  dealsOnly: boolean;
  sort: CatalogSort;
};

export type CatalogCard = {
  id: string;
  oracleId: string | null;
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
  isDeal: boolean;
  originalPriceCents: number | null;
  dealDiscountPercent: number | null;
  dealSource: "manual" | "aged_inventory" | "flawed" | null;
  /** Customer-facing explanation of the deal (the specific flaw, for dealSource "flawed"). */
  dealNote: string | null;
  /** "Artist Proof", "Special Edition", a custom label, or null for a standard copy. */
  variantType: string | null;
};

export const PAGE_SIZE = 24;

export const DEFAULT_FILTERS: CatalogFilters = {
  query: "",
  sets: [],
  rarities: [],
  conditions: [],
  colorGroups: [],
  cardTypes: [],
  creatureTypes: [],
  minPriceCents: null,
  maxPriceCents: null,
  dealsOnly: false,
  sort: "name_asc",
};

/** Multi-select filter keys rendered as checkbox groups. */
export type CatalogListFilterKey =
  | "sets"
  | "rarities"
  | "conditions"
  | "colorGroups"
  | "cardTypes"
  | "creatureTypes";

/** Number of user-applied filters (search text, sort and deals mode excluded). */
export function countActiveFilters(filters: CatalogFilters): number {
  return (
    filters.sets.length +
    filters.rarities.length +
    filters.conditions.length +
    filters.colorGroups.length +
    filters.cardTypes.length +
    filters.creatureTypes.length +
    (filters.minPriceCents != null ? 1 : 0) +
    (filters.maxPriceCents != null ? 1 : 0)
  );
}

type SearchRow = {
  id: string;
  oracle_id?: string | null;
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
  original_price_cents?: number | null;
  deal_discount_percent?: number | null;
  deal_source?: string | null;
  deal_note?: string | null;
  variant_type?: string | null;
};

function mapRow(row: SearchRow): CatalogCard {
  return {
    id: row.id,
    oracleId: row.oracle_id ?? null,
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
    isDeal: row.original_price_cents != null,
    originalPriceCents: row.original_price_cents ?? null,
    dealDiscountPercent: row.deal_discount_percent ?? null,
    dealSource:
      row.deal_source === "manual" ||
      row.deal_source === "aged_inventory" ||
      row.deal_source === "flawed"
        ? row.deal_source
        : null,
    dealNote: row.deal_note ?? null,
    variantType: row.variant_type || null,
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
  // Guards against out-of-order responses: if a newer call to run() starts
  // before an older one's response comes back (e.g. a slow request for an
  // earlier search term resolving after a faster, more recent one), the
  // stale response is discarded instead of overwriting fresher results.
  const requestRef = useRef(0);

  // Serialize filters for a stable effect dependency + debounce key.
  const key = useMemo(() => JSON.stringify({ filters, page }), [filters, page]);

  const run = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError("The catalog isn’t configured yet. Please try again later.");
      setLoading(false);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const commonArgs = {
        p_query: filters.query.trim() || undefined,
        p_sets: filters.sets.length ? filters.sets : undefined,
        p_rarities: filters.rarities.length ? filters.rarities : undefined,
        p_conditions: filters.conditions.length
          ? (filters.conditions as ("NM" | "LP" | "MP" | "HP" | "DMG")[])
          : undefined,
        p_color_groups: filters.colorGroups.length ? filters.colorGroups : undefined,
        p_card_types: filters.cardTypes.length ? filters.cardTypes : undefined,
        p_creature_types: filters.creatureTypes.length
          ? filters.creatureTypes
          : undefined,
        p_min_price_cents: filters.minPriceCents ?? undefined,
        p_max_price_cents: filters.maxPriceCents ?? undefined,
        p_sort: filters.sort,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      };

      const response = filters.dealsOnly
        ? await supabase.rpc("search_deals", commonArgs)
        : await supabase.rpc("search_inventory", {
            ...commonArgs,
            p_in_stock_only: true,
          });
      if (requestId !== requestRef.current) return; // a newer request already landed
      if (response.error) throw new Error(response.error.message);
      const rows = (response.data ?? []) as unknown as SearchRow[];
      setCards(rows.map(mapRow));
      setTotal(rows.length ? (rows[0].total_count ?? 0) : 0);
    } catch (err) {
      if (requestId !== requestRef.current) return; // a newer request already landed
      setError(
        err instanceof Error ? err.message : "Could not load the catalog.",
      );
      setCards([]);
      setTotal(0);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
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

export type FacetSet = { code: string; name: string };

export type Facets = {
  sets: FacetSet[];
  rarities: string[];
  cardTypes: string[];
  /** Exact multicolor sets in stock, as colorComboKey() strings ("BU", "BRU"). */
  colorCombos: string[];
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
          sets: FacetSet[] | null;
          rarities: string[] | null;
          card_types: string[] | null;
          color_combos: string[] | null;
          creature_types: string[] | null;
          price_min_cents: number | null;
          price_max_cents: number | null;
        };
        setFacets({
          sets: f.sets ?? [],
          rarities: f.rarities ?? [],
          cardTypes: f.card_types ?? [],
          colorCombos: f.color_combos ?? [],
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
