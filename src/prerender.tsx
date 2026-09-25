import { StrictMode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Storefront } from "./App";
import { SITE } from "./siteConfig";
import { collectSEO, type PageSEO } from "./store/lib/useSEO";

// Server-side entry for the build-time prerender (scripts/prerender.ts).
// Built with `vite build --ssr` so it resolves env vars, CSS imports and
// aliases exactly like the browser bundle, then rendered in Node.
//
// It renders the SAME <Storefront> tree the browser does. The browser still
// mounts with createRoot (not hydrateRoot), which simply replaces this markup
// on load — so a difference in signed-in/cart state can never cause a
// hydration mismatch, and visitors see identical markup before and after.

/** The origin useSEO builds canonical URLs from, so the static HTML matches what the app sets. */
export const siteUrl = SITE.url;

export function renderPage(path: string): { html: string; seo: PageSEO | null } {
  let seo: PageSEO | null = null;
  collectSEO((value) => {
    seo = value;
  });
  try {
    const html = renderToStaticMarkup(
      <StrictMode>
        <Storefront initialPath={path} />
      </StrictMode>,
    );
    return { html, seo: seo as PageSEO | null };
  } finally {
    collectSEO(null);
  }
}
