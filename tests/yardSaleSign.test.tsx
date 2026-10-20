// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FlyerPrintView, type FlyerJob } from "../src/admin/components/partners/FlyerPrintView";
import { formatSignPrice, pickYardSaleShowcase, yardSaleSignJob } from "../src/admin/utils/yardSaleSign";
import { mapCatalogRow, type CatalogSearchRow } from "../src/store/lib/useCatalog";
import type { YardSaleShowcaseCard } from "../src/admin/types";

// The printed yard sale sign (Yard Sale Mode → Print QR sign, Marketing →
// the yard sale page → Print table sign): a few of the most valuable cards at
// the sale with their yard sale prices, and the QR code for /yard-sale with
// how it works.

function row(id: string, name: string, priceCents: number | null, overrides: Partial<CatalogSearchRow> = {}) {
  return {
    id,
    card_name: name,
    set_code: "set",
    set_name: "A Set",
    collector_number: "1",
    rarity: "mythic",
    type_line: "Artifact",
    finish: "nonfoil",
    condition: "NM",
    quantity: 1,
    price_cents: priceCents,
    total_count: 9,
    scryfall_id: null,
    image_url: `https://cards.scryfall.io/large/front/a/b/${id}.jpg`,
    ...overrides,
  } as CatalogSearchRow;
}

describe("picking the cards to feature", () => {
  // As search_inventory returns them for the sign: most valuable first.
  const rows = [
    row("ring-foil", "The One Ring", 12000, { finish: "foil" }),
    row("no-picture", "Mox Opal", 11000, { image_url: null } as Partial<CatalogSearchRow>),
    row("ring", "the one ring", 9999), // the same card again (names compared ignoring case)
    row("fow", "Force of Will", 9150),
    row("gone", "Ragavan, Nimble Pilferer", 7000, { quantity: 0 }),
    row("sheoldred", "Sheoldred, the Apocalypse", 6499, { finish: "etched" }),
    row("fable", "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki", 4250),
    row("bowmasters", "Orcish Bowmasters", 3999),
  ];

  it("takes the four most valuable, one per card, with a picture and in stock", () => {
    const picked = pickYardSaleShowcase(rows.map(mapCatalogRow), 20);
    expect(picked.map((c) => c.id)).toEqual(["ring-foil", "fow", "sheoldred", "fable"]);
    expect(picked[0]).toEqual({
      id: "ring-foil",
      name: "The One Ring",
      imageUrl: "https://cards.scryfall.io/large/front/a/b/ring-foil.jpg",
      foil: true,
      priceCents: 12000,
      salePriceCents: 9600,
    });
  });

  it("prices each one like the yard sale page: the discount, in whole dollars", () => {
    const picked = pickYardSaleShowcase(rows.map(mapCatalogRow), 20);
    expect(picked.map((c) => [c.priceCents, c.salePriceCents])).toEqual([
      [12000, 9600],
      [9150, 7300], // $73.20 -> $73
      [6499, 5200], // $51.99 -> $52
      [4250, 3400],
    ]);
    // No discount: the website price, rounded down to the dollar.
    expect(pickYardSaleShowcase(rows.map(mapCatalogRow), 0).map((c) => c.salePriceCents)).toEqual([12000, 9100, 6400, 4200]);
  });

  it("names a double-faced card by its front and marks foils and etched foils", () => {
    const picked = pickYardSaleShowcase(rows.map(mapCatalogRow), 20);
    expect(picked.find((c) => c.id === "fable")?.name).toBe("Fable of the Mirror-Breaker");
    expect(picked.map((c) => c.foil)).toEqual([true, false, true, false]);
  });

  it("skips cards without a price and stops at the limit", () => {
    const picked = pickYardSaleShowcase(
      [row("free", "Unpriced Card", null), row("zero", "Zero Card", 0), ...rows].map(mapCatalogRow),
      20,
      2,
    );
    expect(picked.map((c) => c.id)).toEqual(["ring-foil", "fow"]);
    expect(pickYardSaleShowcase([], 20)).toEqual([]);
  });
});

describe("sign prices", () => {
  it("leaves off the cents on whole dollars", () => {
    expect(formatSignPrice(5800)).toBe("$58");
    expect(formatSignPrice(120000)).toBe("$1,200");
    expect(formatSignPrice(6499)).toBe("$64.99");
    expect(formatSignPrice(9150)).toBe("$91.50");
  });
});

describe("the sign's print job", () => {
  it("points at the yard sale page with the sale's minimum, with no tracking tags", () => {
    const printedAt = new Date(2026, 9, 20, 12, 0);
    const job = yardSaleSignJob({ minPriceCents: 500, discountPercent: 25, showcase: [], extraLine: "Table 4", printedAt });
    expect(job).toEqual({
      layout: "yard-sale",
      copy: expect.objectContaining({ headline: "Looking for something better?", cta: "Scan to see our cards $5 and up" }),
      url: "https://geega-games.com/yard-sale",
      address: "geega-games.com/yard-sale",
      extraLine: "Table 4",
      yardSale: { showcase: [], discountPercent: 25, printedAt: printedAt.toISOString() },
    });
  });
});

const SHOWCASE: YardSaleShowcaseCard[] = [
  { id: "ring", name: "The One Ring", imageUrl: "https://img.test/ring.jpg", foil: true, priceCents: 12000, salePriceCents: 9600 },
  { id: "fow", name: "Force of Will", imageUrl: "https://img.test/fow.jpg", foil: false, priceCents: 9150, salePriceCents: 7300 },
  { id: "bolt", name: "Lightning Bolt", imageUrl: "https://img.test/bolt.jpg", foil: false, priceCents: 500, salePriceCents: 500 },
];

function signJob(overrides: { showcase?: YardSaleShowcaseCard[]; discountPercent?: number; extraLine?: string | null } = {}): FlyerJob {
  return yardSaleSignJob({
    minPriceCents: 300,
    discountPercent: overrides.discountPercent ?? 20,
    showcase: overrides.showcase ?? SHOWCASE,
    extraLine: overrides.extraLine ?? null,
    printedAt: new Date(2026, 9, 20, 12, 0), // Tuesday, October 20
  });
}

function printButton() {
  return screen.getByRole("button", { name: /^(Print|Loading cards…)$/ });
}

describe("the printed yard sale sign", () => {
  beforeEach(() => {
    window.print = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("features the cards with their yard sale and website prices", () => {
    render(<FlyerPrintView job={signJob({ extraLine: "Find us at table 4" })} onClose={() => {}} />);
    screen.getByRole("dialog", { name: "Yard sale sign preview" });
    const sign = screen.getByTestId("yard-sale-sign");
    expect(within(sign).getByRole("heading", { level: 1 })).toHaveTextContent("Looking for something better?");
    expect(sign).toHaveTextContent("Our best cards aren’t on these tables.");
    expect(sign).toHaveTextContent("Find us at table 4");

    const shelf = within(sign).getByRole("region", { name: "Featured cards" });
    const cards = within(shelf).getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByRole("img", { name: "The One Ring" })).toHaveAttribute("src", "https://img.test/ring.jpg");
    expect(cards[0]).toHaveTextContent("The One RingFoil");
    expect(cards[0].querySelector("strong")).toHaveTextContent("$96");
    expect(within(cards[0]).getByLabelText("was $120")).toHaveTextContent("$120");
    expect(cards[1]).not.toHaveTextContent("Foil");
    expect(within(cards[1]).getByLabelText("was $91.50")).toBeInTheDocument();
    // Already a whole dollar with no discount to show: just the one price.
    expect(cards[2].querySelector("strong")).toHaveTextContent("$5");
    expect(cards[2].querySelector("s")).toBeNull();
  });

  it("has the QR code for the yard sale page and how it works", () => {
    render(<FlyerPrintView job={signJob()} onClose={() => {}} />);
    const scan = screen.getByRole("region", { name: "How to shop" });
    expect(within(scan).getByRole("img", { name: "QR code for geega-games.com/yard-sale" })).toBeInTheDocument();
    expect(scan).toHaveTextContent("Scan to see our cards $3 and up");
    expect(within(scan).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Pick the cards you want on your phone",
      "We grab them while you keep browsing",
      "Pay for everything together when you’re done",
    ]);
    expect(scan).toHaveTextContent("geega-games.com/yard-sale");
  });

  it("says how the prices work and when the featured prices are from", () => {
    render(<FlyerPrintView job={signJob()} onClose={() => {}} />);
    const footer = screen.getByTestId("yard-sale-sign").querySelector("footer")!;
    expect([...footer.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "Yard sale prices are 20% off our website prices, rounded to whole dollars.",
      "Featured prices as of Tuesday, October 20, while they last.",
    ]);
  });

  it("holds Print until every card picture has loaded or failed", () => {
    render(<FlyerPrintView job={signJob()} onClose={() => {}} />);
    expect(printButton()).toBeDisabled();
    expect(printButton()).toHaveTextContent("Loading cards…");
    const pictures = within(screen.getByRole("region", { name: "Featured cards" })).getAllByRole("img");
    fireEvent.load(pictures[0]);
    fireEvent.error(pictures[1]);
    expect(printButton()).toBeDisabled();
    fireEvent.load(pictures[2]);
    expect(printButton()).toBeEnabled();
    fireEvent.click(printButton());
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("allows Print anyway after 10 seconds", () => {
    vi.useFakeTimers();
    render(<FlyerPrintView job={signJob()} onClose={() => {}} />);
    expect(printButton()).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(9_999);
    });
    expect(printButton()).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(printButton()).toBeEnabled();
    expect(printButton()).toHaveTextContent("Print");
  });

  it("gives the QR code the room when there are no cards to feature", () => {
    render(<FlyerPrintView job={signJob({ showcase: [], discountPercent: 0 })} onClose={() => {}} />);
    const sign = screen.getByTestId("yard-sale-sign");
    expect(sign).toHaveClass("gg-ysign--plain");
    expect(screen.queryByRole("region", { name: "Featured cards" })).toBeNull();
    expect(within(sign).getByRole("img", { name: "QR code for geega-games.com/yard-sale" })).toBeInTheDocument();
    expect(printButton()).toBeEnabled();
    expect(sign.querySelector("footer")).toHaveTextContent(
      /^Yard sale prices are our website prices, rounded down to whole dollars\.$/,
    );
  });
});
