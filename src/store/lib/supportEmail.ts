// The storefront's support address. Its own module so a page can show it
// without importing StaticPages (and with it the home page's code: pages load
// on demand, src/store/lib/lazyPage.tsx).
export const SUPPORT_EMAIL =
  (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) ?? "support@geega-games.com";
