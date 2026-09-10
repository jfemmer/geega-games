// Live ScryfallRepository — talks to the Geega API proxy, NOT Scryfall directly.
//
// Routing through /api/admin/scryfall/* (a Vercel Function) gives us one place
// for caching, normalization, rate-limit handling, and error handling, and
// keeps the browser depending only on Geega's normalized CardPrinting domain
// type. The server already normalizes, so this client just unwraps { data }.
//
// The proxy is staff-guarded: every request MUST carry the caller's Supabase
// access token as a Bearer header (the server's requireStaff() reads it there).
// Supabase stores the session in localStorage, NOT in a same-origin cookie, so
// the token will not travel automatically — we must attach it explicitly on
// each call or the endpoint returns 401 and search silently yields nothing.
//
// Selected when VITE_USE_LIVE_SCRYFALL=1 (see ./index.ts); otherwise the mock
// catalog is used so local/dev/tests need no network.

import { supabase } from "../../supabase";
import type { CardPrinting } from "../types";
import type { ScryfallRepository } from "./types";

const BASE = "/api/admin/scryfall";

/** Current Supabase access token, or null when there is no active session. */
async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function getJson<T>(url: string): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error(
      "You must be signed in as staff to search Scryfall. Please sign in and try again.",
    );
  }

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "same-origin",
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "Your session isn't authorized for Scryfall search. Sign in as a staff user and retry.",
    );
  }
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