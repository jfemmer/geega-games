import type { CatalogCard } from "../../store/lib/useCatalog";
import { YARD_SALE_PATH } from "../../store/lib/yardSale";
import { marketingLink, printedAddress, yardSaleFlyerCopy } from "./marketing";
import type { FlyerJob } from "../components/partners/FlyerPrintView";
import type { YardSaleShowcaseCard } from "../types";

// The printed yard sale sign (Yard Sale Mode → Print QR sign, and Marketing →
// the yard sale page → Print table sign): the QR code for /yard-sale under a
// hand of a few of the most valuable newer cards at the sale, fanned out the
// way you'd hold them, to show people browsing the tables what's online. No
// prices, so the sign stays right however they change.

/** Cards in the hand on the sign. */
export const SIGN_HAND_SIZE = 5;

/** "Newer" cards are printings released in the last this many years. */
export const NEWER_CARDS_YEARS = 2;

/** The earliest release date (YYYY-MM-DD) that counts as newer, as of `now` (local date). */
export function newerCardsSince(now: Date = new Date()): string {
  const since = new Date(now.getFullYear() - NEWER_CARDS_YEARS, now.getMonth(), now.getDate());
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${since.getFullYear()}-${pad(since.getMonth() + 1)}-${pad(since.getDate())}`;
}

/**
 * The sign's hand from the yard sale page's own cards, most valuable first
 * (as search_inventory returns them with "price_desc"): only newer printings
 * (`newerIds`, by Scryfall id), one per card name, only cards with a picture.
 */
export function pickYardSaleShowcase(
  cards: CatalogCard[],
  newerIds: ReadonlySet<string>,
  limit = SIGN_HAND_SIZE,
): YardSaleShowcaseCard[] {
  const seen = new Set<string>();
  const picked: YardSaleShowcaseCard[] = [];
  for (const card of cards) {
    if (picked.length >= limit) break;
    if (!card.scryfallId || !newerIds.has(card.scryfallId)) continue;
    if (!card.imageUrl || (card.priceCents ?? 0) <= 0 || card.quantity <= 0) continue;
    // The front of a double-faced card is the name people know it by.
    const name = card.name.split(" // ")[0];
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({ id: card.id, name, imageUrl: card.imageUrl });
  }
  return picked;
}

/** The print job for the yard sale sign. */
export function yardSaleSignJob({
  minPriceCents,
  discountPercent,
  showcase,
  extraLine = null,
}: {
  minPriceCents: number;
  discountPercent: number;
  showcase: YardSaleShowcaseCard[];
  extraLine?: string | null;
}): FlyerJob {
  return {
    layout: "yard-sale",
    copy: yardSaleFlyerCopy(minPriceCents),
    url: marketingLink(YARD_SALE_PATH, {}),
    address: printedAddress(YARD_SALE_PATH),
    extraLine,
    yardSale: { showcase, discountPercent },
  };
}
