import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { scryfallSearch, scryfallSearchPage } from "../../_lib/scryfall.js";
import { normalizeScryfallCards } from "../../../src/admin/services/scryfall.js";

// GET /api/admin/scryfall/search?q=<query>[&page=<n>]
//
// Staff-only proxy to Scryfall's card search. Normalizes results server-side
// into Geega's CardPrinting shape so the browser depends only on our domain
// type.
//
// Two modes:
//   * No `page` param  -> walk pagination (up to a safe ceiling) and return a
//     complete-as-possible set for the initial search. This is why older /
//     additional printings no longer disappear for cards with many prints.
//   * `page=<n>` given -> fetch exactly ONE Scryfall page (1-based). Used by the
//     "Load more printings" control so each click costs a single request.
//
// `unique=prints` is preserved throughout, so every printing / art / treatment
// remains separately selectable. Results are de-duplicated by Scryfall id.
//
// Response: { data: CardPrinting[], totalCards: number | null,
//             hasMore: boolean, page: number }
// An empty/short query yields an empty list rather than an error, matching the
// repository contract.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }
  try {
    await requireStaff(req);

    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      return sendJson(res, 200, {
        data: [],
        totalCards: 0,
        hasMore: false,
        page: 1,
      });
    }

    // Parse an optional 1-based page. Absent/invalid -> initial multi-page walk.
    const rawPage = req.query.page;
    const pageNum =
      typeof rawPage === "string" && rawPage.trim() !== ""
        ? Number.parseInt(rawPage, 10)
        : null;
    const wantsSinglePage =
      pageNum != null && Number.isFinite(pageNum) && pageNum >= 1;

    try {
      if (wantsSinglePage) {
        const result = await scryfallSearchPage(q, pageNum!);
        return sendJson(res, 200, {
          data: normalizeScryfallCards(result.data),
          totalCards: result.totalCards,
          hasMore: result.hasMore,
          page: pageNum,
          warnings: result.warnings,
        });
      }

      const result = await scryfallSearch(q);
      return sendJson(res, 200, {
        data: normalizeScryfallCards(result.data),
        totalCards: result.totalCards,
        hasMore: result.hasMore,
        page: 1,
        warnings: result.warnings,
      });
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
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}