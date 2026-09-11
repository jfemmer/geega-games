// Mock ScryfallRepository — searches the in-repo mock catalog and returns fully
// normalized CardPrinting objects, exactly as the live repository will. This
// lets the entire Scryfall-powered UX run offline in dev/tests. Swapping in the
// live implementation (browser -> /api/admin/scryfall/search) requires no
// component changes (see ./scryfall.live.ts and ./index.ts).

import { SCRYFALL_MOCK_CARDS } from "../data/scryfall.mock";
import {
  normalizeScryfallCard,
  normalizeScryfallCards,
} from "../services/scryfall";
import type { ScryfallCard } from "../services/scryfall.types";
import type { CardPrinting } from "../types";
import { delay } from "../utils/format";
import type {
  ResolveExactInput,
  ScryfallRepository,
  ScryfallSearchPage,
} from "./types";

/** Mock pretends to paginate at this size so "Load more" is exercisable. */
const MOCK_PAGE_SIZE = 175;

/**
 * Very small subset of Scryfall search syntax so the mock feels real:
 *   - `set:MH2` / `s:MH2` / `e:MH2` — filter by set code
 *   - `cn:138` / `number:138` — filter by collector number
 *   - bare words — matched against name/set/type (AND across words)
 */
function matches(card: ScryfallCard, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  return tokens.every((tok) => {
    const setMatch = tok.match(/^(?:set|s|e):(.+)$/);
    if (setMatch) return card.set.toLowerCase() === setMatch[1];
    const cnMatch = tok.match(/^(?:cn|number):(.+)$/);
    if (cnMatch) return card.collector_number.toLowerCase() === cnMatch[1];
    const rarityMatch = tok.match(/^(?:r|rarity):(.+)$/);
    if (rarityMatch) return card.rarity.toLowerCase().startsWith(rarityMatch[1]);

    const haystack = [
      card.name,
      card.set,
      card.set_name,
      card.type_line ?? "",
      card.collector_number,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(tok);
  });
}

/** Stable, printing-aware ordering: name, then set, then collector number. */
function sortPrintings(a: CardPrinting, b: CardPrinting): number {
  return (
    a.cardName.localeCompare(b.cardName) ||
    a.setCode.localeCompare(b.setCode) ||
    a.collectorNumber.localeCompare(b.collectorNumber, undefined, {
      numeric: true,
    })
  );
}

export const mockScryfallRepository: ScryfallRepository = {
  async searchPrintings(query: string): Promise<CardPrinting[]> {
    const q = query.trim();
    if (q.length < 2) return delay([], 120);
    const hits = SCRYFALL_MOCK_CARDS.filter((c) => matches(c, q));
    return delay(normalizeScryfallCards(hits).sort(sortPrintings), 260);
  },

  async searchPrintingsPage(
    query: string,
    page: number,
  ): Promise<ScryfallSearchPage> {
    const q = query.trim();
    const safePage = Math.max(1, Math.floor(page) || 1);
    if (q.length < 2) {
      return delay(
        { printings: [], totalCards: 0, hasMore: false, page: safePage },
        120,
      );
    }
    const all = normalizeScryfallCards(
      SCRYFALL_MOCK_CARDS.filter((c) => matches(c, q)),
    ).sort(sortPrintings);
    const start = (safePage - 1) * MOCK_PAGE_SIZE;
    const printings = all.slice(start, start + MOCK_PAGE_SIZE);
    return delay(
      {
        printings,
        totalCards: all.length,
        hasMore: start + MOCK_PAGE_SIZE < all.length,
        page: safePage,
      },
      260,
    );
  },

  async getByScryfallId(scryfallId: string): Promise<CardPrinting | null> {
    const card = SCRYFALL_MOCK_CARDS.find((c) => c.id === scryfallId);
    return delay(card ? normalizeScryfallCard(card) : null, 150);
  },

  async getBySetAndCollector(
    setCode: string,
    collectorNumber: string,
  ): Promise<CardPrinting | null> {
    const card = SCRYFALL_MOCK_CARDS.find(
      (c) =>
        c.set.toLowerCase() === setCode.toLowerCase() &&
        c.collector_number === collectorNumber,
    );
    return delay(card ? normalizeScryfallCard(card) : null, 150);
  },

  async resolveExact(input: ResolveExactInput): Promise<CardPrinting | null> {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const sameCn = (a: string, b: string) =>
      a.toLowerCase().replace(/[^0-9a-z]/g, "") ===
      b.toLowerCase().replace(/[^0-9a-z]/g, "");

    let card: ScryfallCard | undefined;
    // 1. exact id
    if (input.scryfallId) {
      card = SCRYFALL_MOCK_CARDS.find((c) => c.id === input.scryfallId);
    }
    // 2. exact set + collector
    if (!card && input.setCode && input.collectorNumber) {
      card = SCRYFALL_MOCK_CARDS.find(
        (c) =>
          c.set.toLowerCase() === input.setCode!.toLowerCase() &&
          sameCn(c.collector_number, input.collectorNumber!),
      );
    }
    // 3. name + set (+ collector tie-break)
    if (!card && input.cardName && input.setCode) {
      const want = norm(input.cardName);
      const inSet = SCRYFALL_MOCK_CARDS.filter(
        (c) =>
          c.set.toLowerCase() === input.setCode!.toLowerCase() &&
          norm(c.name).includes(want),
      );
      card =
        (input.collectorNumber &&
          inSet.find((c) => sameCn(c.collector_number, input.collectorNumber!))) ||
        inSet[0];
    }
    // Name gate: never return a mismatch.
    if (card && input.cardName && !norm(card.name).includes(norm(input.cardName))) {
      card = undefined;
    }
    return delay(card ? normalizeScryfallCard(card) : null, 150);
  },
};