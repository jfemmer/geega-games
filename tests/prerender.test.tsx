import { describe, expect, it } from "vitest";
import { renderPage } from "../src/prerender";
import { seoRoutes } from "../src/seo/routes";

// Runs in vitest's default node environment — no window, no document — which
// is exactly the build-time prerender's situation. If any storefront page,
// provider or the header/footer starts touching browser globals during
// render, this fails here instead of failing the Vercel build.

describe("build-time prerender", () => {
  it.each(seoRoutes().map((r) => r.path))("renders %s with its own SEO metadata", (path) => {
    const { html, seo } = renderPage(path);
    expect(seo, "page must call useSEO").not.toBeNull();
    expect(seo?.path).toBe(path);
    expect(seo?.noIndex).toBeFalsy();
    expect(seo?.title.length).toBeGreaterThan(10);
    expect(seo?.description.length).toBeGreaterThan(50);
    expect(html).toMatch(/<h1[\s>]/);
    // Real content, not a loading shell — the whole point of prerendering.
    expect(html).toContain('<header class="gg-header"');
    expect(html).toContain('<footer class="footer"');
  });

  it("renders the not-found page for an unknown area or guide, without SEO metadata", () => {
    for (const path of ["/sell-magic-cards/atlantis", "/guides/nope"]) {
      const { html, seo } = renderPage(path);
      expect(seo).toBeNull();
      expect(html).toContain("Page not found");
    }
  });

  it("tells sellers on every referral page that our buying partner buys very competitively", () => {
    for (const path of ["/sell-pokemon-cards", "/sell-one-piece-cards", "/sell-video-games"]) {
      const { html, seo } = renderPage(path);
      expect(html, path).toContain("buys very competitively");
      expect(seo?.description, path).toContain("buys very competitively");
    }
  });

  it("keeps the meetup and ship options on every area page", () => {
    const { html } = renderPage("/sell-magic-cards/kansas-city");
    expect(html).toContain('href="/sell?handoff=local"');
    expect(html).toContain('href="/sell?handoff=ship"');
    expect(html).toContain("Kansas City, MO");
  });
});
