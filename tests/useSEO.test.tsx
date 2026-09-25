// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useSEO } from "../src/store/lib/useSEO";
import { DEFAULT_SEO } from "../src/seo/site";
import { PAGE_JSON_LD_ATTR, type PageSEO } from "../src/seo/head";

function Page(props: PageSEO) {
  useSEO(props);
  return null;
}

const FAQ = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [] };

function pageJsonLd(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll(`script[${PAGE_JSON_LD_ATTR}]`));
}

afterEach(() => {
  cleanup();
  document.head.innerHTML = "";
});

describe("useSEO", () => {
  it("replaces the prerendered page JSON-LD instead of duplicating it", () => {
    // What scripts/prerender.ts leaves in the head of a prerendered page.
    document.head.innerHTML = `<link rel="canonical" href="https://geega-games.com/sell-my-collection" />
      <script type="application/ld+json" ${PAGE_JSON_LD_ATTR}>${JSON.stringify(FAQ)}</script>`;

    render(<Page title="Sell | Geega Games" description="d" path="/sell-my-collection" jsonLd={FAQ} />);

    expect(pageJsonLd()).toHaveLength(1);
    expect(JSON.parse(pageJsonLd()[0].text)).toEqual(FAQ);
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
  });

  it("sets the page's own tags, then resets to site defaults and drops the canonical on unmount", () => {
    const { unmount } = render(
      <Page title="Kansas City | Geega Games" description="KC" path="/sell-magic-cards/kansas-city" jsonLd={FAQ} />,
    );
    expect(document.title).toBe("Kansas City | Geega Games");
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toMatch(
      /\/sell-magic-cards\/kansas-city$/,
    );
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe("KC");

    unmount();

    // A page without useSEO (login, checkout…) must not keep claiming the
    // previous page's canonical URL or title.
    expect(document.title).toBe(DEFAULT_SEO.title);
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[property="og:url"]')).toBeNull();
    expect(pageJsonLd()).toHaveLength(0);
  });

  it("marks a page noindex only while it's mounted", () => {
    const { unmount } = render(<Page title="t" description="d" path="/shop/card/x" noIndex />);
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, follow");
    unmount();
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("index, follow");
  });
});
