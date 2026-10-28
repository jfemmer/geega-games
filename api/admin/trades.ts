import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { requireStaff, type StaffContext } from "../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { logAdminAction } from "../_lib/auditLog.js";
import { generateToken, normalizeEmail } from "../_lib/tokens.js";
import { staffTradeView, type TradeRow } from "../_lib/trades.js";
import { sendTradeSummaryEmail } from "../_lib/tradeEmails.js";
import {
  MAX_CARD_NAME,
  MAX_CUSTOMER_NAME,
  MAX_TCG_LOW_CENTS,
  MAX_TRADE_CREDIT_PERCENT,
  MAX_TRADE_LINES,
  MAX_TRADE_QUANTITY,
  isTextablePhone,
  regularPriceCents,
  tradeTotals,
} from "../../src/admin/utils/tradeEvaluator.js";
import type { TradeCardPrinting, TradeTheirCard } from "../../src/store/lib/trades.js";

// Trades from Admin → Trade Evaluator (public.trades).
//
//   GET  /api/admin/trades                    → { trades }   the 25 newest
//   POST { action: "confirm", customer, creditPercent, theirs, yours } → { trade }
//   POST { action: "email", tradeId, email }  → { trade, sent }   emails the link
//   POST { action: "texted", tradeId, phone } → { trade }         notes a text went out
//
// Confirming works the numbers out here, not in the browser. The customer's
// cards come as typed (TCG low, quantity, an optional name, and the exact
// printing and condition when staff found the card with the card search) and
// count at the trade credit percentage. The shop's cards come as inventory ids and
// quantities: each is read fresh from inventory, must be listed (active,
// with a price) and in stock, and is priced at its regular website price —
// never a deal, storewide-sale or member price (regularPriceCents). Each also
// carries the price staff were shown; if the website price has changed since,
// the trade is refused, so a customer is never sent a total other than the
// one they agreed to. The trade is stored as it was, with a secret link
// (/trade?t=…) for the customer.
//
// Confirming records the trade and nothing else: inventory and store credit
// don't change. Texts go out from staff's own phones (the browser opens the
// messaging app), so "texted" only notes when, and to which number.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Up to MAX_TRADE_LINES lines a side, ~100 bytes each. */
const MAX_BODY_BYTES = 64 * 1024;
const RECENT_TRADES = 25;
/** The largest total the trades table's integer columns hold. */
const MAX_TOTAL_CENTS = 2_147_483_647;

type InventoryForTrade = {
  id: string;
  card_name: string;
  set_name: string | null;
  set_code: string;
  collector_number: string;
  condition: string;
  finish: string;
  variant_type: string | null;
  quantity: number;
  status: string;
  price_cents: number | null;
  original_price_cents: number | null;
  is_deal: boolean | null;
  /** business or consigned. Consigned copies are sale-only. */
  ownership: string;
};

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

const wholeNumber = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;

function readCustomer(raw: unknown): { name: string; phone: string | null; email: string | null } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = cleanText(o.name, MAX_CUSTOMER_NAME);
  if (!name) throw new HttpError(400, "Enter the customer's name.");
  const phone = cleanText(o.phone, 32);
  if (phone && !isTextablePhone(phone)) throw new HttpError(400, "That phone number doesn't look right.");
  const emailText = cleanText(o.email, 254);
  const email = emailText ? normalizeEmail(emailText) : null;
  if (emailText && !email) throw new HttpError(400, "That email address doesn't look right.");
  return { name, phone, email };
}

const CONDITIONS = new Set(["NM", "LP", "MP", "HP", "DMG"]);

/** The printing of a card found with the card search; null for a line typed by hand. */
function readPrinting(raw: unknown): TradeCardPrinting | null {
  if (raw === undefined || raw === null) return null;
  const o = (typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const scryfallId = typeof o.scryfallId === "string" && UUID.test(o.scryfallId) ? o.scryfallId.toLowerCase() : null;
  const setCode = cleanText(o.setCode, 12);
  const collectorNumber = cleanText(o.collectorNumber, 16);
  const condition = typeof o.condition === "string" && CONDITIONS.has(o.condition) ? o.condition : null;
  const finish = typeof o.finish === "string" && /^[a-z]{2,20}$/.test(o.finish) ? o.finish : null;
  if (!scryfallId || !setCode || !collectorNumber || !condition || !finish) {
    throw new HttpError(400, "One of their cards didn't come through. Try again.");
  }
  return { scryfallId, setName: cleanText(o.setName, 120), setCode, collectorNumber, condition, finish };
}

function readTheirCards(raw: unknown): TradeTheirCard[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_TRADE_LINES) throw new HttpError(400, "Their cards didn't come through. Try again.");
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const quantity = wholeNumber(o.quantity, 1, MAX_TRADE_QUANTITY);
    const tcgLowCents = wholeNumber(o.tcgLowCents, 0, MAX_TCG_LOW_CENTS);
    if (quantity === null || tcgLowCents === null) {
      throw new HttpError(400, "One of their cards has a price or quantity that isn't a number.");
    }
    return { name: cleanText(o.name, MAX_CARD_NAME), quantity, tcgLowCents, printing: readPrinting(o.printing) };
  });
}

interface WantedCard {
  quantity: number;
  /** The regular website price staff were shown, when the page sent it. */
  shownPriceCents: number | null;
}

/** The shop's cards as inventory ids and quantities, one entry per card. */
function readYourCards(raw: unknown): Map<string, WantedCard> {
  const wanted = new Map<string, WantedCard>();
  if (raw === undefined) return wanted;
  if (!Array.isArray(raw) || raw.length > MAX_TRADE_LINES) throw new HttpError(400, "Your cards didn't come through. Try again.");
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const id = typeof o.inventoryItemId === "string" && UUID.test(o.inventoryItemId) ? o.inventoryItemId : null;
    const quantity = wholeNumber(o.quantity, 1, MAX_TRADE_QUANTITY);
    const shownPriceCents = o.priceCents === undefined ? null : wholeNumber(o.priceCents, 0, Number.MAX_SAFE_INTEGER);
    if (!id || quantity === null || (o.priceCents !== undefined && shownPriceCents === null)) {
      throw new HttpError(400, "One of your cards didn't come through. Try again.");
    }
    const earlier = wanted.get(id);
    wanted.set(id, {
      quantity: (earlier?.quantity ?? 0) + quantity,
      shownPriceCents: earlier ? earlier.shownPriceCents : shownPriceCents,
    });
  }
  return wanted;
}

function describe(item: InventoryForTrade): string {
  return `${item.card_name} (${item.set_code} ${item.condition}${item.finish !== "nonfoil" ? ` ${item.finish}` : ""})`;
}

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

async function loadTrade(admin: ReturnType<typeof getSupabaseAdmin>, tradeId: unknown): Promise<TradeRow> {
  if (typeof tradeId !== "string" || !UUID.test(tradeId)) throw new HttpError(400, "Which trade?");
  const { data, error } = await admin.from("trades").select("*").eq("id", tradeId).maybeSingle();
  if (error) throw new HttpError(500, "Could not load the trade.");
  if (!data) throw new HttpError(404, "That trade isn't there any more.");
  return data as TradeRow;
}

async function confirm(staff: StaffContext, body: Record<string, unknown>) {
  const admin = getSupabaseAdmin();
  const customer = readCustomer(body.customer);
  const creditPercent = wholeNumber(body.creditPercent, 1, MAX_TRADE_CREDIT_PERCENT);
  if (creditPercent === null) throw new HttpError(400, `Choose a trade credit from 1 to ${MAX_TRADE_CREDIT_PERCENT}%.`);
  const theirCards = readTheirCards(body.theirs);
  const wanted = readYourCards(body.yours);
  if (theirCards.length === 0 && wanted.size === 0) throw new HttpError(400, "Add the cards on at least one side of the trade.");

  let inventory: InventoryForTrade[] = [];
  if (wanted.size > 0) {
    const { data, error } = await admin
      .from("inventory_items")
      .select(
        "id, card_name, set_name, set_code, collector_number, condition, finish, variant_type, quantity, status, price_cents, original_price_cents, is_deal, ownership",
      )
      .in("id", [...wanted.keys()]);
    if (error) throw new HttpError(500, "Could not load your cards from inventory.");
    inventory = (data ?? []) as InventoryForTrade[];
  }
  const repriced: string[] = [];
  const yourCards = [...wanted].map(([id, { quantity, shownPriceCents }]) => {
    const item = inventory.find((row) => row.id === id);
    if (!item) throw new HttpError(409, "One of your cards isn't in inventory any more. Take it off the trade.");
    if (item.ownership === "consigned") {
      throw new HttpError(409, `${describe(item)} is a consigned card. Consigned cards are for sale only, not for trade. Take it off the trade.`);
    }
    const priceCents = regularPriceCents({ priceCents: item.price_cents, originalPriceCents: item.original_price_cents, isDeal: item.is_deal });
    if (item.status !== "active" || priceCents === null || priceCents <= 0) {
      throw new HttpError(409, `${describe(item)} isn't for sale on the website right now. Take it off the trade.`);
    }
    if (item.quantity < quantity) {
      throw new HttpError(409, `Only ${item.quantity} of ${describe(item)} ${item.quantity === 1 ? "is" : "are"} in stock.`);
    }
    if (shownPriceCents !== null && shownPriceCents !== priceCents) {
      repriced.push(`${describe(item)} is now ${money(priceCents)}, not ${money(shownPriceCents)}`);
    }
    return {
      inventoryItemId: item.id,
      cardName: item.card_name,
      setName: item.set_name,
      setCode: item.set_code,
      collectorNumber: item.collector_number,
      condition: item.condition,
      finish: item.finish,
      variantType: item.variant_type?.trim() || null,
      quantity,
      priceCents,
    };
  });
  if (repriced.length > 0) {
    throw new HttpError(
      409,
      `The website price changed since you added ${repriced.length === 1 ? "this card" : "these cards"}: ${repriced.join("; ")}. Check the new total with them, then confirm again.`,
    );
  }

  const theirTcgLowCents = theirCards.reduce((sum, card) => sum + card.tcgLowCents * card.quantity, 0);
  const yourCardsCents = yourCards.reduce((sum, card) => sum + card.priceCents * card.quantity, 0);
  const totals = tradeTotals(theirTcgLowCents, yourCardsCents, creditPercent);
  // The totals are integer columns: far past any real trade, but a typo could get there.
  if ([totals.theirTcgLowCents, totals.creditCents, totals.yourCents].some((cents) => cents > MAX_TOTAL_CENTS)) {
    throw new HttpError(400, "That trade adds up to more than we can save. Check the prices and quantities.");
  }

  const { data, error } = await admin
    .from("trades")
    .insert({
      share_token: generateToken(24),
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_email: customer.email,
      credit_percent: creditPercent,
      their_cards: theirCards.map(({ name, quantity, tcgLowCents, printing }) => ({
        name,
        quantity,
        tcgLowCents,
        printing: printing && { ...printing },
      })),
      your_cards: yourCards,
      their_tcg_low_cents: totals.theirTcgLowCents,
      credit_cents: totals.creditCents,
      your_cards_cents: totals.yourCents,
      balance_cents: totals.balanceCents,
      confirmed_by: staff.userId,
      confirmed_by_email: staff.email,
    })
    .select("*")
    .single();
  if (error || !data) {
    console.error("[admin/trades] confirm failed", error);
    throw new HttpError(500, "Could not save the trade. Try again.");
  }
  const trade = data as TradeRow;
  await logAdminAction(admin, staff, {
    action: "trade.confirm",
    resourceType: "trade",
    resourceId: trade.id,
    before: null,
    after: { tradeNumber: trade.trade_number, customerName: trade.customer_name, balanceCents: trade.balance_cents },
  });
  return trade;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const staff = await requireStaff(req);
    const admin = getSupabaseAdmin();

    if (req.method === "GET") {
      const { data, error } = await admin
        .from("trades")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(RECENT_TRADES);
      if (error) throw new HttpError(500, "Could not load recent trades.");
      return sendJson(res, 200, { ok: true, trades: ((data ?? []) as TradeRow[]).map(staffTradeView) });
    }
    if (req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"]);

    const body = await readJsonBody(req, MAX_BODY_BYTES);

    if (body.action === "confirm") {
      const trade = await confirm(staff, body);
      return sendJson(res, 200, { ok: true, trade: staffTradeView(trade) });
    }

    if (body.action === "email") {
      const trade = await loadTrade(admin, body.tradeId);
      const email = normalizeEmail(body.email);
      if (!email) throw new HttpError(400, "Enter an email address to send it to.");
      const result = await sendTradeSummaryEmail(trade, email);
      if (result.status === "failed") {
        console.error("[admin/trades] email failed", trade.id, result.error);
        throw new HttpError(502, "The email didn't send. Try again, or text them the link.");
      }
      const { data, error } = await admin
        .from("trades")
        .update({ customer_email: email, emailed_to: email, emailed_at: new Date().toISOString() })
        .eq("id", trade.id)
        .select("*")
        .single();
      if (error || !data) throw new HttpError(500, "The email went out, but the trade wasn't updated.");
      return sendJson(res, 200, { ok: true, sent: result.status, trade: staffTradeView(data as TradeRow) });
    }

    if (body.action === "texted") {
      const trade = await loadTrade(admin, body.tradeId);
      const phone = cleanText(body.phone, 32);
      if (!phone || !isTextablePhone(phone)) throw new HttpError(400, "That phone number doesn't look right.");
      const { data, error } = await admin
        .from("trades")
        .update({ customer_phone: phone, texted_to: phone, texted_at: new Date().toISOString() })
        .eq("id", trade.id)
        .select("*")
        .single();
      if (error || !data) throw new HttpError(500, "Could not update the trade.");
      return sendJson(res, 200, { ok: true, trade: staffTradeView(data as TradeRow) });
    }

    throw new HttpError(400, "Unknown action.");
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[admin/trades] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}
