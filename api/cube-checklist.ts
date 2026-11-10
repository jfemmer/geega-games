import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "./_lib/http.js";
import { checkRateLimit, getClientIp } from "./_lib/rateLimit.js";
import {
  WRITE_ACTIONS,
  cleanText,
  getListByToken,
  runCardAction,
  type CardActionBody,
} from "./_lib/cubeChecklist.js";
import { CHECKLIST_LIMITS } from "../src/store/lib/cubeChecklist.js";

// POST /api/cube-checklist — the public share link (/cube-checklist?t=<token>).
// No login: the secret token in the link is the access. Staff can turn a link
// off or replace it in the admin (api/admin/cube-checklists.ts).
//
//   { token, action: "get", since? }                     -> { view }
//   { token, who, action: "found", cardId, found }       -> { card }
//   { token, who, action: "swap", cardId, newName }      -> { card }
//   { token, who, action: "unswap", cardId }             -> { card }
//   { token, action: "suggest", cardId }                 -> { options }
//   { token, action: "search", query }                   -> { options }
//   { token, action: "printings", name, page? }          -> { printings, hasMore }
//   { token, action: "upgrades" }                        -> { upgradesView }  (low-rated cards + list swaps)
//
// "who" is the name the person typed on their phone, shown next to what they
// found or swapped. It's a label, not an identity: anyone with the link can
// use any name, which is fine for a list friends share.

const MAX_BODY_BYTES = 4 * 1024;
const WINDOW_MS = 10 * 60_000;
// Per IP, per 10 minutes. The page refreshes about every 10s while open, and
// friends sorting together may share one Wi-Fi address.
const LIMITS: Record<string, number> = {
  get: 600,
  found: 900,
  swap: 120,
  unswap: 120,
  suggest: 240,
  search: 400,
  printings: 400,
  upgrades: 120,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const body = (await readJsonBody(req, MAX_BODY_BYTES)) as CardActionBody & {
      token?: unknown;
      who?: unknown;
    };
    const action = String(body.action ?? "");
    const limit = LIMITS[action];
    if (!limit) throw new HttpError(400, "Unknown action.");

    const rl = checkRateLimit(`cube-checklist-${action}`, getClientIp(req), limit, WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many requests. Please wait a moment and try again.");
    }

    const list = await getListByToken(body.token);
    const who = WRITE_ACTIONS.has(action) ? cleanText(body.who, CHECKLIST_LIMITS.personName) : null;
    const result = await runCardAction(list, body, who);
    res.setHeader("Cache-Control", "no-store");
    return sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
