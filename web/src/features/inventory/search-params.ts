/**
 * search-params.ts — URL <-> typed filter state for the storefront.
 *
 * Filters live in the URL so pages are shareable, bookmarkable, back-button
 * friendly, and indexable. This module is the single place that parses and
 * serializes them, with Zod validation so a hand-edited URL can never crash a
 * Server Component or inject bad values into the RPC.
 */
import { z } from 'zod';
import {
  CARD_CONDITIONS,
  CARD_FINISHES,
  type CardCondition,
  type CardFinish,
} from '@/lib/domain/enums';

export const SORT_OPTIONS = [
  'name_asc',
  'name_desc',
  'price_asc',
  'price_desc',
  'newest',
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const SORT_LABELS: Record<SortOption, string> = {
  name_asc: 'Name (A–Z)',
  name_desc: 'Name (Z–A)',
  price_asc: 'Price (low to high)',
  price_desc: 'Price (high to low)',
  newest: 'Newest',
};

export const PAGE_SIZE = 24;

/** Parsed, validated filter state used by the query + UI. */
export interface InventoryFilters {
  q: string;
  sets: string[];
  colors: string[];
  rarities: string[];
  conditions: CardCondition[];
  finishes: CardFinish[];
  creatureTypes: string[];
  minPriceCents: number | null;
  maxPriceCents: number | null;
  sort: SortOption;
  page: number; // 1-based
}

const csv = (v: string | undefined): string[] =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

const intOrNull = (v: string | undefined): number | null => {
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const filtersSchema = z.object({
  q: z.string().max(100).default(''),
  sets: z.array(z.string().max(20)).default([]),
  colors: z.array(z.enum(['W', 'U', 'B', 'R', 'G', 'C'])).default([]),
  rarities: z
    .array(z.enum(['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus']))
    .default([]),
  conditions: z.array(z.enum(CARD_CONDITIONS)).default([]),
  finishes: z.array(z.enum(CARD_FINISHES)).default([]),
  creatureTypes: z.array(z.string().max(40)).default([]),
  minPriceCents: z.number().int().nonnegative().nullable().default(null),
  maxPriceCents: z.number().int().nonnegative().nullable().default(null),
  sort: z.enum(SORT_OPTIONS).default('name_asc'),
  page: z.number().int().positive().default(1),
});

/**
 * Parse Next.js searchParams (Record<string, string | string[]>) into validated
 * filters. Invalid values fall back to defaults rather than throwing.
 */
export function parseInventoryFilters(
  searchParams: Record<string, string | string[] | undefined>
): InventoryFilters {
  const one = (k: string): string | undefined => {
    const v = searchParams[k];
    return Array.isArray(v) ? v[0] : v;
  };

  // dollars in the URL (?min=5) -> cents for the query
  const minDollars = one('min');
  const maxDollars = one('max');

  const raw = {
    q: one('q') ?? '',
    sets: csv(one('sets')),
    colors: csv(one('colors')),
    rarities: csv(one('rarities')),
    conditions: csv(one('conditions')),
    finishes: csv(one('finishes')),
    creatureTypes: csv(one('types')),
    minPriceCents:
      minDollars != null ? Math.round(Number.parseFloat(minDollars) * 100) : null,
    maxPriceCents:
      maxDollars != null ? Math.round(Number.parseFloat(maxDollars) * 100) : null,
    sort: (one('sort') as SortOption) ?? 'name_asc',
    page: intOrNull(one('page')) ?? 1,
  };

  const parsed = filtersSchema.safeParse({
    ...raw,
    minPriceCents: Number.isFinite(raw.minPriceCents as number)
      ? raw.minPriceCents
      : null,
    maxPriceCents: Number.isFinite(raw.maxPriceCents as number)
      ? raw.maxPriceCents
      : null,
  });

  if (parsed.success) return parsed.data;
  // On any validation failure, return safe defaults.
  return filtersSchema.parse({});
}

/**
 * Serialize filters back to a query string (omitting defaults) for building
 * links and pushing to the router.
 */
export function filtersToQueryString(filters: Partial<InventoryFilters>): string {
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  if (filters.sets?.length) p.set('sets', filters.sets.join(','));
  if (filters.colors?.length) p.set('colors', filters.colors.join(','));
  if (filters.rarities?.length) p.set('rarities', filters.rarities.join(','));
  if (filters.conditions?.length) p.set('conditions', filters.conditions.join(','));
  if (filters.finishes?.length) p.set('finishes', filters.finishes.join(','));
  if (filters.creatureTypes?.length) p.set('types', filters.creatureTypes.join(','));
  if (filters.minPriceCents != null) p.set('min', String(filters.minPriceCents / 100));
  if (filters.maxPriceCents != null) p.set('max', String(filters.maxPriceCents / 100));
  if (filters.sort && filters.sort !== 'name_asc') p.set('sort', filters.sort);
  if (filters.page && filters.page > 1) p.set('page', String(filters.page));
  const s = p.toString();
  return s ? `?${s}` : '';
}
