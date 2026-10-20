import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import {
  buildYardSaleSignPdf,
  imageKind,
  wrapText,
  type SignImage,
  type YardSaleSignPdfAssets,
} from "../src/admin/utils/yardSaleSignPdf";
import { yardSaleSignJob } from "../src/admin/utils/yardSaleSign";
import type { YardSaleShowcaseCard } from "../src/admin/types";

// Save PDF on the yard sale sign: the same sign as a PDF file (one US Letter
// page, like Print), to print anywhere else.

const file = (path: string) => new Uint8Array(readFileSync(new URL(path, import.meta.url)));
const JPG: SignImage = { bytes: file("../src/admin/assets/logo-black-background-print.jpg"), kind: "jpg" };
const PNG: SignImage = { bytes: file("../public/favicon-96.png"), kind: "png" };

function assets(cards: (SignImage | null)[]): YardSaleSignPdfAssets {
  return {
    regular: file("../src/admin/assets/fonts/Inter-Regular.ttf"),
    semiBold: file("../src/admin/assets/fonts/Inter-SemiBold.ttf"),
    logo: JPG,
    cards,
    shadow: null,
  };
}

const SHOWCASE: YardSaleShowcaseCard[] = [
  { id: "ring", name: "The One Ring", imageUrl: "https://img.test/ring.jpg" },
  { id: "sephiroth", name: "Sephiroth, Fabled SOLDIER", imageUrl: "https://img.test/sephiroth.jpg" },
  { id: "vampiric", name: "Vampiric Tutor", imageUrl: "https://img.test/vampiric.png" },
  { id: "jeska", name: "Jeska's Will", imageUrl: "https://img.test/jeska.jpg" },
  { id: "ugin", name: "Ugin, Eye of the Storms", imageUrl: "https://img.test/ugin.jpg" },
];

function job(overrides: { showcase?: YardSaleShowcaseCard[]; extraLine?: string | null; discountPercent?: number } = {}) {
  return yardSaleSignJob({
    minPriceCents: 300,
    discountPercent: overrides.discountPercent ?? 20,
    showcase: overrides.showcase ?? SHOWCASE,
    extraLine: overrides.extraLine ?? null,
  });
}

const realDrawText = PDFPage.prototype.drawText;

/** Builds the PDF, noting every line of text drawn and every picture placed. */
async function build(j = job(), cards: (SignImage | null)[] = [JPG, JPG, PNG, JPG, JPG]) {
  vi.restoreAllMocks();
  const text: { text: string; x: number; y: number; size: number }[] = [];
  vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, line, options) {
    text.push({ text: line, x: options?.x ?? 0, y: options?.y ?? 0, size: options?.size ?? 0 });
    return realDrawText.call(this, line, options);
  });
  const images = vi.spyOn(PDFPage.prototype, "drawImage");
  const bytes = await buildYardSaleSignPdf(j, assets(cards));
  return { bytes, text, images: images.mock.calls.length };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("breaking words into lines", () => {
  const measure = (s: string) => s.length;

  it("fills each line", () => {
    expect(wrapText("aa bb cc dd", 5, measure)).toEqual(["aa bb", "cc dd"]);
    expect(wrapText("  one  ", 10, measure)).toEqual(["one"]);
    expect(wrapText("", 10, measure)).toEqual([]);
    // A word longer than the line gets a line to itself.
    expect(wrapText("aa bbbbbbbb cc", 5, measure)).toEqual(["aa", "bbbbbbbb", "cc"]);
  });

  it("balances lines without adding one", () => {
    expect(wrapText("Looking for something better?", 26, measure)).toEqual(["Looking for something", "better?"]);
    expect(wrapText("Looking for something better?", 26, measure, "balance")).toEqual(["Looking for", "something better?"]);
  });

  it("keeps a word from ending up alone on the last line", () => {
    expect(wrapText("Pay for everything together when you're done", 40, measure)).toEqual([
      "Pay for everything together when you're",
      "done",
    ]);
    expect(wrapText("Pay for everything together when you're done", 40, measure, "pretty")).toEqual([
      "Pay for everything together when",
      "you're done",
    ]);
    // Unless there's no word to bring down.
    expect(wrapText("aaaaaaaaa b", 9, measure, "pretty")).toEqual(["aaaaaaaaa", "b"]);
  });
});

describe("the sign as a PDF", () => {
  it("is one US Letter page, titled", async () => {
    const { bytes } = await build();
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(pdf.getTitle()).toBe("Yard sale sign");
    expect(pdf.getAuthor()).toBe("Geega Games");
  });

  it("has the sign's words, top to bottom", async () => {
    const { text } = await build(job({ extraLine: "Find us at table 4" }));
    const lines = [...text].sort((a, b) => b.y - a.y || a.x - b.x).map((t) => t.text);
    expect(lines).toEqual([
      "Magic: The Gathering singles",
      "Looking for something better?",
      "Our best cards aren’t on these tables. They’re on our website, and",
      "we’ll grab them for you.",
      "Find us at table 4",
      "Scan to see our cards $3 and up",
      "1",
      "Pick the cards you want on your phone",
      "2",
      "We grab them while you keep browsing",
      "3",
      "Pay for everything together when you’re done",
      "geega-games.com/yard-sale",
      "Yard sale prices are 20% off our website prices, rounded to whole dollars.",
    ]);
    // No prices on the cards.
    expect(text.filter((t) => /\$\d/.test(t.text)).map((t) => t.text)).toEqual(["Scan to see our cards $3 and up"]);
  });

  it("places the logo and each card's picture, JPEG or PNG", async () => {
    const { images } = await build();
    expect(images).toBe(1 + 5);
  });

  it("leaves out a card whose picture couldn't be loaded", async () => {
    const { images } = await build(job(), [JPG, null, PNG, null, JPG]);
    expect(images).toBe(1 + 3);
  });

  it("is the sign without cards, with the bigger headline, when there are none", async () => {
    const plain = await build(job({ showcase: [], discountPercent: 0 }), []);
    expect(plain.images).toBe(1);
    expect(plain.text.find((t) => t.text.startsWith("Looking for"))?.size).toBe(36);
    expect(plain.text.map((t) => t.text)).toContain("Yard sale prices are our website prices, rounded down to whole dollars.");
    // Every picture failing to load is the same.
    const failed = await build(job(), [null, null, null, null, null]);
    expect(failed.images).toBe(1);
    expect(failed.text.find((t) => t.text.startsWith("Looking for"))?.size).toBe(36);
  });

  it("fits on the sign with the longest extra line and a full hand", async () => {
    const extra = "Saturday 8 to 2 at 4410 Example Ave. Cash or Venmo. Ask us about anything onl";
    const { text } = await build(job({ extraLine: extra }));
    // Inside the sign: 0.4in margins on the page.
    for (const t of text) {
      expect(t.y).toBeGreaterThan(0.4 * 72);
      expect(t.y).toBeLessThan(792 - 0.4 * 72);
      expect(t.x).toBeGreaterThanOrEqual(0.4 * 72);
    }
    const extraLines = text.filter((t) => extra.includes(t.text) && t.size === 14);
    expect(extraLines.map((t) => t.text).join(" ")).toBe(extra);
    // The footnote stays the lowest line.
    const lowest = text.reduce((a, b) => (b.y < a.y ? b : a));
    expect(lowest.text).toMatch(/^Yard sale prices/);
  });

  it("leaves out characters the font can't draw", async () => {
    const { text } = await build(job({ extraLine: "Free lemonade 🍋 today" }));
    expect(text.map((t) => t.text)).toContain("Free lemonade today");
  });
});

describe("pictures a PDF can hold as they are", () => {
  it("knows JPEG and PNG by their first bytes", () => {
    expect(imageKind(JPG.bytes)).toBe("jpg");
    expect(imageKind(PNG.bytes)).toBe("png");
    expect(imageKind(new TextEncoder().encode("RIFF....WEBPVP8 "))).toBeNull();
  });
});
