// Live ScryfallRepository — talks to the Geega API proxy, NOT Scryfall directly.
//
// Routing through /api/admin/scryfall/* (a Vercel Function) gives us one place
// for caching, normalization, rate-limit handling, and error handling, and
// keeps the browser depending only on Geega's normalized CardPrinting domain
// type. The server already normalizes, so this client just unwraps { data }.
//
// This implementation is wired but the app defaults to the mock repository
// (see ./index.ts) so local/dev/tests need no network. Flip USE_LIVE_SCRYFALL
// to true (or set VITE_USE_LIVE_SCRYFALL=1) to use it.

import type { CardPrinting } from "../types";
import type { ScryfallRepository } from "./types";

const BASE = "/api/admin/scryfall";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (res.status === 429) {
    throw new Error("Scryfall is rate limiting requests. Please retry shortly.");
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const liveScryfallRepository: ScryfallRepository = {
  async searchPrintings(query: string): Promise<CardPrinting[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const body = await getJson<{ data: CardPrinting[] }>(
      `${BASE}/search?q=${encodeURIComponent(q)}`,
    );
    return body.data ?? [];
  },

  async getByScryfallId(scryfallId: string): Promise<CardPrinting | null> {
    const body = await getJson<{ data: CardPrinting | null }>(
      `${BASE}/card?id=${encodeURIComponent(scryfallId)}`,
    );
    return body.data ?? null;
  },

  async getBySetAndCollector(
    setCode: string,
    collectorNumber: string,
  ): Promise<CardPrinting | null> {
    const body = await getJson<{ data: CardPrinting | null }>(
      `${BASE}/card?set=${encodeURIComponent(setCode)}&cn=${encodeURIComponent(
        collectorNumber,
      )}`,
    );
    return body.data ?? null;
  },
};
