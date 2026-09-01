/**
 * /cards — The storefront. Server Component that reads filters from the URL,
 * queries server-side (RLS-protected, paginated), and streams results with a
 * skeleton fallback. Filters/search/sort are Client Components that write to the
 * URL; this page re-renders on navigation.
 */
import { Suspense } from 'react';
import type { Metadata } from 'next';
import {
  parseInventoryFilters,
  type InventoryFilters,
} from '@/features/inventory/search-params';
import {
  searchInventory,
  getInventoryFacets,
} from '@/features/inventory/queries';
import { CardGrid, CardGridSkeleton } from '@/components/cards/CardGrid';
import { SearchBox } from '@/components/cards/SearchBox';
import { SortSelect } from '@/components/cards/SortSelect';
import { FilterSidebar } from '@/components/cards/FilterSidebar';
import { Pagination } from '@/components/cards/Pagination';

export const metadata: Metadata = {
  title: 'Browse Magic Singles',
  description:
    'Search and filter our Magic: The Gathering singles inventory by set, color, rarity, condition, finish, and price.',
  alternates: { canonical: '/cards' },
};

type SearchParams = Record<string, string | string[] | undefined>;

// Results are dynamic (depend on live inventory); revalidate briefly for cache.
export const revalidate = 30;

async function Results({ filters }: { filters: InventoryFilters }) {
  const { cards, totalCount, page, totalPages } = await searchInventory(filters);
  return (
    <>
      <p className="mb-4 text-sm text-neutral-500">
        {totalCount.toLocaleString()} {totalCount === 1 ? 'card' : 'cards'}
      </p>
      <CardGrid cards={cards} />
      <Pagination page={page} totalPages={totalPages} searchParams={filtersToRaw(filters)} />
    </>
  );
}

// Rebuild a raw searchParams object for Pagination hrefs from parsed filters.
function filtersToRaw(f: InventoryFilters): SearchParams {
  const raw: SearchParams = {};
  if (f.q) raw.q = f.q;
  if (f.sets.length) raw.sets = f.sets.join(',');
  if (f.colors.length) raw.colors = f.colors.join(',');
  if (f.rarities.length) raw.rarities = f.rarities.join(',');
  if (f.conditions.length) raw.conditions = f.conditions.join(',');
  if (f.finishes.length) raw.finishes = f.finishes.join(',');
  if (f.creatureTypes.length) raw.types = f.creatureTypes.join(',');
  if (f.minPriceCents != null) raw.min = String(f.minPriceCents / 100);
  if (f.maxPriceCents != null) raw.max = String(f.maxPriceCents / 100);
  if (f.sort !== 'name_asc') raw.sort = f.sort;
  return raw;
}

export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filters = parseInventoryFilters(sp);
  const facets = await getInventoryFacets();

  // A stable key so Suspense shows the skeleton on every filter change.
  const suspenseKey = JSON.stringify(filters);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900 sm:text-3xl">
          Magic Singles
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Every card is a real, in-stock item priced individually.
        </p>
      </header>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchBox initialValue={filters.q} />
        </div>
        <SortSelect value={filters.sort} />
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        <FilterSidebar facets={facets} />
        <div className="min-w-0 flex-1">
          <Suspense key={suspenseKey} fallback={<CardGridSkeleton />}>
            <Results filters={filters} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
