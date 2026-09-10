import { useEffect, useState } from "react";
import { scryfallRepository } from "../repositories";
import type { CardImageUris, CardPrinting } from "../types";

// Resolve REAL Scryfall imagery for cards that don't already carry it.
//
// Inventory rows created before the Scryfall integration only have a stored
// `imageUrl` (often a placeholder) and no scryfall_id. This hook resolves the
// exact printing on demand — preferring scryfall_id, falling back to
// set code + collector number — and returns normalized CardImageUris.
//
// Correctness/perf guarantees:
//   * One resolution per distinct printing for the whole app session
//     (module-level cache), so a table of 50 rows with duplicates barely hits
//     the network.
//   * In-flight de-duplication: concurrent callers for the same key await the
//     same promise instead of firing parallel requests (respects Scryfall's
//     rate limits).
//   * Never re-fetches a key that already resolved (or resolved to null).
//   * Placeholder/data-URI images are treated as "missing" so legacy rows get
//     upgraded to real art.

/** A card whose image we may need to resolve. */
export interface ResolvableCard {
  scryfallId: string | null;
  setCode: string;
  collectorNumber: string;
  imageUrl: string | null;
}

const cache = new Map<string, CardImageUris | null>();
const inflight = new Map<string, Promise<CardImageUris | null>>();

function keyFor(card: ResolvableCard): string {
  return card.scryfallId
    ? `id:${card.scryfallId}`
    : `sc:${card.setCode.toLowerCase()}/${card.collectorNumber.toLowerCase()}`;
}

/**
 * A stored image counts as "real" only if it's an http(s) URL. Placeholder
 * data-URIs (the mock purple cards) and empty values are treated as missing so
 * the row gets enriched.
 */
function hasRealImage(url: string | null): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

function toUris(printing: CardPrinting): CardImageUris {
  // Prefer the printing's structured images; fall back to its single imageUrl.
  if (
    printing.images &&
    (printing.images.small ||
      printing.images.normal ||
      printing.images.large)
  ) {
    return printing.images;
  }
  const u = printing.imageUrl;
  return { small: u, normal: u, large: u, png: u, artCrop: u };
}

async function resolve(card: ResolvableCard): Promise<CardImageUris | null> {
  const key = keyFor(card);
  if (cache.has(key)) return cache.get(key) ?? null;
  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    try {
      const printing = card.scryfallId
        ? await scryfallRepository.getByScryfallId(card.scryfallId)
        : await scryfallRepository.getBySetAndCollector(
            card.setCode,
            card.collectorNumber,
          );
      const uris = printing ? toUris(printing) : null;
      cache.set(key, uris);
      return uris;
    } catch {
      // Cache the failure as null so we don't hammer a bad lookup every render.
      cache.set(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
}

/**
 * Returns the best available images for a card:
 *   - if the card already has a real (http) image, uses it immediately,
 *   - otherwise resolves from Scryfall (cached) and returns them when ready.
 * While resolving, returns whatever the card already had (possibly a
 * placeholder) so the UI never flashes empty.
 */
export function useCardImages(card: ResolvableCard | null): CardImageUris | null {
  const stored: CardImageUris | null = card
    ? {
        small: card.imageUrl,
        normal: card.imageUrl,
        large: card.imageUrl,
        png: card.imageUrl,
        artCrop: card.imageUrl,
      }
    : null;

  const [images, setImages] = useState<CardImageUris | null>(() => {
    if (!card) return null;
    if (hasRealImage(card.imageUrl)) return stored;
    const key = keyFor(card);
    return cache.get(key) ?? stored;
  });

  useEffect(() => {
    if (!card) {
      setImages(null);
      return;
    }
    // Already have real art on the row — nothing to resolve.
    if (hasRealImage(card.imageUrl)) {
      setImages(stored);
      return;
    }
    const key = keyFor(card);
    const cached = cache.get(key);
    if (cached !== undefined) {
      setImages(cached ?? stored);
      return;
    }

    let alive = true;
    // Show whatever we have now, resolve the real image in the background.
    setImages(stored);
    resolve(card).then((uris) => {
      if (alive && uris) setImages(uris);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.scryfallId, card?.setCode, card?.collectorNumber, card?.imageUrl]);

  return images;
}

/** Test/support helper: clear the module-level image cache. */
export function __resetCardImageCache(): void {
  cache.clear();
  inflight.clear();
}