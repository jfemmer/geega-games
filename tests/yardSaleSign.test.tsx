// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FlyerPrintView, type FlyerJob } from "../src/admin/components/partners/FlyerPrintView";
import { newerCardsSince, pickYardSaleShowcase, yardSaleSignJob } from "../src/admin/utils/yardSaleSign";
import { mapCatalogRow, type CatalogSearchRow } from "../src/store/lib/useCatalog";
import type { YardSaleShowcaseCard } from "../src/admin/types";

// The PDF itself is tested in yardSaleSignPdf.test.ts; here, the preview's Save PDF button.
const pdfFile = vi.hoisted(() => ({ make: vi.fn() }));
vi.mock("../src/admin/utils/yardSaleSignPdf", () => ({ makeYardSaleSignPdf: pdfFile.make }));

// The printed yard sale sign (Yard Sale Mode → Print QR sign, Marketing →
// the yard sale page → Print table sign): a hand of the most valuable newer
// cards at the sale, fanned out, with no prices, and the QR code for
// /yard-sale with how it works.

function row(id: string, name: string, priceCents: number | null, overrides: Partial<CatalogSearchRow> = {}) {
  return {
    id,
    card_name: name,
    set_code: "SET",
    set_name: "A Set",
    collector_number: "1",
    rarity: "mythic",
    type_line: "Artifact",
    finish: "nonfoil",
    condition: "NM",
    quantity: 1,
    price_cents: priceCents,
    total_count: 9,
    scryfall_id: `sf-${id}`,
    image_url: `https://cards.scryfall.io/large/front/a/b/${id}.jpg`,
    ...overrides,
  } as CatalogSearchRow;
}

describe("newer cards", () => {
  it("are printings released in the last two years", () => {
    expect(newerCardsSince(new Date(2026, 9, 20, 13, 0))).toBe("2024-10-20");
    expect(newerCardsSince(new Date(2026, 0, 5))).toBe("2024-01-05");
    // February 29 two years back is March 1.
    expect(newerCardsSince(new Date(2028, 1, 29))).toBe("2026-03-01");
  });
});

describe("picking the cards for the hand", () => {
  // As search_inventory returns them for the sign: most valuable first.
  const rows = [
    row("lobotomy", "Lobotomy", 12500), // an older printing
    row("ring", "The One Ring", 12000),
    row("no-picture", "Mox Opal", 11000, { image_url: null } as Partial<CatalogSearchRow>),
    row("ring-2", "the one ring", 9999), // the same card again (names compared ignoring case)
    row("sephiroth", "Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel", 5500),
    row("gone", "Vampiric Tutor", 5200, { quantity: 0 }),
    row("jeska", "Jeska's Will", 4338),
    row("ugin", "Ugin, Eye of the Storms", 3900),
    row("splendor", "Gleaming Splendor", 3098),
    row("emrakul", "Emrakul, the Exigent Doom", 1745),
  ];
  const newer = new Set(rows.filter((r) => r.id !== "lobotomy").map((r) => r.scryfall_id!));

  it("takes the five most valuable newer cards, one per card, with a picture and in stock", () => {
    const picked = pickYardSaleShowcase(rows.map(mapCatalogRow), newer);
    expect(picked.map((c) => c.id)).toEqual(["ring", "sephiroth", "jeska", "ugin", "splendor"]);
    // Just what the sign shows: the picture, and the name for its alt text.
    expect(picked[0]).toEqual({ id: "ring", name: "The One Ring", imageUrl: "https://cards.scryfall.io/large/front/a/b/ring.jpg" });
  });

  it("names a double-faced card by its front", () => {
    const picked = pickYardSaleShowcase(rows.map(mapCatalogRow), newer);
    expect(picked.find((c) => c.id === "sephiroth")?.name).toBe("Sephiroth, Fabled SOLDIER");
  });

  it("leaves out older printings, unpriced cards and cards without a Scryfall id", () => {
    const cards = [
      row("free", "Unpriced Card", null),
      row("zero", "Zero Card", 0),
      row("unknown", "Mystery Card", 900, { scryfall_id: null }),
      ...rows,
    ].map(mapCatalogRow);
    const all = new Set(cards.map((c) => c.scryfallId).filter((id): id is string => !!id));
    expect(pickYardSaleShowcase(cards, all, 3).map((c) => c.id)).toEqual(["lobotomy", "ring", "sephiroth"]);
    expect(pickYardSaleShowcase(cards, new Set(), 3)).toEqual([]);
    expect(pickYardSaleShowcase([], newer)).toEqual([]);
  });
});

describe("the sign's print job", () => {
  it("points at the yard sale page with the sale's minimum, with no tracking tags", () => {
    const job = yardSaleSignJob({ minPriceCents: 500, discountPercent: 25, showcase: [], extraLine: "Table 4" });
    expect(job).toEqual({
      layout: "yard-sale",
      copy: expect.objectContaining({ headline: "Looking for something better?", cta: "Scan to see our cards $5 and up" }),
      url: "https://geega-games.com/yard-sale",
      address: "geega-games.com/yard-sale",
      extraLine: "Table 4",
      yardSale: { showcase: [], discountPercent: 25 },
    });
  });
});

// Most valuable first, as the repository returns them.
const SHOWCASE: YardSaleShowcaseCard[] = [
  { id: "ring", name: "The One Ring", imageUrl: "https://img.test/ring.jpg" },
  { id: "sephiroth", name: "Sephiroth, Fabled SOLDIER", imageUrl: "https://img.test/sephiroth.jpg" },
  { id: "jeska", name: "Jeska's Will", imageUrl: "https://img.test/jeska.jpg" },
];

function signJob(overrides: { showcase?: YardSaleShowcaseCard[]; discountPercent?: number; extraLine?: string | null } = {}): FlyerJob {
  return yardSaleSignJob({
    minPriceCents: 300,
    discountPercent: overrides.discountPercent ?? 20,
    showcase: overrides.showcase ?? SHOWCASE,
    extraLine: overrides.extraLine ?? null,
  });
}

function printButton() {
  return screen.getByRole("button", { name: /^(Print|Loading cards…)$/ });
}

function handPictures() {
  return within(screen.getByRole("region", { name: "A few of our newer cards" })).getAllByRole("img");
}

describe("the printed yard sale sign", () => {
  beforeEach(() => {
    window.print = vi.fn();
    pdfFile.make.mockReset();
    pdfFile.make.mockReturnValue(new Promise(() => {}));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the cards as a hand, the most valuable last and on top, with no prices", () => {
    render(<FlyerPrintView job={signJob({ extraLine: "Find us at table 4" })} onClose={() => {}} />);
    screen.getByRole("dialog", { name: "Yard sale sign preview" });
    const sign = screen.getByTestId("yard-sale-sign");
    expect(within(sign).getByRole("heading", { level: 1 })).toHaveTextContent("Looking for something better?");
    expect(sign).toHaveTextContent("Our best cards aren’t on these tables.");
    expect(sign).toHaveTextContent("Find us at table 4");

    const pictures = handPictures();
    expect(pictures.map((img) => img.getAttribute("alt"))).toEqual(["Jeska's Will", "Sephiroth, Fabled SOLDIER", "The One Ring"]);
    expect(pictures.map((img) => img.getAttribute("src"))).toEqual([
      "https://img.test/jeska.jpg",
      "https://img.test/sephiroth.jpg",
      "https://img.test/ring.jpg",
    ]);
    // Each card's place in the fan, for its turn.
    const fan = sign.querySelector(".gg-ysign__fan") as HTMLElement;
    expect(fan.style.getPropertyValue("--gg-ysign-n")).toBe("3");
    expect([...fan.querySelectorAll("li")].map((li) => (li as HTMLElement).style.getPropertyValue("--gg-ysign-i"))).toEqual(["0", "1", "2"]);
    // No prices on the cards (the only $ is the sale's minimum in the call to scan).
    expect(screen.getByRole("region", { name: "A few of our newer cards" }).textContent).toBe("");
    expect(sign.textContent?.match(/\$\d/g)).toEqual(["$3"]);
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

  it("says how yard sale prices work", () => {
    render(<FlyerPrintView job={signJob()} onClose={() => {}} />);
    expect(screen.getByTestId("yard-sale-sign").querySelector("footer")).toHaveTextContent(
      /^Yard sale prices are 20% off our website prices, rounded to whole dollars\.$/,
    );
    expect(screen.getByText(/Print in color so the cards show/)).toBeInTheDocument();
  });

  it("holds Print until every card picture has loaded or failed", () => {
    render(<FlyerPrintView job={signJob()} onClose={() => {}} />);
    expect(printButton()).toBeDisabled();
    expect(printButton()).toHaveTextContent("Loading cards…");
    const pictures = handPictures();
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

  it("gives the QR code the room when there are no cards for the hand", () => {
    render(<FlyerPrintView job={signJob({ showcase: [], discountPercent: 0 })} onClose={() => {}} />);
    const sign = screen.getByTestId("yard-sale-sign");
    expect(sign).toHaveClass("gg-ysign--plain");
    expect(screen.queryByRole("region", { name: "A few of our newer cards" })).toBeNull();
    expect(within(sign).getByRole("img", { name: "QR code for geega-games.com/yard-sale" })).toBeInTheDocument();
    expect(printButton()).toBeEnabled();
    expect(screen.queryByText(/Print in color so the cards show/)).toBeNull();
    expect(sign.querySelector("footer")).toHaveTextContent(
      /^Yard sale prices are our website prices, rounded down to whole dollars\.$/,
    );
  });
});

describe("saving the sign as a PDF", () => {
  const PDF = new Blob(["%PDF-1.7"], { type: "application/pdf" });
  const realMatchMedia = window.matchMedia;
  let clicked: { download: string; href: string }[];

  beforeEach(() => {
    window.print = vi.fn();
    pdfFile.make.mockReset();
    pdfFile.make.mockResolvedValue(PDF);
    URL.createObjectURL = vi.fn(() => "blob:yard-sale-sign");
    URL.revokeObjectURL = vi.fn();
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.matchMedia = realMatchMedia;
    Reflect.deleteProperty(navigator, "share");
    Reflect.deleteProperty(navigator, "canShare");
  });

  function onAPhone(share: () => Promise<void>) {
    window.matchMedia = (query: string) =>
      ({ ...realMatchMedia(query), matches: query === "(pointer: coarse)" }) as MediaQueryList;
    Object.defineProperty(navigator, "canShare", { configurable: true, value: vi.fn(() => true) });
    Object.defineProperty(navigator, "share", { configurable: true, value: vi.fn(share) });
  }

  it("makes the PDF while the preview is open, then downloads it", async () => {
    const job = signJob();
    render(<FlyerPrintView job={job} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Making PDF…" })).toBeDisabled();
    fireEvent.click(await screen.findByRole("button", { name: "Save PDF" }));
    expect(pdfFile.make).toHaveBeenCalledWith(job);
    expect(URL.createObjectURL).toHaveBeenCalledWith(PDF);
    expect(clicked).toEqual([{ download: "geega-games-yard-sale-sign.pdf", href: "blob:yard-sale-sign" }]);
  });

  it("opens the share sheet on a phone, to save, print or send it", async () => {
    onAPhone(() => Promise.resolve());
    render(<FlyerPrintView job={signJob()} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save PDF" }));
    expect(navigator.share).toHaveBeenCalledTimes(1);
    const shared = vi.mocked(navigator.share).mock.calls[0][0] as ShareData;
    expect(shared.title).toBe("Yard sale sign");
    expect(shared.files?.map((f) => [f.name, f.type])).toEqual([["geega-games-yard-sale-sign.pdf", "application/pdf"]]);
    await act(async () => {});
    expect(clicked).toEqual([]);
  });

  it("does nothing more when the share sheet is closed", async () => {
    onAPhone(() => Promise.reject(new DOMException("Share canceled", "AbortError")));
    render(<FlyerPrintView job={signJob()} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save PDF" }));
    await act(async () => {});
    expect(clicked).toEqual([]);
  });

  it("downloads it when the phone won't share it", async () => {
    onAPhone(() => Promise.reject(new DOMException("Not allowed", "NotAllowedError")));
    render(<FlyerPrintView job={signJob()} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save PDF" }));
    await act(async () => {});
    expect(clicked).toEqual([{ download: "geega-games-yard-sale-sign.pdf", href: "blob:yard-sale-sign" }]);
  });

  it("says so when the PDF can't be made, and tries again", async () => {
    pdfFile.make.mockRejectedValueOnce(new Error("offline"));
    render(<FlyerPrintView job={signJob()} onClose={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't make the PDF.");
    fireEvent.click(screen.getByRole("button", { name: "Retry PDF" }));
    expect(screen.getByRole("button", { name: "Making PDF…" })).toBeDisabled();
    fireEvent.click(await screen.findByRole("button", { name: "Save PDF" }));
    await waitFor(() => expect(pdfFile.make).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(clicked).toHaveLength(1);
  });

  it("saves the sign without cards too", async () => {
    render(<FlyerPrintView job={signJob({ showcase: [] })} onClose={() => {}} />);
    expect(screen.getByText(/Save PDF makes a file you can print anywhere else/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Save PDF" }));
    expect(clicked).toHaveLength(1);
  });
});
