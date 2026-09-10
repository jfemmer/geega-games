import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import {
  scryfallById,
  scryfallBySetCollector,
} from "../../_lib/scryfall.js";
import { normalizeScryfallCard } from "../../../src/admin/services/scryfall.js";

// GET /api/admin/scryfall/card?id=<scryfallId>
// GET /api/admin/scryfall/card?set=<code>&cn=<collectorNumber>
//
// Staff-only proxy to fetch a single exact printing, normalized to CardPrinting.
// Returns { data: CardPrinting | null }.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }
  try {
    await requireStaff(req);

    const id = typeof req.query.id === "string" ? req.query.id.trim() : "";
    const set = typeof req.query.set === "string" ? req.query.set.trim() : "";
    const cn = typeof req.query.cn === "string" ? req.query.cn.trim() : "";

    try {
      if (id) {
        const card = await scryfallById(id);
        return sendJson(res, 200, { data: normalizeScryfallCard(card) });
      }
      if (set && cn) {
        const card = await scryfallBySetCollector(set, cn);
        return sendJson(res, 200, { data: normalizeScryfallCard(card) });
      }
      throw new HttpError(400, "Provide either id, or set and cn.");
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        return sendJson(res, 200, { data: null });
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
