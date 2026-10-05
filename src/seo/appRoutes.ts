// How every storefront address is served. There is deliberately no catch-all:
// an address nothing below claims gets a real 404 (dist/404.html), so a
// mistyped or retired URL can't come back "200 OK" looking like the homepage.
//
//   1. Prerendered content pages — src/seo/routes.ts. Static HTML with their
//      own tags; vercel.json rewrites each to its index.html.
//   2. Card and set pages — api/catalog-page.ts fills in their tags per request.
//   3. App-only pages — the list below. Nothing to prerender; vercel.json
//      serves the neutral shell (dist/spa.html) and the app takes over.
//
// The local dev server answers every address, so a page vercel.json doesn't
// name would look fine until it was live. Two things stop that:
//   * the build (scripts/prerender.ts → scripts/vercelRoutes.ts) fails if
//     vercel.json doesn't serve a page listed here or in src/seo/routes.ts; and
//   * tests/vercelRouting.test.ts also reads the route table in src/App.tsx,
//     so a page added there without a rule in vercel.json fails the tests.
// Pure module — no React, no DOM, no import.meta.env.

/** vercel.json `source` patterns served by the neutral shell. */
export const APP_SHELL_ROUTES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/checkout",
  "/track-order",
  "/sell/offer",
  "/kiosk",
  "/account",
  "/account/:path*",
] as const;

/**
 * App-only pages a search engine may index: each sets its own title and
 * canonical once the app runs. Every other shell page is private or has
 * nothing to offer a searcher, and is sent with "X-Robots-Tag: noindex".
 */
export const INDEXABLE_APP_SHELL_ROUTES: readonly string[] = ["/track-order"];

/** Where the catalog function answers, and what it's told about the address. */
export const CATALOG_ROUTES = [
  { source: "/shop/card/:slug", destination: "/api/catalog-page?kind=card&slug=:slug" },
  { source: "/shop/set/:code", destination: "/api/catalog-page?kind=set&code=:code" },
] as const;
