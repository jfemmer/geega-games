import { lazy, type ComponentType } from "react";

// Route-level code splitting without a blank flash.
//
// Every storefront page used to ship in one bundle, so a seller landing on
// /sell-my-collection downloaded the shop, checkout, account, trade center and
// kiosk code too. Each page now loads on its own, but two things about this
// site make plain React.lazy() a poor fit:
//
//   * Pages arrive as prerendered HTML and the browser mounts with createRoot,
//     which replaces that markup on its first commit. If the page's code
//     weren't loaded yet, that commit would show a Suspense fallback, wiping
//     the visible page for a moment. So src/main.tsx preloads the current
//     route's page (preloadRoute in App.tsx) BEFORE the first render, and the
//     prerendered HTML stays on screen until then.
//   * Even with its module already loaded, React.lazy suspends once on first
//     render (an import() promise has no synchronous "done" flag). So once
//     `preload()` has resolved, the wrapper renders the loaded component
//     directly and never suspends. The build-time prerender relies on this
//     too: renderToStaticMarkup can't wait for lazy code, so it preloads every
//     page first (preloadAllPages in App.tsx).
//
// Navigating within the app to a page that hasn't loaded yet still suspends,
// which the <Suspense> round the routes in App.tsx covers.

type Module<P> = { default: ComponentType<P> };

export type LazyPage<P> = ComponentType<P> & {
  /** Load the page's code. Resolves once; safe to call any number of times. */
  preload: () => Promise<void>;
};

export function lazyPage<P extends object>(load: () => Promise<Module<P>>): LazyPage<P> {
  let Loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;

  const preload = () => {
    if (!pending) {
      pending = load().then(
        (mod) => {
          Loaded = mod.default;
        },
        (err: unknown) => {
          // Let a later attempt (the next navigation, or React.lazy) try again.
          pending = null;
          throw err;
        },
      );
    }
    return pending;
  };

  const Lazy = lazy(async () => {
    await preload();
    return { default: Loaded as ComponentType<P> };
  });

  function Page(props: P) {
    const Component = Loaded;
    return Component ? <Component {...props} /> : <Lazy {...props} />;
  }
  Page.preload = preload;
  return Page;
}
