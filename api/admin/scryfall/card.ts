import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import {
  scryfallById,
  scryfallResolveExact,
} from "../../_lib/scryfall.js";
import { normalizeScryfallCard } from "../../../src/admin/services/scryfall.js";

// GET /api/admin/scryfall/card?id=<scryfallId>
// GET /api/admin/scryfall/card?set=<code>&cn=<collectorNumber>
//                              [&name=<cardName>][&finish=<finish>]
//
// Staff-only proxy to fetch a single EXACT printing, normalized to CardPrinting.
// When set+cn (and ideally name) are given, uses the high-accuracy resolver
// (scryfallResolveExact): exact id → exact set/cn (with collector-number
// variants) → targeted name+set+cn search → name+set search, scoring candidates
// by set + collector + finish and NEVER returning a name mismatch.
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
    const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
    const finish =
      typeof req.query.finish === "string" ? req.query.finish.trim() : "";

    try {
      // Pure id lookup (no other signals) — fetch directly.
      if (id && !set && !cn && !name) {
        const card = await scryfallById(id);
        return sendJson(res, 200, { data: normalizeScryfallCard(card) });
      }

      // Any identity signals present -> use the accurate multi-signal resolver.
      if (id || (set && cn) || (name && set)) {
        const card = await scryfallResolveExact({
          scryfallId: id || null,
          cardName: name || null,
          setCode: set || null,
          collectorNumber: cn || null,
          finish: finish || null,
        });
        return sendJson(res, 200, {
          data: card ? normalizeScryfallCard(card) : null,
        });
      }

      throw new HttpError(400, "Provide id, or set and cn, or name and set.");
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