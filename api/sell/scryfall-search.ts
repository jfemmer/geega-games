import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, sendJson } from "../_lib/http.js";
import { scryfallSearch, scryfallSearchPage } from "../_lib/scryfall.js";
import { normalizeScryfallCards } from "../../src/admin/services/scryfall.js";
import { checkRateLimit, getClientIp } from "../_lib/rateLimit.js";

// GET /api/sell/scryfall-search?q=<query>[&page=<n>]
//
// PUBLIC counterpart to /api/admin/scryfall/search, for the Sell Your Cards
// page (public/anonymous sellers need to identify exact printings too, and
// the admin endpoint is staff-only for good reason — this is a deliberately
// separate, more tightly bounded endpoint rather than a change to admin
// auth). Reuses the SAME server-side Scryfall client and normalization
// service as the admin endpoint, so results and behavior stay consistent.
//
// Public-specific hardening the admin endpoint doesn't need:
//   - a lower page ceiling (fewer Scryfall calls per request from an
//     untrusted caller)
//   - a short in-memory response cache (a burst of the same popular query —
//     "Lightning Bolt" is common on a public form — costs one Scryfall call,
//     not one per visitor)
//   - a per-IP sliding-window rate limit (best-effort; see rateLimit.ts)
//   - a hard cap on query length
//
// Response shape matches the admin endpoint (and the ScryfallRepository
// contract): { data: CardPrinting[], totalCards, hasMore, page }.
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;
const PUBLIC_MAX_PAGES = 3;
// Generous enough to cover a legitimate bulk-list paste auto-resolving many
// lines in quick succession (see BulkListInput.tsx), while still bounding a
// single IP well below anything that could meaningfully strain Scryfall.
const RATE_LIMIT_PER_WINDOW = 90;
const RATE_WINDOW_MS = 60_000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;

interface CachedResponse {
  body: Record<string, unknown>;
  expiresAt: number;
}

// Module-scope cache: lives as long as this lambda instance stays warm.
const responseCache = new Map<string, CachedResponse>();

function getCached(key: string): Record<string, unknown> | null {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return hit.body;
}

function setCached(key: string, body: Record<string, unknown>): void {
  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    // Evict the oldest entry (Map preserves insertion order).
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey !== undefined) responseCache.delete(oldestKey);
  }
  responseCache.set(key, { body, expiresAt: Date.now() + CACHE_TTL_MS });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit("sell-scryfall-search", ip, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many searches. Please wait a moment and try again.");
    }

    const qRaw = String(req.query.q ?? "").trim();
    if (qRaw.length > MAX_QUERY_LENGTH) {
      throw new HttpError(400, "That search is too long.");
    }
    if (qRaw.length < MIN_QUERY_LENGTH) {
      return sendJson(res, 200, { data: [], totalCards: 0, hasMore: false, page: 1 });
    }

    const rawPage = req.query.page;
    const pageNum =
      typeof rawPage === "string" && rawPage.trim() !== ""
        ? Number.parseInt(rawPage, 10)
        : null;
    const wantsSinglePage =
      pageNum != null && Number.isFinite(pageNum) && pageNum >= 1 && pageNum <= PUBLIC_MAX_PAGES + 5;

    const cacheKey = `${qRaw.toLowerCase()}::${wantsSinglePage ? pageNum : "initial"}`;
    const cached = getCached(cacheKey);
    if (cached) return sendJson(res, 200, cached);

    try {
      if (wantsSinglePage) {
        const result = await scryfallSearchPage(qRaw, pageNum!);
        const body = {
          data: normalizeScryfallCards(result.data),
          totalCards: result.totalCards,
          hasMore: result.hasMore,
          page: pageNum,
        };
        setCached(cacheKey, body);
        return sendJson(res, 200, body);
      }

      const result = await scryfallSearch(qRaw, { maxPages: PUBLIC_MAX_PAGES });
      const body = {
        data: normalizeScryfallCards(result.data),
        totalCards: result.totalCards,
        hasMore: result.hasMore,
        page: 1,
      };
      setCached(cacheKey, body);
      return sendJson(res, 200, body);
    } catch (err) {
      // A Scryfall 404 means "no cards matched" — return an empty list.
      if (err instanceof HttpError && err.status === 404) {
        return sendJson(res, 200, {
          data: [],
          totalCards: 0,
          hasMore: false,
          page: wantsSinglePage ? pageNum : 1,
        });
      }
      throw err;
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
