/**
 * /cards/[id] — Single card detail page. Server Component. Indexable, with
 * dynamic Open Graph + Product JSON-LD structured data. 404s if the card is not
 * found or not in stock (RLS + maybeSingle).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import { getInventoryCard } from '@/features/inventory/queries';
import { formatCents } from '@/lib/domain/pricing';
import { CONDITION_LABELS } from '@/lib/domain/enums';
import { AddToCartButton } from '@/components/cart/AddToCartButton';

export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const card = await getInventoryCard(id);
  if (!card) return { title: 'Card not found' };

  const title = `${card.card_name} — ${card.set_name ?? card.set_code.toUpperCase()}`;
  const desc = `${card.card_name} (${card.set_name ?? card.set_code.toUpperCase()} #${card.collector_number}), ${CONDITION_LABELS[card.condition]}${card.finish !== 'nonfoil' ? `, ${card.finish}` : ''} — ${formatCents(card.price_cents)} at Geega Games.`;

  return {
    title,
    description: desc,
    alternates: { canonical: `/cards/${card.id}` },
    openGraph: {
      title,
      description: desc,
      images: card.image_url ? [{ url: card.image_url }] : undefined,
      type: 'website',
    },
  };
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const card = await getInventoryCard(id);
  if (!card) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: card.card_name,
    image: card.image_url ?? undefined,
    sku: card.id,
    category: card.type_line ?? 'Magic: The Gathering Single',
    offers: {
      '@type': 'Offer',
      priceCurrency: 'USD',
      price: card.price_cents != null ? (card.price_cents / 100).toFixed(2) : undefined,
      availability:
        card.quantity > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
    },
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="grid gap-8 md:grid-cols-2">
        <div className="relative mx-auto aspect-[63/88] w-full max-w-sm overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-100">
          {card.image_url ? (
            <Image
              src={card.image_url}
              alt={card.card_name}
              fill
              sizes="(max-width: 768px) 90vw, 400px"
              className="object-cover"
              priority
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-neutral-400">
              {card.card_name}
            </div>
          )}
        </div>

        <div>
          <h1 className="text-2xl font-bold text-neutral-900 sm:text-3xl">
            {card.card_name}
          </h1>
          <p className="mt-1 text-neutral-500">
            {card.set_name ?? card.set_code.toUpperCase()} · #{card.collector_number}
            {card.rarity ? ` · ${card.rarity}` : ''}
          </p>
          {card.type_line && (
            <p className="mt-3 text-sm text-neutral-700">{card.type_line}</p>
          )}

          <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-neutral-500">Condition</dt>
              <dd className="font-medium text-neutral-900">
                {CONDITION_LABELS[card.condition]}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">Finish</dt>
              <dd className="font-medium capitalize text-neutral-900">{card.finish}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Availability</dt>
              <dd className="font-medium text-neutral-900">
                {card.quantity > 0 ? `${card.quantity} in stock` : 'Out of stock'}
              </dd>
            </div>
          </dl>

          <div className="mt-6 flex items-center gap-4">
            <span className="text-3xl font-bold text-brand-700">
              {formatCents(card.price_cents)}
            </span>
          </div>

          <div className="mt-4">
            <AddToCartButton inventoryItemId={card.id} maxQuantity={card.quantity} />
          </div>
        </div>
      </div>
    </main>
  );
}
