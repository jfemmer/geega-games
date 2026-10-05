// The per-page <head> tags, as data (PageSEO) and as static HTML
// (renderSeoHead). Three places apply the same tags from the same values:
//   * the build-time prerender (scripts/prerender.ts), for the static pages;
//   * the catalog function (api/catalog-page.ts), for card and set pages; and
//   * useSEO in the browser, as the visitor moves between pages.
// Pure module — no React, no DOM, no import.meta.env.

import { DEFAULT_OG_IMAGE, DEFAULT_SEO, SITE_JSON_LD, absoluteUrl } from "./site.js";

/** The picture shown when a page is shared (Facebook, Discord, iMessage…). */
export interface SeoImage {
  /** Absolute URL. */
  url: string;
  /** Pixel size, when known — lets a preview reserve the space before the image loads. */
  width?: number;
  height?: number;
  alt?: string;
}

export interface PageSEO {
  /** Full <title> text (include the "Geega Games" suffix yourself). */
  title: string;
  description: string;
  /**
   * Path only, e.g. "/sell-my-collection" — combined with the site origin
   * for the canonical URL. Null for a page with no address of its own to
   * claim (the not-found page): no canonical and no og:url are written.
   */
  path: string | null;
  /**
   * Optional JSON-LD structured data for this page. Pass an array to emit
   * several entities (e.g. [FAQPage, Service]).
   */
  jsonLd?: object | object[];
  /** Set for a page that resolved but shouldn't be indexed. */
  noIndex?: boolean;
  /** Share-preview image; the site-wide one (DEFAULT_OG_IMAGE) when omitted. */
  image?: SeoImage;
}

/** Marks page-level JSON-LD so useSEO can replace the prerendered copy instead of duplicating it. */
export const PAGE_JSON_LD_ATTR = "data-page-jsonld";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON for inside a <script> element: "</script>" or "<!--" in a string must not end it early. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Site-ownership codes for Google Search Console / Bing Webmaster Tools (homepage only). */
export interface SiteVerification {
  google?: string;
  bing?: string;
}

/** Verification codes are short tokens; anything else is ignored rather than injected. */
function safeToken(value: string | undefined): string | null {
  const v = value?.trim();
  return v && /^[A-Za-z0-9_-]{8,100}$/.test(v) ? v : null;
}

/**
 * The size to state for a share-preview image: both numbers, when both are
 * real pixel counts (positive whole numbers), otherwise none at all. The
 * server and the browser both ask here, so they write the same tags.
 */
export function imageSize(image: SeoImage): { width: number; height: number } | null {
  const real = (value: number | undefined): value is number =>
    typeof value === "number" && Number.isInteger(value) && value > 0;
  return real(image.width) && real(image.height) ? { width: image.width, height: image.height } : null;
}

/**
 * Static head tags for one page. `seo` null = the neutral SPA shell: no
 * canonical and no og:url, because the real page isn't known until the app
 * runs — Google's guidance is to leave the canonical out of the raw HTML
 * rather than ship one that JavaScript later changes.
 */
export function renderSeoHead(
  seo: PageSEO | null,
  opts: { origin?: string; noIndex?: boolean; verification?: SiteVerification } = {},
): string {
  const title = seo?.title ?? DEFAULT_SEO.title;
  const description = seo?.description ?? DEFAULT_SEO.description;
  const url = seo && seo.path !== null ? absoluteUrl(seo.path, opts.origin) : null;
  const noIndex = Boolean(seo?.noIndex || opts.noIndex);
  const image = seo?.image ?? DEFAULT_OG_IMAGE;
  const size = imageSize(image);

  const google = safeToken(opts.verification?.google);
  const bing = safeToken(opts.verification?.bing);

  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    google ? `<meta name="google-site-verification" content="${google}" />` : "",
    bing ? `<meta name="msvalidate.01" content="${bing}" />` : "",
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta name="robots" content="${noIndex ? "noindex, follow" : "index, follow"}" />`,
    url ? `<link rel="canonical" href="${escapeHtml(url)}" />` : "",
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    url ? `<meta property="og:url" content="${escapeHtml(url)}" />` : "",
    `<meta property="og:image" content="${escapeHtml(image.url)}" />`,
    size ? `<meta property="og:image:width" content="${size.width}" />` : "",
    size ? `<meta property="og:image:height" content="${size.height}" />` : "",
    image.alt ? `<meta property="og:image:alt" content="${escapeHtml(image.alt)}" />` : "",
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image.url)}" />`,
    `<script type="application/ld+json">${jsonForScript(SITE_JSON_LD)}</script>`,
    seo?.jsonLd
      ? `<script type="application/ld+json" ${PAGE_JSON_LD_ATTR}>${jsonForScript(seo.jsonLd)}</script>`
      : "",
  ];
  return tags.filter(Boolean).join("\n    ");
}
