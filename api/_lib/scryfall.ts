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

async function scryfallGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: COMMON_HEADERS });

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

/** Search printings (unique per printing, so art variants appear separately). */
export function scryfallSearch(query: string): Promise<ScryfallList> {
  const params = new URLSearchParams({
    q: query,
    unique: "prints",
    order: "released",
    dir: "desc",
  });
  return scryfallGet<ScryfallList>(`/cards/search?${params.toString()}`);
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
