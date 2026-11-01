// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterProvider } from "../src/store/lib/router";
import TradeInPage from "../src/store/pages/TradeInPage";
import { ADVERTISED_TRADE_TERMS, advertisedMismatches } from "../src/store/lib/tradeAdvertised";
import { TRADE_IN_PATH } from "../src/store/lib/tradeCenter";
import { seoRoutes } from "../src/seo/routes";

// The trade-in landing page (/trade-in-magic-cards) is what search engines
// read about trading: it's prerendered, so the rate must be in the markup
// before any terms load, and it must be reachable from the site's static
// links.

vi.mock("../src/store/lib/tradeCenterApi", () => ({ useTradeTerms: () => null }));

afterEach(() => cleanup());

describe("the trade-in landing page", () => {
  it("states the advertised rate and minimums with no terms loaded (as prerendered)", () => {
    const html = renderToStaticMarkup(
      <RouterProvider initialPath={TRADE_IN_PATH}>
        <TradeInPage />
      </RouterProvider>,
    );
    const rate = ADVERTISED_TRADE_TERMS.creditRatePercent;
    expect(html).toContain(`Trade in your Magic cards for ${rate}% of TCG low in store credit`);
    expect(html).toContain(`${rate}% of TCG low`);
    expect(html).toContain("$10 or more each");
    expect(html).toContain("Trades start at <strong>$125</strong>");
    // 80% of $125 needs $156.25 of their cards.
    expect(html).toContain("$156.25");
    expect(html).not.toContain("a set share");
    expect(html).not.toContain("a set percentage");
  });

  it("links on to the shop, the trade cart and the sell page", () => {
    window.history.replaceState({}, "", TRADE_IN_PATH);
    render(
      <RouterProvider>
        <TradeInPage />
      </RouterProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("80% of TCG low in store credit");
    expect(screen.getAllByRole("link", { name: "Open my trade cart" })[0]).toHaveAttribute("href", "/trade-cards");
    expect(screen.getByRole("link", { name: "Pick the cards you want" })).toHaveAttribute("href", "/shop");
    expect(screen.getAllByRole("link", { name: "Get a free offer" })[0]).toHaveAttribute("href", "/sell-my-collection");
    expect(screen.getByRole("heading", { level: 2, name: "Frequently asked questions" })).toBeInTheDocument();
  });

  it("is prerendered and in the sitemap, and /sell no longer is", () => {
    const paths = seoRoutes().map((r) => r.path);
    expect(paths).toContain(TRADE_IN_PATH);
    expect(paths).not.toContain("/sell");
  });
});

describe("the advertised trade terms", () => {
  it("match when the settings are the same, and name each value that differs", () => {
    expect(advertisedMismatches(ADVERTISED_TRADE_TERMS)).toEqual([]);
    expect(advertisedMismatches({ ...ADVERTISED_TRADE_TERMS, creditRatePercent: 75, localMinTradeValueCents: 0 })).toEqual([
      "creditRatePercent: site says 80, settings say 75",
      "localMinTradeValueCents: site says 10000, settings say 0",
    ]);
  });
});
