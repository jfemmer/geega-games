import { supabase } from "../../supabase";
import { parseDecklist } from "./decklist";
import { mapCatalogRow, type CatalogCard, type CatalogSearchRow } from "./useCatalog";
import { YARD_SALE_LIMITS } from "./yardSale";

// "Shop your deck" on the yard sale page: a shopper pastes a decklist (from
// Moxfield, Archidekt, TCGplayer, ManaBox, MTGGoldfish — see decklist.ts)
// and sees which of its cards are at the yard sale, to add to their pickup
// list in one go.
//
//   deckWants             what the deck asks for: one entry per card name,
//                         commander, main deck and sideboard together (not
//                         the maybeboard), copies capped at a list's 20
//   findYardSaleDeckCards looks the names up with yard_sale_deck_matches
//                         (the yard sale page's own cards, at or above the
//                         sale's minimum) and fills each from the cheapest
//                         copies
//   allocateDeckCards     that filling, on its own for the tests

export const DECK_LIMITS = {
  /** Different card names looked up at once (yard_sale_deck_matches reads 250). */
  maxNames: 250,
  /** Characters of pasted or uploaded text read. */
  maxTextLength: 60_000,
} as const;

export interface DeckWant {
  /** The name as the decklist has it (decklist.ts tidies apostrophes and " // "). */
  name: string;
  quantity: number;
}

export interface DeckFoundLine {
  card: CatalogCard;
  quantity: number;
}

export interface DeckFoundCard {
  name: string;
  wanted: number;
  /** How many copies we have for it (at most `wanted`). */
  found: number;
  /** The copies, cheapest first: one line per printing used. */
  lines: DeckFoundLine[];
}

export interface DeckResult {
  /** Copies the deck asks for, in all. */
  wantedCopies: number;
  /** Copies we have here, in all. */
  foundCopies: number;
  /** Cards with at least one copy here, in the deck's order. */
  found: DeckFoundCard[];
  /** Cards with no copies here (`quantity` = copies wanted). */
  missing: DeckWant[];
}

export function deckWants(text: string): DeckWant[] {
  const byName = new Map<string, DeckWant>();
  for (const card of parseDecklist(text.slice(0, DECK_LIMITS.maxTextLength))) {
    if (card.section === "maybeboard") continue;
    const key = card.name.toLowerCase();
    const existing = byName.get(key);
    if (existing) existing.quantity = Math.min(YARD_SALE_LIMITS.copiesPerCard, existing.quantity + card.quantity);
    else byName.set(key, { name: card.name, quantity: Math.min(YARD_SALE_LIMITS.copiesPerCard, card.quantity) });
  }
  return [...byName.values()].slice(0, DECK_LIMITS.maxNames);
}

/** A yard_sale_deck_matches row: the catalog's columns, plus which name it matched. */
export interface DeckMatch {
  inputName: string;
  card: CatalogCard;
}

/** Fills each wanted card from its matches in order (cheapest first), as far as the copies we have go. */
export function allocateDeckCards(wants: DeckWant[], matches: DeckMatch[]): DeckResult {
  const byName = new Map<string, CatalogCard[]>();
  for (const match of matches) {
    const key = match.inputName.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), match.card]);
  }

  const found: DeckFoundCard[] = [];
  const missing: DeckWant[] = [];
  let wantedCopies = 0;
  let foundCopies = 0;
  for (const want of wants) {
    wantedCopies += want.quantity;
    let left = want.quantity;
    const lines: DeckFoundLine[] = [];
    for (const card of byName.get(want.name.toLowerCase()) ?? []) {
      if (left === 0) break;
      const take = Math.min(left, card.quantity, YARD_SALE_LIMITS.copiesPerCard);
      if (take <= 0 || (card.priceCents ?? 0) <= 0) continue;
      lines.push({ card, quantity: take });
      left -= take;
    }
    const got = want.quantity - left;
    foundCopies += got;
    if (got > 0) found.push({ name: want.name, wanted: want.quantity, found: got, lines });
    else missing.push(want);
  }
  return { wantedCopies, foundCopies, found, missing };
}

export async function findYardSaleDeckCards(wants: DeckWant[]): Promise<DeckResult> {
  if (wants.length === 0) return allocateDeckCards([], []);
  const { data, error } = await supabase.rpc("yard_sale_deck_matches", {
    p_names: wants.map((w) => w.name),
  });
  if (error) throw new Error("We couldn't check your deck. Check your connection and try again.");
  const rows = (data ?? []) as unknown as (CatalogSearchRow & { input_name: string })[];
  return allocateDeckCards(
    wants,
    rows.map((row) => ({ inputName: row.input_name, card: mapCatalogRow(row) })),
  );
}
