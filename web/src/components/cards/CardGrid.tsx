/**
 * CardGrid.tsx — Responsive grid of card tiles, with an empty state.
 * Server Component.
 */
import { CardTile } from './CardTile';
import type { InventoryCard } from '@/features/inventory/queries';

export function CardGrid({ cards }: { cards: InventoryCard[] }) {
  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 py-20 text-center">
        <p className="text-lg font-semibold text-neutral-800">No cards match your filters</p>
        <p className="mt-1 max-w-sm text-sm text-neutral-500">
          Try widening your price range, clearing a filter, or searching a
          different card name.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {cards.map((card) => (
        <CardTile key={card.id} card={card} />
      ))}
    </div>
  );
}

/** Skeleton grid shown via Suspense while results stream in. */
export function CardGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-neutral-200">
          <div className="aspect-[63/88] animate-pulse bg-neutral-200" />
          <div className="space-y-2 p-3">
            <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-200" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-200" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-200" />
          </div>
        </div>
      ))}
    </div>
  );
}
