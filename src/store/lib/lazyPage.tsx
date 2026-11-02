import { use, type ComponentType } from "react";

// Route-level code splitting without a blank flash.
//
// Every storefront page used to ship in one bundle, so a seller landing on
// /sell-my-collection downloaded the shop, checkout, account, trade center and
// kiosk code too. Each page now loads on its own. Three things about this site
// shape how:
//
//   * Pages arrive as prerendered HTML and the browser mounts with createRoot,
//     which replaces that markup on its first commit. If the page's code
//     weren't loaded yet, that commit would show a Suspense fallback, wiping
//     the visible page for a moment. So src/main.tsx preloads the current
//     route's page (preloadRoute in App.tsx) BEFORE the first render, and
//     scripts/prerender.ts adds a <link rel="modulepreload"> for the page's
//     chunk (from `src`) so the browser fetches it alongside the main bundle.
//   * The build-time prerender renders with renderToStaticMarkup, which can't
//     wait for code, so it loads every page first (preloadAllPages).
//   * The page always renders as ONE component type. Before its code loads it
//     suspends with use(); once loaded it renders the page directly. (Swapping
//     a React.lazy element for the loaded component on a later render would
//     remount the page and lose its state.) A failed load is forgotten, so the
//     next render or navigation tries again instead of failing forever.
//
// Navigating within the app to a page that hasn't loaded yet suspends, which
// the <Suspense> round the routes in App.tsx covers.

type Module<P> = { default: ComponentType<P> };

export type LazyPage<P> = ComponentType<P> & {
  /** Load the page's code. Resolves once; a failed load can be retried. */
  preload: () => Promise<void>;
  /** The page's source module, as Vite's manifest names it (for modulepreload). */
  src: string;
};

export function lazyPage<P extends object>(load: () => Promise<Module<P> | undefined>, src: string): LazyPage<P> {
  let Loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;

  const preload = (): Promise<void> => {
    if (!pending) {
      pending = load()
        .then((mod) => {
          // Vite resolves an import to undefined when its preload failed and
          // src/main.tsx called preventDefault() to reload the tab onto the
          // new deploy. The reload is already under way: wait for it rather
          // than flash an error.
          if (!mod) return new Promise<void>(() => undefined);
          Loaded = mod.default;
        })
        .catch((err: unknown) => {
          pending = null; // let the next render or navigation try again
          throw err;
        });
    }
    return pending;
  };

  function Page(props: P) {
    if (!Loaded) use(preload());
    const Component = Loaded as ComponentType<P>;
    return <Component {...props} />;
  }
  Page.preload = preload;
  Page.src = src;
  return Page;
}
