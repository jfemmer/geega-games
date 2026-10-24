import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, sendJson } from "./_lib/http.js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { checkRateLimit, getClientIp } from "./_lib/rateLimit.js";
import { customerTradeView, type TradeRow } from "./_lib/trades.js";
import { TRADE_TOKEN_RE } from "../src/store/lib/trades.js";

// GET /api/trade?t=<token>
//
// PUBLIC: a confirmed trade for the customer's link page (/trade?t=…), sent
// by text or email from Admin → Trade Evaluator. The token in the link is
// the only key: a wrong one and no such trade look the same. Shows the
// cards, prices and totals as agreed — never the customer's phone or email,
// or anything about staff.

const RATE_LIMIT_PER_WINDOW = 60;
const RATE_WINDOW_MS = 10 * 60_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  res.setHeader("Cache-Control", "no-store");
  try {
    const rl = checkRateLimit("trade", getClientIp(req), RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many tries. Please wait a bit and try again.");
    }
    const token = typeof req.query.t === "string" ? req.query.t : "";
    if (!TRADE_TOKEN_RE.test(token)) throw new HttpError(404, "We couldn't find that trade. Check the link, or ask us to send it again.");

    const { data, error } = await getSupabaseAdmin().from("trades").select("*").eq("share_token", token).maybeSingle();
    if (error) throw new HttpError(500, "We couldn't load your trade. Please try again.");
    if (!data) throw new HttpError(404, "We couldn't find that trade. Check the link, or ask us to send it again.");
    return sendJson(res, 200, { ok: true, trade: customerTradeView(data as TradeRow) });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/trade] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}
