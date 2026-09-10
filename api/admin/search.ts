import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { scryfallSearch } from "../../_lib/scryfall.js";
import { normalizeScryfallCards } from "../../../src/admin/services/scryfall.js";

// GET /api/admin/scryfall/search?q=<query>
//
// Staff-only proxy to Scryfall's card search. Normalizes results server-side
// into Geega's CardPrinting shape so the browser depends only on our domain
// type. Returns { data: CardPrinting[] }. An empty query yields an empty list
// rather than an error, matching the repository contract.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }
  try {
    await requireStaff(req);

    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      return sendJson(res, 200, { data: [] });
    }

    try {
      const list = await scryfallSearch(q);
      const data = normalizeScryfallCards(list.data ?? []);
      return sendJson(res, 200, { data });
    } catch (err) {
      // A Scryfall 404 means "no cards matched" — return an empty list.
      if (err instanceof HttpError && err.status === 404) {
        return sendJson(res, 200, { data: [] });
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
