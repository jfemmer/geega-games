// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { TradeView } from "../src/store/lib/trades";

// The customer's trade page (/trade?t=…), from the link staff text or email
// after confirming a trade: every card on both sides with its price, and
// how it adds up, exactly as saved. Never indexed.

const route = vi.hoisted(() => ({ query: new URLSearchParams() }));
vi.mock("../src/store/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useRouter: () => ({ path: "/trade", query: route.query, navigate: () => {} }),
  matchRoute: () => null,
}));

const { default: TradeSummaryPage } = await import("../src/store/pages/TradeSummaryPage");

const TOKEN = "Abc_def-123".padEnd(32, "x");

function trade(overrides: Partial<TradeView> = {}): TradeView {
  return {
    tradeNumber: 1001,
    createdAt: "2026-10-24T17:00:00.000Z",
    customerName: "Sam Rivera",
    creditPercent: 70,
    theirCards: [
      {
        name: "Rhystic Study",
        quantity: 1,
        tcgLowCents: 3000,
        printing: {
          scryfallId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          setName: "Prophecy",
          setCode: "pcy",
          collectorNumber: "45",
          condition: "MP",
          finish: "nonfoil",
        },
      },
      { name: null, quantity: 2, tcgLowCents: 500, printing: null },
    ],
    yourCards: [
      {
        cardName: "Sol Ring",
        setName: "Commander Legends",
        setCode: "cmr",
        collectorNumber: "263",
        condition: "NM",
        finish: "nonfoil",
        variantType: null,
        quantity: 1,
        priceCents: 1000,
      },
      {
        cardName: "Arcane Signet",
        setName: null,
        setCode: "cmr",
        collectorNumber: "297",
        condition: "LP",
        finish: "foil",
        variantType: "Artist Proof",
        quantity: 2,
        priceCents: 1000,
      },
    ],
    theirTcgLowCents: 4000,
    creditCents: 2800,
    yourCardsCents: 3000,
    balanceCents: -200,
    ...overrides,
  };
}

const fetchMock = vi.fn();

function answer(status: number, body: unknown) {
  fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

beforeEach(() => {
  route.query = new URLSearchParams({ t: TOKEN });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the customer's trade page", () => {
  it("shows every card and price, and what it comes to", async () => {
    answer(200, { ok: true, trade: trade() });
    render(<TradeSummaryPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Trade #1001" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/trade?t=${TOKEN}`, expect.objectContaining({ cache: "no-store" }));
    expect(screen.getByText("Hi Sam, here's every card and price in your trade with Geega Games.")).toBeInTheDocument();

    const bottom = screen.getByRole("region", { name: "What it comes to" });
    expect(bottom).toHaveTextContent("You pay$2.00$28.00 trade credit − $30.00 for our cards");

    const traded = screen.getByRole("region", { name: /You traded in/ });
    expect(within(traded).getByText("3 cards")).toBeInTheDocument();
    const [study, unnamed] = within(traded).getAllByRole("listitem");
    expect(study).toHaveTextContent("Rhystic Study$30.00Prophecy · #45 · Moderately Played · TCG low1 × $30.00");
    expect(unnamed).toHaveTextContent("Card 2$10.00TCG low2 × $5.00");
    expect(within(traded).getByText("TCG low total").nextElementSibling).toHaveTextContent("$40.00");
    expect(within(traded).getByText("Trade credit at 70%").nextElementSibling).toHaveTextContent("$28.00");

    const got = screen.getByRole("region", { name: /You got/ });
    const [sol, signet] = within(got).getAllByRole("listitem");
    expect(sol).toHaveTextContent("Sol Ring$10.00Commander Legends · #263 · Near Mint1 × $10.00");
    expect(signet).toHaveTextContent("Arcane Signet$20.00CMR · #297 · Lightly Played · Foil · Artist Proof2 × $10.00");
    expect(within(got).getByText("At our regular website prices").nextElementSibling).toHaveTextContent("$30.00");

    expect(screen.getByText(/sale and deal prices don't apply to trades/)).toBeInTheDocument();
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    // Nothing about how to reach the customer is on the page.
    expect(document.body).not.toHaveTextContent(/@example\.com|314-555/);
  });

  it("says when the trade leaves them credit, or comes out even", async () => {
    answer(200, { ok: true, trade: trade({ yourCards: [], yourCardsCents: 0, balanceCents: 2800 }) });
    const first = render(<TradeSummaryPage />);
    const bottom = await screen.findByRole("region", { name: "What it comes to" });
    expect(bottom).toHaveTextContent("Trade credit left for you$28.00");
    expect(within(screen.getByRole("region", { name: /You got/ })).getByText("No cards.")).toBeInTheDocument();
    first.unmount();

    answer(200, { ok: true, trade: trade({ yourCardsCents: 2800, balanceCents: 0 }) });
    render(<TradeSummaryPage />);
    expect(await screen.findByRole("region", { name: "What it comes to" })).toHaveTextContent("Even trade$0.00");
  });

  it("says when the link doesn't lead to a trade", async () => {
    answer(404, { ok: false, message: "We couldn't find that trade. Check the link, or ask us to send it again." });
    render(<TradeSummaryPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't find that trade. Check the link, or ask us to send it again.");
  });

  it("doesn't ask the server about a link that's been cut short", async () => {
    route.query = new URLSearchParams({ t: "abc" });
    render(<TradeSummaryPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't find that trade.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says when it can't reach the server", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<TradeSummaryPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reach the server. Check your connection and try again.");
  });
});
