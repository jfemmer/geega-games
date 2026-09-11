import { useEffect, useState } from "react";
import { scryfallRepository } from "../repositories";
import type { CardImageUris, CardPrinting } from "../types";

// Resolve REAL Scryfall data for cards, PREFERRING data the app already has.
//
// This module now resolves and caches the FULL CardPrinting (not just images),
// so consumers can display exact-printing details — treatments (borderless,
// showcase, extended art…), set name, collector number, artist — to verify the
// art matches the intended printing. useCardImages() returns just the image
// URIs (back-compat); useCardPrinting() returns the whole resolved printing.
//
// Architecture (fastest → slowest; stop at the first that yields real data):
//   1. Structured images already on the record (cached card_printings join):
//      used SYNCHRONOUSLY on first render — no effect, no network.
//   2. A real (http) imageUrl stored on the row: synchronous.
//   3. The module-level in-memory cache (printing resolved this session).
//   4. A live high-accuracy Scryfall resolve (id → set/cn → search), scored by
//      set + collector + finish, never a name mismatch. FALLBACK for legacy
//      rows lacking real local data.
//
// Guarantees: one resolution per distinct printing per session; in-flight
// de-duplication; failures cached as null; data-URI placeholders treated as
// "missing" so legacy rows get upgraded to real Scryfall data.

/** A card whose Scryfall data we may need to resolve. */
export interface ResolvableCard {
  scryfallId: string | null;
  setCode: string;
  collectorNumber: string;
  imageUrl: string | null;
  /**
   * Expected name. A set+collector lookup that resolves to a different name is
   * REJECTED rather than showing the wrong card. Optional for back-compat.
   */
  cardName?: string | null;
  /** finish hint (foil/etched/nonfoil) — a resolution tie-breaker. */
  finish?: string | null;
  /**
   * Optional pre-normalized image set already known to the app (e.g. from a
   * cached card_printings row). When it contains a REAL image, used immediately
   * with NO Scryfall lookup. Preferred path.
   */
  images?: CardImageUris | null;
}

// The cache now stores the resolved printing (or null when nothing matched).
// A separate imagesOnly cache holds synchronously-known images that don't have a
// full printing behind them (e.g. a real http imageUrl on the row), so
// useCardImages can still return them without inventing a fake printing.
const printingCache = new Map<string, CardPrinting | null>();
const inflight = new Map<string, Promise<CardPrinting | null>>();

/**
 * Real Scryfall ids are UUIDs. Mock/legacy rows sometimes carry synthetic ids
 * (e.g. "mock_prt_ragavan") that 404 on live Scryfall. Treat anything that isn't
 * a UUID as "no id" so resolution falls back to set+collector.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function usableScryfallId(id: string | null): string | null {
  return id && UUID_RE.test(id) ? id : null;
}

function keyFor(card: ResolvableCard): string {
  const realId =
    card.scryfallId && UUID_RE.test(card.scryfallId) ? card.scryfallId : null;
  return realId
    ? `id:${realId}`
    : `sc:${card.setCode.toLowerCase()}/${card.collectorNumber.toLowerCase()}`;
}

/** A stored image counts as "real" only if it's an http(s) URL. */
function hasRealImage(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

/** Whether a structured image set contains a REAL (http) image at any size. */
function hasStructuredImage(images: CardImageUris | null | undefined): boolean {
  if (!images) return false;
  return (
    hasRealImage(images.small) ||
    hasRealImage(images.normal) ||
    hasRealImage(images.large) ||
    hasRealImage(images.png)
  );
}

/** Extract display image URIs from a resolved printing. */
function toUris(printing: CardPrinting): CardImageUris {
  if (hasStructuredImage(printing.images)) return printing.images;
  const u = printing.imageUrl;
  return { small: u, normal: u, large: u, png: u, artCrop: u };
}

function urisFromUrl(url: string | null): CardImageUris {
  return { small: url, normal: url, large: url, png: url, artCrop: url };
}

/**
 * Best images computable WITHOUT network, synchronously. Returns null when only
 * a live resolve could help. (Does not fabricate a printing.)
 */
function resolveLocalImages(card: ResolvableCard): CardImageUris | null {
  if (hasStructuredImage(card.images)) return card.images!;
  if (hasRealImage(card.imageUrl)) return urisFromUrl(card.imageUrl);
  const cached = printingCache.get(keyFor(card));
  if (cached) return toUris(cached);
  return null;
}

async function resolve(card: ResolvableCard): Promise<CardPrinting | null> {
  const key = keyFor(card);
  if (printingCache.has(key)) return printingCache.get(key) ?? null;
  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    try {
      // One high-accuracy resolver call with EVERY identity signal we have:
      // id + name + set + collector + finish. Server scores candidates by
      // set + collector + finish and never returns a name mismatch.
      const printing = await scryfallRepository.resolveExact({
        scryfallId: usableScryfallId(card.scryfallId),
        cardName: card.cardName ?? null,
        setCode: card.setCode || null,
        collectorNumber: card.collectorNumber || null,
        finish: card.finish ?? null,
      });
      printingCache.set(key, printing ?? null);
      return printing ?? null;
    } catch {
      printingCache.set(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
}

/**
 * Resolve the full CardPrinting for a card. Returns null until resolved (or when
 * nothing matches). Consumers use this to display treatments/art details for
 * verification. Prefers the app's own data before any network call.
 */
export function useCardPrinting(
  card: ResolvableCard | null,
): CardPrinting | null {
  const [printing, setPrinting] = useState<CardPrinting | null>(() => {
    if (!card) return null;
    return printingCache.get(keyFor(card)) ?? null;
  });

  useEffect(() => {
    if (!card) {
      setPrinting(null);
      return;
    }
    const key = keyFor(card);
    const cached = printingCache.get(key);
    if (cached !== undefined) {
      setPrinting(cached);
      // If we only have a cached-null but the row itself has real local images,
      // there's nothing more to resolve; leave as null (no treatments known).
      if (cached) return;
    }

    let alive = true;
    resolve(card).then((p) => {
      if (alive) setPrinting(p);
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
    card?.cardName,
    card?.finish,
  ]);

  return printing;
}

/**
 * Returns the best available image URIs for a card. Uses the row's own real
 * images synchronously on first render; otherwise resolves from Scryfall
 * (cached) and swaps them in. Never returns a data-URI placeholder.
 */
export function useCardImages(card: ResolvableCard | null): CardImageUris | null {
  const [images, setImages] = useState<CardImageUris | null>(() => {
    if (!card) return null;
    return resolveLocalImages(card); // real local images, or null
  });

  useEffect(() => {
    if (!card) {
      setImages(null);
      return;
    }
    const local = resolveLocalImages(card);
    if (local) {
      setImages(local);
      return;
    }

    const key = printingCacheKeyImages(card);
    const cached = printingCache.get(key);
    if (cached !== undefined) {
      setImages(cached ? toUris(cached) : null);
      if (cached) return;
    }

    let alive = true;
    setImages(null); // clean placeholder while resolving
    resolve(card).then((p) => {
      if (alive) setImages(p ? toUris(p) : null);
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
    card?.cardName,
    card?.images,
  ]);

  return images;
}

// Local alias so the images hook and printing hook share the exact same key.
function printingCacheKeyImages(card: ResolvableCard): string {
  return keyFor(card);
}

/** Test/support helper: clear the module-level cache. */
export function __resetCardImageCache(): void {
  printingCache.clear();
  inflight.clear();
}