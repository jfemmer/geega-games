import { useEffect, useState } from "react";
import { scryfallRepository } from "../repositories";
import type { CardImageUris, CardPrinting } from "../types";

// Resolve REAL Scryfall imagery for cards, PREFERRING data the app already has.
//
// Architecture (fastest → slowest; we stop at the first that yields real art):
//   1. Structured images already on the record (e.g. from a cached
//      `card_printings` row joined into inventory). Used SYNCHRONOUSLY during
//      the first render — no effect, no network — so the <img> starts loading
//      with the page.
//   2. A real (http) `imageUrl` stored on the row. Also used synchronously.
//   3. The module-level in-memory cache (a printing already resolved this
//      session). Synchronous when present.
//   4. A live Scryfall lookup (getByScryfallId, else set+collector). This is the
//      FALLBACK/RECOVERY path for legacy rows that carry neither structured
//      images nor a real imageUrl — NOT the primary path for normal rows.
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
//     upgraded to real art — but only when no structured images exist.

/** A card whose image we may need to resolve. */
export interface ResolvableCard {
  scryfallId: string | null;
  setCode: string;
  collectorNumber: string;
  imageUrl: string | null;
  /**
   * Optional pre-normalized image set already known to the app (e.g. from a
   * cached card_printings row). When present with any usable size, this is used
   * immediately and NO Scryfall lookup happens. This is the preferred path.
   */
  images?: CardImageUris | null;
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
function hasRealImage(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

/** Whether a structured image set has any usable size. */
function hasStructuredImage(images: CardImageUris | null | undefined): boolean {
  return Boolean(
    images &&
      (images.small || images.normal || images.large || images.png),
  );
}

function toUris(printing: CardPrinting): CardImageUris {
  // Prefer the printing's structured images; fall back to its single imageUrl.
  if (hasStructuredImage(printing.images)) {
    return printing.images;
  }
  const u = printing.imageUrl;
  return { small: u, normal: u, large: u, png: u, artCrop: u };
}

/** Build a CardImageUris from a single stored url (all sizes point at it). */
function urisFromUrl(url: string | null): CardImageUris {
  return { small: url, normal: url, large: url, png: url, artCrop: url };
}

/**
 * Resolve the BEST images we can compute WITHOUT any network, synchronously.
 * Returns null when only a live Scryfall lookup could help (legacy row).
 */
function resolveLocal(card: ResolvableCard): CardImageUris | null {
  // 1. Structured images already on the record — best case.
  if (hasStructuredImage(card.images)) return card.images!;
  // 2. A real stored image url.
  if (hasRealImage(card.imageUrl)) return urisFromUrl(card.imageUrl);
  // 3. Anything already resolved this session for this printing.
  const cached = cache.get(keyFor(card));
  if (hasStructuredImage(cached)) return cached!;
  return null;
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
 *   - if the card already has structured images or a real (http) image, uses
 *     them IMMEDIATELY during the first render (no effect, no network),
 *   - otherwise resolves from Scryfall (cached) and returns them when ready.
 * While resolving a legacy row, returns whatever the card already had (possibly
 * a placeholder) so the UI never flashes empty.
 */
export function useCardImages(card: ResolvableCard | null): CardImageUris | null {
  // Compute the best synchronously-available images for the FIRST render, so a
  // known image starts downloading with the page instead of after an effect.
  const [images, setImages] = useState<CardImageUris | null>(() => {
    if (!card) return null;
    const local = resolveLocal(card);
    if (local) return local;
    // Nothing local yet — seed with whatever placeholder the row carries so the
    // UI isn't empty while the background lookup runs.
    return card.imageUrl ? urisFromUrl(card.imageUrl) : null;
  });

  useEffect(() => {
    if (!card) {
      setImages(null);
      return;
    }
    // Already have real art locally (structured/http/cached) — nothing to do.
    const local = resolveLocal(card);
    if (local) {
      setImages(local);
      return;
    }

    const key = keyFor(card);
    const cached = cache.get(key);
    if (cached !== undefined) {
      setImages(cached ?? (card.imageUrl ? urisFromUrl(card.imageUrl) : null));
      return;
    }

    let alive = true;
    // Show whatever we have now, resolve the real image in the background.
    setImages(card.imageUrl ? urisFromUrl(card.imageUrl) : null);
    resolve(card).then((uris) => {
      if (alive && uris) setImages(uris);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    card?.scryfallId,
    card?.setCode,
    card?.collectorNumber,
    card?.imageUrl,
    // Re-run if the structured images identity changes (e.g. lazy join arrives).
    card?.images,
  ]);

  return images;
}

/** Test/support helper: clear the module-level image cache. */
export function __resetCardImageCache(): void {
  cache.clear();
  inflight.clear();
}