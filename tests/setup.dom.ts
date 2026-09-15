// Registers .toBeInTheDocument(), .toHaveValue(), etc. on vitest's `expect`.
import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement window.matchMedia; router.tsx calls it on every
// navigate() to respect prefers-reduced-motion. Polyfill it so DOM-rendering
// tests (`// @vitest-environment jsdom`) don't crash on real app navigation.
// Guarded so this file is also safe to load under the default node
// environment, where `window` doesn't exist.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom also logs a noisy "Not implemented: window.scrollTo()" console error
// for the same navigate() call (router.tsx scrolls to top on route change).
// Stub it to a no-op rather than silence console.error globally.
if (typeof window !== "undefined") {
  window.scrollTo = () => {};
}
