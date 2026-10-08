// Scryfall card-image URL helpers. Pure string work (no network, no browser
// APIs, no Supabase client), so the storefront, the build-time prerender and
// the server-side catalog pages (api/catalog-page.ts) can all share them.
// src/cards.ts re-exports these for the storefront's existing imports.

// ---------------------------------------------------------------------------
// Scryfall image-quality upgrade (storefront display)
//
// Scryfall serves the same artwork at several sizes on its image CDN, where the
// SIZE is a path segment, e.g.:
//   https://cards.scryfall.io/normal/front/a/b/<uuid>.jpg?1660000000
//   https://cards.scryfall.io/large/front/a/b/<uuid>.jpg?1660000000
// Legacy inventory rows may have a `/small/` or `/normal/` URL saved in
// image_url (older code stored `normal`). For a crisp, high-DPI card grid we
// upgrade a recognized Scryfall small/normal URL to its `large` equivalent at
// RENDER time, without any network call or Scryfall lookup — it's a pure string
// rewrite of the size segment on the same CDN host. Non-Scryfall URLs and URLs
// that already point at `large`/`png` are returned unchanged.
// ---------------------------------------------------------------------------

/** Hosts Scryfall serves card images from. */
const SCRYFALL_IMAGE_HOSTS = new Set([
  "cards.scryfall.io",
  "c1.scryfall.com",
  "c2.scryfall.com",
  "c3.scryfall.com",
  "img.scryfall.com",
]);

/** True when a URL is a Scryfall image CDN URL at the given size segment. */
export function isScryfallImageAtSize(url: string, size: string): boolean {
  try {
    const u = new URL(url);
    if (!SCRYFALL_IMAGE_HOSTS.has(u.hostname)) return false;
    return u.pathname.split("/").includes(size);
  } catch {
    return false;
  }
}

/**
 * Rewrite a recognized Scryfall image URL to a different size segment. Returns
 * null when the URL isn't a Scryfall image at a known upgradable size, so the
 * caller can decide whether to keep the original. Pure; no network.
 */
export function scryfallImageAtSize(
  url: string | null | undefined,
  target: "small" | "normal" | "large",
): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!SCRYFALL_IMAGE_HOSTS.has(u.hostname)) return null;
    const parts = u.pathname.split("/");
    // The first non-empty path segment is the size (small/normal/large/png/...).
    const idx = parts.findIndex((p) =>
      ["small", "normal", "large", "png", "art_crop", "border_crop"].includes(p),
    );
    if (idx === -1) return null;
    // Only upgrade the JPG size tiers; leave png/art_crop/border_crop alone.
    if (!["small", "normal", "large"].includes(parts[idx])) return null;
    parts[idx] = target;
    u.pathname = parts.join("/");
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * The best storefront display URL for a stored image_url. Upgrades a Scryfall
 * `small`/`normal` CDN URL to `large`; leaves `large`, `png`, and any
 * non-Scryfall URL untouched. Never returns null when given a non-empty URL.
 */
export function storefrontImageUrl(url: string | null): string | null {
  if (!url) return null;
  if (isScryfallImageAtSize(url, "small") || isScryfallImageAtSize(url, "normal")) {
    return scryfallImageAtSize(url, "large") ?? url;
  }
  return url;
}

/**
 * A responsive srcSet for a Scryfall image (normal 488w + large 672w), or null
 * when the URL isn't a Scryfall image we can size (so the caller omits srcSet
 * rather than emitting fake entries pointing at the same file).
 */
export function scryfallSrcSet(url: string | null): string | null {
  if (!url) return null;
  const normal = scryfallImageAtSize(url, "normal");
  const large = scryfallImageAtSize(url, "large");
  if (!normal || !large) return null;
  // Scryfall's documented widths: normal = 488px, large = 672px.
  return `${normal} 488w, ${large} 672w`;
}

/** How wide a card page draws its main picture, for choosing a size from the srcSet. */
export const CARD_HERO_SIZES = "(max-width: 640px) 80vw, 360px";

/**
 * A card page's main picture, exactly as its <img> asks for it
 * (CardDetailPage). The server names the same files in the page's HTML
 * (api/_lib/catalogPage.ts) so the browser starts fetching the picture while
 * the app is still loading; if the two asked for different files, the early
 * fetch would be wasted. Null when there's no picture.
 */
export function cardHeroImage(imageUrl: string | null): { src: string; srcSet: string | null } | null {
  if (!imageUrl) return null;
  return { src: storefrontImageUrl(imageUrl) ?? imageUrl, srcSet: scryfallSrcSet(imageUrl) };
}
