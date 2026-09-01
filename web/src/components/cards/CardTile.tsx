/**
 * CardTile.tsx — A single inventory card in the grid. The card art is the hero;
 * chrome stays quiet. Server Component (no interactivity beyond the link).
 */
import Link from 'next/link';
import Image from 'next/image';
import { formatCents } from '@/lib/domain/pricing';
import { CONDITION_LABELS } from '@/lib/domain/enums';
import type { InventoryCard } from '@/features/inventory/queries';

const COLOR_DOT: Record<string, string> = {
  W: 'bg-amber-100 ring-amber-300',
  U: 'bg-sky-200 ring-sky-400',
  B: 'bg-neutral-700 ring-neutral-900',
  R: 'bg-red-300 ring-red-500',
  G: 'bg-green-300 ring-green-500',
  C: 'bg-neutral-200 ring-neutral-400',
};

export function CardTile({ card }: { card: InventoryCard }) {
  const price = formatCents(card.price_cents);
  const lowStock = card.quantity > 0 && card.quantity <= 2;

  return (
    <Link
      href={`/cards/${card.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white transition hover:border-brand-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <div className="relative aspect-[63/88] bg-neutral-100">
        {card.image_url ? (
          <Image
            src={card.image_url}
            alt={card.card_name}
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 220px"
            className="object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-neutral-400">
            {card.card_name}
          </div>
        )}
        {card.finish !== 'nonfoil' && (
          <span className="absolute left-2 top-2 rounded-full bg-gradient-to-r from-fuchsia-500 to-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow">
            {card.finish}
          </span>
        )}
        {lowStock && (
          <span className="absolute right-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
            {card.quantity} left
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-neutral-900">
          {card.card_name}
        </h3>
        <p className="text-xs text-neutral-500">
          {card.set_name ?? card.set_code.toUpperCase()} · #{card.collector_number}
        </p>
        <div className="mt-auto flex items-center justify-between pt-2">
          <div className="flex items-center gap-1.5">
            <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
              {CONDITION_LABELS[card.condition]}
            </span>
            {card.colors.length > 0 && (
              <span className="flex gap-0.5" aria-hidden>
                {card.colors.map((c) => (
                  <span
                    key={c}
                    className={`h-2.5 w-2.5 rounded-full ring-1 ${COLOR_DOT[c] ?? 'bg-neutral-200 ring-neutral-400'}`}
                  />
                ))}
              </span>
            )}
          </div>
          <span className="text-sm font-bold text-brand-700">{price}</span>
        </div>
      </div>
    </Link>
  );
}
