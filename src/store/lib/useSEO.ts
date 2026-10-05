import { useEffect } from "react";
import { SITE } from "../../siteConfig";
import { DEFAULT_OG_IMAGE, DEFAULT_SEO } from "../../seo/site";
import { PAGE_JSON_LD_ATTR, imageSize, type PageSEO, type SeoImage } from "../../seo/head";

// Per-page SEO metadata: <title>, description, canonical, Open Graph/Twitter
// tags (including the share-preview image), robots and page-level JSON-LD.
//
// Three places apply these tags, from the same PageSEO values:
//   * At build time, scripts/prerender.ts renders each route in
//     src/seo/routes.ts to static HTML. useSEO reports the page's metadata to
//     the prerender during that render (see collectSEO), and the script
//     writes the matching tags into that page's HTML.
//   * On the server, api/catalog-page.ts writes them into card and set pages
//     from the same builders those pages pass here (src/seo/catalog.ts).
//   * In the browser, the effect below applies them, so client-side
//     navigation keeps the head in sync with the page on screen.
//
// On unmount the head goes back to the site defaults (not to whatever was
// in the DOM on mount — on a prerendered page that's the page's own values),
// and the canonical/og:url are removed: a page that doesn't call useSEO
// (login, checkout, account…) shouldn't claim another page's canonical URL.

export type { PageSEO };

let collector: ((seo: PageSEO) => void) | null = null;

/**
 * Build-time prerender only: receive the useSEO options of the page being
 * rendered. Pass null to stop collecting. Never used in the browser.
 */
export function collectSEO(fn: ((seo: PageSEO) => void) | null): void {
  collector = fn;
}

function upsertMeta(attr: "name" | "property", key: string, content: string): void {
  let el = document.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function removeMeta(attr: "name" | "property", key: string): void {
  document.querySelector(`meta[${attr}="${key}"]`)?.remove();
}

/** Set a meta tag when there's a value for it; otherwise make sure it's gone. */
function setOrRemoveMeta(attr: "name" | "property", key: string, content: string | null): void {
  if (content) upsertMeta(attr, key, content);
  else removeMeta(attr, key);
}

function setCanonical(url: string | null): void {
  let el = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!url) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("link");
    el.rel = "canonical";
    document.head.appendChild(el);
  }
  el.href = url;
}

function removePageJsonLd(): void {
  document.querySelectorAll(`script[${PAGE_JSON_LD_ATTR}]`).forEach((el) => el.remove());
}

function applyHead(
  title: string,
  description: string,
  url: string | null,
  noIndex: boolean,
  image: SeoImage,
): void {
  document.title = title;
  upsertMeta("name", "description", description);
  upsertMeta("property", "og:title", title);
  upsertMeta("property", "og:description", description);
  upsertMeta("name", "twitter:title", title);
  upsertMeta("name", "twitter:description", description);
  upsertMeta("name", "robots", noIndex ? "noindex, follow" : "index, follow");
  setOrRemoveMeta("property", "og:url", url);
  setCanonical(url);

  const size = imageSize(image);
  upsertMeta("property", "og:image", image.url);
  setOrRemoveMeta("property", "og:image:width", size ? String(size.width) : null);
  setOrRemoveMeta("property", "og:image:height", size ? String(size.height) : null);
  setOrRemoveMeta("property", "og:image:alt", image.alt ?? null);
  upsertMeta("name", "twitter:image", image.url);
}

/**
 * Apply a page's SEO tags.
 *
 * `pending` is for a page whose tags depend on data it is still loading (a
 * card or set page): while it's true the head is left exactly as it is —
 * on a first visit that's the complete set of tags the server already wrote
 * for this page — instead of flashing placeholder values over them.
 */
export function useSEO(seo: PageSEO, opts: { pending?: boolean } = {}): void {
  const pending = Boolean(opts.pending);

  // Render-phase on purpose, and only during the build-time prerender (the
  // collector is always null in the browser): effects never run there. A page
  // that is still pending has nothing final to report.
  if (collector && !pending) collector(seo);

  const { title, description, path, jsonLd, noIndex } = seo;
  const jsonLdText = jsonLd ? JSON.stringify(jsonLd) : "";
  const image = seo.image ?? DEFAULT_OG_IMAGE;
  const { url: imageUrl, width: imageWidth, height: imageHeight, alt: imageAlt } = image;

  useEffect(() => {
    if (!pending) {
      const url = path === null ? null : `${SITE.url.replace(/\/+$/, "")}${path}`;
      applyHead(title, description, url, Boolean(noIndex), {
        url: imageUrl,
        width: imageWidth,
        height: imageHeight,
        alt: imageAlt,
      });

      // Replace (never duplicate) the page JSON-LD already in the HTML — two
      // identical FAQPage blocks is a Search Console error.
      removePageJsonLd();
      if (jsonLdText) {
        const el = document.createElement("script");
        el.type = "application/ld+json";
        el.setAttribute(PAGE_JSON_LD_ATTR, "");
        el.text = jsonLdText;
        document.head.appendChild(el);
      }
    }

    return () => {
      applyHead(DEFAULT_SEO.title, DEFAULT_SEO.description, null, false, DEFAULT_OG_IMAGE);
      removePageJsonLd();
    };
  }, [title, description, path, jsonLdText, noIndex, pending, imageUrl, imageWidth, imageHeight, imageAlt]);
}
