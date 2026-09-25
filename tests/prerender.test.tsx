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

  it("lists Washington, MO as a St. Louis meetup location, with the nearby safe exchange spot", () => {
    const { html, seo } = renderPage("/sell-magic-cards/st-louis");
    const meetup = html.slice(html.indexOf("Where we meet"));
    expect(meetup).toContain("Washington, MO");
    expect(meetup).toContain("Union (near Washington, MO)");
    expect(meetup).toContain("Chesterfield");
    expect(html).toContain("Do you meet in Washington, MO?");
    expect(JSON.stringify(seo?.jsonLd)).toContain('"name":"Washington"');
  });

  it("offers the quick photo quote and the store-credit bonus on the Magic sell pages", () => {
    for (const path of ["/sell-my-collection", "/sell-magic-cards/st-louis"]) {
      const { html } = renderPage(path);
      expect(html, path).toContain('id="quick-quote"');
      expect(html, path).toContain('class="gg-credit-badge"');
      expect(html, path).toContain("gg-sticky-cta");
      expect(html, path).toContain("What you can count on");
    }
  });

  it("gives each referral page its research section and a phone call-to-action", () => {
    const expected: Record<string, string> = {
      "/sell-pokemon-cards": "Should you get your cards graded before selling?",
      "/sell-one-piece-cards": "One Piece prices move fast",
      "/sell-video-games": "Big-box trade-in vs. a specialist buyer",
    };
    for (const [path, heading] of Object.entries(expected)) {
      const { html } = renderPage(path);
      expect(html, path).toContain(heading);
      expect(html, path).toContain('href="#tell-us"');
    }
  });

  it("groups the guides index by topic and cross-links guides from their topic's sell page", () => {
    const index = renderPage("/guides").html;
    const order = ["Magic: The Gathering", "Pokémon", "Video games"].map((h) =>
      index.indexOf(`<h2>${h}</h2>`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    expect(renderPage("/sell-pokemon-cards").html).toContain(
      'href="/guides/are-my-old-pokemon-cards-worth-anything"',
    );
    expect(renderPage("/sell-video-games").html).toContain(
      'href="/guides/are-my-old-video-games-worth-money"',
    );
  });
});
