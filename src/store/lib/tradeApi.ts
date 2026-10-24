import { TRADE_TOKEN_RE, type TradeView } from "./trades";

// The customer's side of a confirmed trade: GET /api/trade?t=<token> (see
// api/trade.ts). The token from the link they were texted or emailed is the
// only key.

const NOT_FOUND = "We couldn't find that trade. Check the link, or ask us to send it again.";

/** A confirmed trade for its link page. Throws an error with a message to show when it can't be loaded. */
export async function loadTrade(token: string): Promise<TradeView> {
  if (!TRADE_TOKEN_RE.test(token)) throw new Error(NOT_FOUND);
  let res: Response;
  try {
    res = await fetch(`/api/trade?t=${encodeURIComponent(token)}`, { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new Error("We couldn't reach the server. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; trade?: TradeView } | null;
  if (!res.ok || !body?.trade) throw new Error(body?.message || "Something went wrong. Please try again.");
  return body.trade;
}
