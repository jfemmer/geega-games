// The per-page <head> tags, as data (PageSEO) and as static HTML
// (renderSeoHead). useSEO applies the same tags in the browser; the build-time
// prerender writes them into each page's HTML so they're right before any
// JavaScript runs. Pure module — shared with scripts/prerender.ts.

import { DEFAULT_SEO, SITE_JSON_LD, absoluteUrl } from "./site.js";

export interface PageSEO {
  /** Full <title> text (include the "Geega Games" suffix yourself). */
  title: string;
  description: string;
  /** Path only, e.g. "/sell-my-collection" — combined with the site origin. */
  path: string;
  /**
   * Optional JSON-LD structured data for this page. Pass an array to emit
   * several entities (e.g. [FAQPage, Service]).
   */
  jsonLd?: object | object[];
  /** Set for a page that resolved but shouldn't be indexed. */
  noIndex?: boolean;
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

/**
 * Static head tags for one page. `seo` null = the neutral SPA shell: no
 * canonical and no og:url, because the real page isn't known until the app
 * runs — Google's guidance is to leave the canonical out of the raw HTML
 * rather than ship one that JavaScript later changes.
 */
export function renderSeoHead(
  seo: PageSEO | null,
  opts: { origin?: string; noIndex?: boolean } = {},
): string {
  const title = seo?.title ?? DEFAULT_SEO.title;
  const description = seo?.description ?? DEFAULT_SEO.description;
  const url = seo ? absoluteUrl(seo.path, opts.origin) : null;
  const noIndex = Boolean(seo?.noIndex || opts.noIndex);

  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta name="robots" content="${noIndex ? "noindex, follow" : "index, follow"}" />`,
    url ? `<link rel="canonical" href="${escapeHtml(url)}" />` : "",
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    url ? `<meta property="og:url" content="${escapeHtml(url)}" />` : "",
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<script type="application/ld+json">${jsonForScript(SITE_JSON_LD)}</script>`,
    seo?.jsonLd
      ? `<script type="application/ld+json" ${PAGE_JSON_LD_ATTR}>${jsonForScript(seo.jsonLd)}</script>`
      : "",
  ];
  return tags.filter(Boolean).join("\n    ");
}
