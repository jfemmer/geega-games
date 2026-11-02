import { StrictMode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Storefront, preloadAllPages, routeModuleFor } from "./App";

export { routeModuleFor };
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

/**
 * Pages load on demand (src/store/lib/lazyPage.tsx), and renderToStaticMarkup
 * can't wait for code to load, so every page is loaded before any is rendered.
 * scripts/prerender.ts awaits this before calling renderPage.
 */
export const pagesReady: Promise<void> = preloadAllPages();

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
