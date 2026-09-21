import { useEffect } from "react";
import { SITE } from "../../siteConfig";

// Per-page SEO metadata. This is a client-rendered SPA with ONE static
// index.html, so every route inherits the same <title>/description/OG tags
// unless a page opts into overriding them here — nothing did, before this.
//
// Rather than assume a hardcoded "site default" to restore, this captures
// whatever was actually in the DOM the moment the page mounts (which is
// correct whether that's index.html's real defaults, or another page's
// values if navigation happened client-side without a full reload) and
// restores exactly that on unmount. That makes pages composable in any
// navigation order without needing a single shared "default" constant that
// could drift out of sync with index.html.

interface SEOOptions {
  /** Full <title> text (include the "Geega Games" suffix yourself). */
  title: string;
  description: string;
  /** Path only, e.g. "/sell-my-collection" — combined with SITE.url for canonical/OG. */
  path: string;
  /**
   * Optional JSON-LD structured data (e.g. FAQPage) to inject while this
   * page is mounted. Pass an array to emit multiple entities in one script
   * tag (e.g. [FAQPage, Service]) — Google supports a top-level JSON array
   * the same as a single object.
   */
  jsonLd?: object | object[];
  /**
   * Set true for a page that resolved but shouldn't be indexed (e.g. a
   * card detail page with zero in-stock listings right now). Omit/false
   * for the normal indexable case — index.html's default robots tag
   * already covers that.
   */
  noIndex?: boolean;
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

function readMeta(attr: "name" | "property", key: string): string {
  return document.querySelector(`meta[${attr}="${key}"]`)?.getAttribute("content") ?? "";
}

export function useSEO({ title, description, path, jsonLd, noIndex }: SEOOptions): void {
  const jsonLdKey = jsonLd ? JSON.stringify(jsonLd) : "";

  useEffect(() => {
    const prevTitle = document.title;
    const prevDescription = readMeta("name", "description");
    const prevOgTitle = readMeta("property", "og:title");
    const prevOgDescription = readMeta("property", "og:description");
    const prevOgUrl = readMeta("property", "og:url");
    const prevTwitterTitle = readMeta("name", "twitter:title");
    const prevTwitterDescription = readMeta("name", "twitter:description");
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    const prevCanonical = canonicalEl?.getAttribute("href") ?? "";
    const prevRobots = readMeta("name", "robots");

    const url = `${SITE.url.replace(/\/+$/, "")}${path}`;

    document.title = title;
    upsertMeta("name", "description", description);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:url", url);
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
    if (canonicalEl) canonicalEl.setAttribute("href", url);
    if (noIndex) upsertMeta("name", "robots", "noindex, follow");

    let jsonLdEl: HTMLScriptElement | null = null;
    if (jsonLdKey) {
      jsonLdEl = document.createElement("script");
      jsonLdEl.type = "application/ld+json";
      jsonLdEl.text = jsonLdKey;
      document.head.appendChild(jsonLdEl);
    }

    return () => {
      document.title = prevTitle;
      upsertMeta("name", "description", prevDescription);
      upsertMeta("property", "og:title", prevOgTitle);
      upsertMeta("property", "og:description", prevOgDescription);
      upsertMeta("property", "og:url", prevOgUrl);
      upsertMeta("name", "twitter:title", prevTwitterTitle);
      upsertMeta("name", "twitter:description", prevTwitterDescription);
      if (canonicalEl) canonicalEl.setAttribute("href", prevCanonical);
      if (noIndex) upsertMeta("name", "robots", prevRobots || "index, follow");
      jsonLdEl?.remove();
    };
  }, [title, description, path, jsonLdKey, noIndex]);
}
