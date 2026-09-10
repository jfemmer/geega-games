import { HttpError } from "./http.js";
import type {
  ScryfallCard,
  ScryfallList,
} from "../../src/admin/services/scryfall.types.js";

// Thin server-side Scryfall HTTP client. Lives in the API layer (never the
// browser) so we control rate limiting, headers, and error shaping in one
// place. Scryfall asks callers to set a descriptive User-Agent and Accept
// header and to stay within ~10 requests/second; Vercel Functions are
// short-lived and low-QPS here, but we still surface 429s cleanly.

const BASE = "https://api.scryfall.com";

const COMMON_HEADERS = {
  Accept: "application/json;q=0.9,*/*;q=0.8",
  "User-Agent": "GeegaGames/1.0 (+https://geega-games.com)",
};

/**
 * Scryfall requests ~50-100ms between calls. We honor that between paginated
 * follow-up pages so a broad search (e.g. "Lightning Bolt") that spans several
 * result pages stays a good API citizen without noticeably slowing the admin.
 */
const PAGE_DELAY_MS = 90;

/**
 * Hard ceiling on how many result pages a single search will walk. Each page is
 * 175 cards, so 6 pages = up to 1050 printings — far more than any real Magic
 * card has, while guaranteeing we never accidentally spider the whole database
 * for an overly broad query. Deep result sets should be narrowed with Scryfall
 * syntax (set:, cn:, etc.) rather than paged endlessly.
 */
const DEFAULT_MAX_PAGES = 6;

/**
 * Per-request timeout. Vercel Functions have a hard wall-clock limit; a hung
 * Scryfall call would otherwise burn the whole budget and surface as an opaque
 * platform timeout (which the browser sees as a failed/empty search). Aborting
 * ourselves lets us return a clean error the UI can show.
 */
const REQUEST_TIMEOUT_MS = 7000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function scryfallGetUrl<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { headers: COMMON_HEADERS, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HttpError(504, "Scryfall took too long to respond. Try again.");
    }
    throw new HttpError(502, "Could not reach Scryfall. Try again.");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    throw new HttpError(429, "Scryfall rate limit reached. Retry shortly.");
  }
  if (res.status === 404) {
    throw new HttpError(404, "Not found on Scryfall.");
  }
  if (!res.ok) {
    throw new HttpError(502, `Scryfall request failed (${res.status}).`);
  }
  return (await res.json()) as T;
}

async function scryfallGet<T>(path: string): Promise<T> {
  return scryfallGetUrl<T>(`${BASE}${path}`);
}

export interface ScryfallSearchOptions {
  /** Maximum number of result pages to walk (default DEFAULT_MAX_PAGES). */
  maxPages?: number;
}

export interface ScryfallSearchResult {
  /** All cards gathered across the fetched pages, de-duplicated by id. */
  data: ScryfallCard[];
  /** Total printings Scryfall reports match the query (across ALL pages). */
  totalCards: number | null;
  /**
   * True when Scryfall still has more pages beyond what we fetched (i.e. we hit
   * the page ceiling). The UI can surface this so operators know a broad query
   * was truncated and should be narrowed.
   */
  hasMore: boolean;
  /** Non-fatal warnings Scryfall attached to the query, if any. */
  warnings?: string[];
}

/**
 * Search printings, walking pagination up to `maxPages`.
 *
 * `unique=prints` is REQUIRED and preserved: every individual printing / art /
 * set version / treatment must remain separately selectable (a Lightning Bolt
 * from LEA, a showcase MH2 print, a borderless promo, etc. are DISTINCT rows).
 *
 * Scryfall paginates search results at 175 cards/page and exposes `has_more` +
 * `next_page`. The previous implementation returned only the first page, so
 * older / additional printings silently disappeared for any card with many
 * prints. We now follow `next_page` until Scryfall reports no more pages (or we
 * hit the safety ceiling), de-duplicating by card id when combining pages so a
 * printing never appears twice.
 */
export async function scryfallSearch(
  query: string,
  options: ScryfallSearchOptions = {},
): Promise<ScryfallSearchResult> {
  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);

  const params = new URLSearchParams({
    q: query,
    unique: "prints",
    order: "released",
    dir: "desc",
  });

  const seen = new Set<string>();
  const data: ScryfallCard[] = [];
  const warnings = new Set<string>();
  let totalCards: number | null = null;

  let nextUrl: string | null = `${BASE}/cards/search?${params.toString()}`;
  let pagesFetched = 0;

  while (nextUrl && pagesFetched < maxPages) {
    const list: ScryfallList = await scryfallGetUrl<ScryfallList>(nextUrl);
    pagesFetched += 1;

    if (typeof list.total_cards === "number") totalCards = list.total_cards;
    for (const w of list.warnings ?? []) warnings.add(w);

    for (const card of list.data ?? []) {
      // De-dupe defensively by Scryfall id so combining pages can never emit
      // the same printing twice, even if Scryfall repeats a boundary row.
      if (card && card.id && !seen.has(card.id)) {
        seen.add(card.id);
        data.push(card);
      }
    }

    nextUrl = list.has_more && list.next_page ? list.next_page : null;
    if (nextUrl && pagesFetched < maxPages) {
      // Be a good API citizen between follow-up pages.
      await sleep(PAGE_DELAY_MS);
    }
  }

  return {
    data,
    totalCards,
    // We truncated only if Scryfall still had a next page when we stopped.
    hasMore: nextUrl != null,
    warnings: warnings.size > 0 ? Array.from(warnings) : undefined,
  };
}

export interface ScryfallPageResult {
  /** Cards on THIS page only (de-duped defensively within the page). */
  data: ScryfallCard[];
  /** Total printings Scryfall reports match the query (across all pages). */
  totalCards: number | null;
  /** True when Scryfall has a page beyond the one just fetched. */
  hasMore: boolean;
  warnings?: string[];
}

/**
 * Fetch a SINGLE page of search results (Scryfall's native `page` param). Used
 * by the "Load more printings" UI so each click fetches exactly one more page
 * rather than re-walking everything. `unique=prints` is preserved so treatments
 * and art variants stay separate. Page is 1-based.
 */
export async function scryfallSearchPage(
  query: string,
  page = 1,
): Promise<ScryfallPageResult> {
  const params = new URLSearchParams({
    q: query,
    unique: "prints",
    order: "released",
    dir: "desc",
    page: String(Math.max(1, page)),
  });

  const list = await scryfallGet<ScryfallList>(
    `/cards/search?${params.toString()}`,
  );

  const seen = new Set<string>();
  const data: ScryfallCard[] = [];
  for (const card of list.data ?? []) {
    if (card && card.id && !seen.has(card.id)) {
      seen.add(card.id);
      data.push(card);
    }
  }

  return {
    data,
    totalCards: typeof list.total_cards === "number" ? list.total_cards : null,
    hasMore: Boolean(list.has_more),
    warnings: list.warnings,
  };
}

/** Fetch one printing by its Scryfall id. */
export function scryfallById(id: string): Promise<ScryfallCard> {
  return scryfallGet<ScryfallCard>(`/cards/${encodeURIComponent(id)}`);
}

/** Fetch one printing by set code + collector number. */
export function scryfallBySetCollector(
  set: string,
  collector: string,
): Promise<ScryfallCard> {
  return scryfallGet<ScryfallCard>(
    `/cards/${encodeURIComponent(set.toLowerCase())}/${encodeURIComponent(collector)}`,
  );
}