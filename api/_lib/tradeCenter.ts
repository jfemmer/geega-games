import type { VercelRequest } from "@vercel/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../src/types/database.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { HttpError } from "./http.js";
import { scryfallCollection } from "./scryfall.js";
import { cachePrinting } from "./inventory.js";
import { normalizeScryfallCard } from "../../src/admin/services/scryfall.js";
import { checkUsAddress, SHIP_TO_COUNTRY } from "../../src/store/lib/usAddress.js";
import {
  CARD_CONDITIONS,
  CUSTOMER_TIMELINE_LABELS,
  TRADE_LIMITS,
  conditionPercent,
  eligibilityFor,
  estimatedUnitCents,
  isConditionCode,
  isTradeFinish,
  isTradeStatus,
  type CardConditionCode,
  type ConditionPercents,
  type CustomerTrade,
  type CustomerTradeSummary,
  type StaffTrade,
  type StaffTradeOfferCard,
  type StaffTradeSummary,
  type TradeAddress,
  type TradeEligibility,
  type TradeFinish,
  type TradeMessage,
  type TradeOfferCard,
  type TradeOfferInput,
  type TradeSettings,
  type TradeShipToInput,
  type TradeStatus,
  type TradeTerms,
  type TradeWantedInput,
  type TradeWantedItem,
} from "../../src/store/lib/tradeCenter.js";

// Server side of the Trade Center (api/trade-center.ts for customers,
// api/admin/trade-center.ts for staff): reading settings, turning database
// rows into what each side may see, checking what the browser sends, pricing
// the customer's cards, and turning database errors into answers. Every
// change itself happens in the trade_* database functions
// (supabase/migrations/20261025120000_trade_center.sql), each in one
// transaction under the trade's row lock.

export type Admin = SupabaseClient<Database>;
export type TradeRow = Database["public"]["Tables"]["trade_requests"]["Row"];
export type TradeItemRow = Database["public"]["Tables"]["trade_request_items"]["Row"];
export type TradeOfferRow = Database["public"]["Tables"]["trade_offer_cards"]["Row"];
export type TradeEventRow = Database["public"]["Tables"]["trade_events"]["Row"];
export type TradeMessageRow = Database["public"]["Tables"]["trade_messages"]["Row"];
export type TradeSettingsRow = Database["public"]["Tables"]["trade_settings"]["Row"];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Trimmed text clipped to maxLength, or null when blank or not a string. */
export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export function wholeNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export function readTradeId(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new HttpError(400, "Which trade?");
  return value.toLowerCase();
}

// ---------------------------------------------------------------------------
// Who's asking
// ---------------------------------------------------------------------------

export interface TradeCustomer {
  userId: string;
  email: string | null;
  name: string | null;
}

/** The signed-in customer (a real account, verified with Supabase Auth), or 401. */
export async function requireCustomer(req: VercelRequest, admin: Admin = getSupabaseAdmin()): Promise<TradeCustomer> {
  const header = String(req.headers.authorization ?? "");
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === header) throw new HttpError(401, "Sign in to trade with us.");
  const { data, error } = await admin.auth.getUser(token);
  const user = data?.user;
  if (error || !user) throw new HttpError(401, "Your session ended. Sign in again to keep trading.");
  if ((user as { is_anonymous?: boolean }).is_anonymous) throw new HttpError(401, "Sign in to your account to trade with us.");
  let name: string | null = null;
  const { data: profile } = await admin.from("profiles").select("first_name, last_name").eq("id", user.id).maybeSingle();
  if (profile) name = cleanText(`${profile.first_name ?? ""} ${profile.last_name ?? ""}`, 120);
  return { userId: user.id, email: user.email ?? null, name };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function loadTradeSettings(admin: Admin = getSupabaseAdmin()): Promise<TradeSettingsRow> {
  const { data, error } = await admin.from("trade_settings").select("*").eq("id", true).maybeSingle();
  if (error || !data) {
    if (error) console.error("[tradeCenter] settings load failed", error.message);
    throw new HttpError(503, "Trading isn't available right now.");
  }
  return data;
}

export function conditionPercentsOf(row: Pick<
  TradeSettingsRow,
  "condition_nm_percent" | "condition_lp_percent" | "condition_mp_percent" | "condition_hp_percent" | "condition_dmg_percent"
>): ConditionPercents {
  return {
    NM: row.condition_nm_percent,
    LP: row.condition_lp_percent,
    MP: row.condition_mp_percent,
    HP: row.condition_hp_percent,
    DMG: row.condition_dmg_percent,
  };
}

/** A trade's stored condition percentages (its terms when it started). */
export function tradeConditionPercents(value: Json | null): ConditionPercents {
  const o = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const out = {} as ConditionPercents;
  for (const code of CARD_CONDITIONS) out[code] = conditionPercent(o as Partial<ConditionPercents>, code);
  return out;
}

export function hasShipToAddress(s: TradeSettingsRow): boolean {
  return Boolean(s.ship_to_line1?.trim() && s.ship_to_city?.trim() && s.ship_to_state?.trim() && s.ship_to_postal_code?.trim());
}

export function shipToAddress(s: TradeSettingsRow): TradeAddress | null {
  if (!hasShipToAddress(s)) return null;
  return {
    name: s.ship_to_name?.trim() || null,
    line1: s.ship_to_line1!.trim(),
    line2: s.ship_to_line2?.trim() || null,
    city: s.ship_to_city!.trim(),
    state: s.ship_to_state!.trim(),
    postalCode: s.ship_to_postal_code!.trim(),
  };
}

/** What the storefront is told: the terms customers trade on (never the address itself). */
export function termsOf(s: TradeSettingsRow): TradeTerms {
  return {
    enabled: s.enabled,
    paused: s.paused,
    pauseMessage: s.pause_message,
    creditRatePercent: s.credit_rate_percent,
    minCardValueCents: s.min_card_value_cents,
    conditionPercents: conditionPercentsOf(s),
    reservationHours: s.reservation_hours,
    revisionHours: s.revision_hours,
    shipBusinessDays: s.ship_business_days,
    shipGraceHours: s.ship_grace_hours,
    paymentDueDays: s.payment_due_days,
    maxActiveTrades: s.max_active_trades,
    maxWantedLines: s.max_wanted_lines,
    maxOfferedLines: s.max_offered_lines,
    minTradeValueCents: s.min_trade_value_cents,
    maxTradeValueCents: s.max_trade_value_cents,
    processingFeeCents: s.processing_fee_cents,
    cashPayoutEnabled: s.cash_payout_enabled,
    shippingPaidBy: s.shipping_paid_by === "store" ? "store" : "customer",
    packingInstructions: s.packing_instructions,
    returnPolicy: s.return_policy,
    excludedSetCodes: s.excluded_set_codes ?? [],
    excludedCardNames: s.excluded_card_names ?? [],
    overstockThreshold: s.overstock_threshold,
    hasShipToAddress: hasShipToAddress(s),
  };
}

/** Everything, for admin Trades → Settings. */
export function settingsView(s: TradeSettingsRow): TradeSettings {
  return {
    enabled: s.enabled,
    paused: s.paused,
    pauseMessage: s.pause_message,
    creditRatePercent: s.credit_rate_percent,
    minCardValueCents: s.min_card_value_cents,
    conditionPercents: conditionPercentsOf(s),
    reservationHours: s.reservation_hours,
    revisionHours: s.revision_hours,
    shipBusinessDays: s.ship_business_days,
    shipGraceHours: s.ship_grace_hours,
    transitAlertDays: s.transit_alert_days,
    paymentDueDays: s.payment_due_days,
    maxActiveTrades: s.max_active_trades,
    maxWantedLines: s.max_wanted_lines,
    maxOfferedLines: s.max_offered_lines,
    minTradeValueCents: s.min_trade_value_cents,
    maxTradeValueCents: s.max_trade_value_cents,
    maxExpiredTrades30d: s.max_expired_trades_30d,
    processingFeeCents: s.processing_fee_cents,
    cashPayoutEnabled: s.cash_payout_enabled,
    cashRatePercent: s.cash_rate_percent,
    overstockThreshold: s.overstock_threshold,
    excludedSetCodes: s.excluded_set_codes ?? [],
    excludedCardNames: s.excluded_card_names ?? [],
    notifyCustomer: s.notify_customer,
    notifyStaff: s.notify_staff,
    shippingPaidBy: s.shipping_paid_by === "store" ? "store" : "customer",
    shipTo: shipToAddress(s),
    packingInstructions: s.packing_instructions,
    returnPolicy: s.return_policy,
    updatedAt: s.updated_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Database errors → answers
// ---------------------------------------------------------------------------

/**
 * The trade functions raise their own codes (GT…, listed in the migration)
 * with messages written for whoever is looking at the page; those pass
 * through. Anything unexpected is logged and answered with `fallback`.
 */
export function tradeDbError(error: { code?: string; message?: string } | null | undefined, fallback: string): HttpError {
  const code = error?.code ?? "";
  const message = error?.message?.trim() || fallback;
  switch (code) {
    case "GT001":
      return new HttpError(503, message);
    case "GT002":
    case "GT003":
    case "GT004":
    case "GT008":
    case "GT009":
    case "GT011":
      return new HttpError(409, message);
    case "GT012":
      return new HttpError(409, "The hold on this trade ran out, so our cards were released. Start a new trade to try again.");
    case "GT005":
    case "GT006":
    case "GT010":
      return new HttpError(400, message);
    case "GT404":
      return new HttpError(404, message);
    case "42501":
      return new HttpError(403, "That isn't allowed.");
    case "22P02":
    case "23514":
    case "23502":
      return new HttpError(400, "Something on that didn't come through. Check it and try again.");
    default:
      console.error("[tradeCenter] database error", code, error?.message);
      return new HttpError(500, fallback);
  }
}

// ---------------------------------------------------------------------------
// Loading a trade
// ---------------------------------------------------------------------------

export interface TradeBundle {
  trade: TradeRow;
  items: TradeItemRow[];
  offers: TradeOfferRow[];
  events: TradeEventRow[];
  messages: TradeMessageRow[];
}

export async function loadTradeRow(admin: Admin, tradeId: string): Promise<TradeRow | null> {
  const { data, error } = await admin.from("trade_requests").select("*").eq("id", tradeId).maybeSingle();
  if (error) throw new HttpError(500, "We couldn't load that trade. Try again.");
  return data ?? null;
}

export async function loadTradeBundle(admin: Admin, tradeId: string): Promise<TradeBundle | null> {
  const trade = await loadTradeRow(admin, tradeId);
  if (!trade) return null;
  const [items, offers, events, messages] = await Promise.all([
    admin.from("trade_request_items").select("*").eq("trade_request_id", tradeId).order("created_at"),
    admin.from("trade_offer_cards").select("*").eq("trade_request_id", tradeId).order("position"),
    admin.from("trade_events").select("*").eq("trade_request_id", tradeId).order("created_at"),
    admin.from("trade_messages").select("*").eq("trade_request_id", tradeId).order("created_at"),
  ]);
  if (items.error || offers.error || events.error || messages.error) {
    throw new HttpError(500, "We couldn't load that trade. Try again.");
  }
  return {
    trade,
    items: items.data ?? [],
    offers: offers.data ?? [],
    events: events.data ?? [],
    messages: messages.data ?? [],
  };
}

/** A customer's own trade, or 404 (someone else's looks the same as none). */
export async function loadCustomerBundle(admin: Admin, tradeId: string, userId: string): Promise<TradeBundle> {
  const bundle = await loadTradeBundle(admin, tradeId);
  if (!bundle || bundle.trade.user_id !== userId) throw new HttpError(404, "That trade isn't there.");
  return bundle;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function statusOf(value: string): TradeStatus {
  return isTradeStatus(value) ? value : "awaiting_trade_list";
}

function conditionOf(value: string | null): CardConditionCode | null {
  return isConditionCode(value) ? value : null;
}

function wantedView(row: TradeItemRow): TradeWantedItem {
  return {
    id: row.id,
    inventoryItemId: row.inventory_item_id,
    cardName: row.card_name,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    condition: row.condition,
    finish: row.finish,
    variantType: row.variant_type,
    imageUrl: row.image_url,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    status: row.status === "released" || row.status === "fulfilled" ? row.status : "reserved",
  };
}

function offerView(row: TradeOfferRow): TradeOfferCard {
  return {
    id: row.id,
    scryfallId: row.scryfall_id,
    cardName: row.card_name,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    finish: row.finish,
    imageUrl: row.image_url,
    quantity: row.quantity,
    reportedCondition: conditionOf(row.reported_condition) ?? "NM",
    customerEstimateCents: row.customer_estimate_cents,
    customerNote: row.customer_note,
    referencePriceCents: row.reference_price_cents,
    referenceCheckedAt: row.reference_checked_at,
    conditionPercent: row.condition_percent,
    estimatedUnitCents: row.estimated_unit_cents,
    eligibility: row.eligibility as TradeEligibility,
    reviewStatus: row.review_status === "approved" || row.review_status === "rejected" ? row.review_status : "pending",
    approvedQuantity: row.approved_quantity,
    approvedUnitCents: row.approved_unit_cents,
    reviewNote: row.review_note,
    receivedQuantity: row.received_quantity,
    verifiedCondition: conditionOf(row.verified_condition),
    finalQuantity: row.final_quantity,
    finalUnitCents: row.final_unit_cents,
    flags: row.flags ?? [],
    inspectionNote: row.inspection_note,
    inspected: row.inspected_at !== null,
    disposition: (["pending", "accepted", "rejected", "returned", "imported"].includes(row.disposition)
      ? row.disposition
      : "pending") as TradeOfferCard["disposition"],
  };
}

function messageView(row: TradeMessageRow, forStaff: boolean): TradeMessage {
  return {
    id: row.id,
    authorType: row.author_type === "staff" || row.author_type === "system" ? row.author_type : "customer",
    authorLabel: forStaff ? row.author_label : null,
    body: row.body,
    createdAt: row.created_at,
    visibleToCustomer: row.visible_to_customer,
  };
}

function shipToOf(t: TradeRow): TradeAddress | null {
  if (!t.ship_line1) return null;
  return {
    name: t.ship_name,
    line1: t.ship_line1,
    line2: t.ship_line2,
    city: t.ship_city ?? "",
    state: t.ship_state ?? "",
    postalCode: t.ship_postal_code ?? "",
  };
}

/** Where the customer mails their cards: shown once approved, until it arrives. */
const MAIL_TO_STATUSES: ReadonlySet<TradeStatus> = new Set(["awaiting_shipment", "in_transit"]);

function baseView(t: TradeRow, items: TradeItemRow[], messages: TradeMessageRow[], forStaff: boolean, settings: TradeSettingsRow | null) {
  const status = statusOf(t.status);
  const showMailTo = settings !== null && MAIL_TO_STATUSES.has(status);
  return {
    id: t.id,
    tradeNumber: t.trade_number,
    status,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    creditRatePercent: t.credit_rate_percent,
    minCardValueCents: t.min_card_value_cents,
    conditionPercents: tradeConditionPercents(t.condition_percents),
    processingFeeCents: t.processing_fee_cents,
    wantedTotalCents: t.wanted_total_cents,
    estimatedValueCents: t.estimated_value_cents,
    approvedValueCents: t.approved_value_cents,
    finalValueCents: t.final_value_cents,
    finalCreditCents: t.final_credit_cents,
    shippingCents: t.shipping_cents,
    amountDueCents: t.amount_due_cents,
    excessCents: t.excess_cents,
    excessHandling: t.excess_handling === "cash" ? ("cash" as const) : ("store_credit" as const),
    cashPayoutCents: t.cash_payout_cents,
    holdExpiresAt: t.hold_expires_at,
    shipBy: t.ship_by,
    paymentDueAt: t.payment_due_at,
    approvalConditions: t.approval_conditions,
    inboundCarrier: t.inbound_carrier,
    inboundTracking: t.inbound_tracking,
    returnCarrier: t.return_carrier,
    returnTracking: t.return_tracking,
    orderId: t.order_id,
    creditIssuedCents: t.credit_issued_cents,
    customerNote: t.customer_note,
    closeReason: t.close_reason,
    shipTo: shipToOf(t),
    wanted: items.map(wantedView),
    messages: messages.filter((m) => forStaff || m.visible_to_customer).map((m) => messageView(m, forStaff)),
    mailTo: showMailTo && settings ? shipToAddress(settings) : null,
    packingInstructions: showMailTo && settings ? settings.packing_instructions : null,
    returnPolicy: settings?.return_policy ?? "",
  };
}

/**
 * A card as its customer sees it. Staff's review stays private while they're
 * still reviewing (pending_review), and the inspection while they're still
 * inspecting (received, under_inspection): the customer sees the decisions
 * once they're made (approval, a request for changes, the final offer).
 */
function customerOfferView(row: TradeOfferRow, status: string): TradeOfferCard {
  const card = offerView(row);
  if (status === "pending_review") {
    return { ...card, reviewStatus: "pending", approvedQuantity: null, approvedUnitCents: null, reviewNote: null };
  }
  if (status === "received" || status === "under_inspection") {
    return {
      ...card,
      receivedQuantity: null,
      verifiedCondition: null,
      finalQuantity: null,
      finalUnitCents: null,
      flags: [],
      inspectionNote: null,
      inspected: false,
    };
  }
  return card;
}

export function customerTradeView(bundle: TradeBundle, settings: TradeSettingsRow): CustomerTrade {
  const { trade, items, offers, events, messages } = bundle;
  return {
    ...baseView(trade, items, messages, false, settings),
    offered: offers.map((row) => customerOfferView(row, trade.status)),
    timeline: events
      .filter((e) => CUSTOMER_TIMELINE_LABELS[e.event] !== undefined)
      .map((e) => ({ event: e.event, label: CUSTOMER_TIMELINE_LABELS[e.event], createdAt: e.created_at })),
  };
}

function staffOfferView(row: TradeOfferRow): StaffTradeOfferCard {
  return {
    ...offerView(row),
    internalNote: row.internal_note,
    inspectionInternalNote: row.inspection_internal_note,
    authenticity: (["authentic", "counterfeit", "unsure"].includes(row.authenticity)
      ? row.authenticity
      : "unchecked") as StaffTradeOfferCard["authenticity"],
    inspectedAt: row.inspected_at,
    stockOnHand: row.stock_on_hand,
    importedInventoryItemId: row.imported_inventory_item_id,
  };
}

export function staffTradeView(bundle: TradeBundle, settings: TradeSettingsRow | null): StaffTrade {
  const { trade: t, items, offers, events, messages } = bundle;
  return {
    ...baseView(t, items, messages, true, settings),
    userId: t.user_id,
    customerName: t.customer_name,
    customerEmail: t.customer_email,
    offered: offers.map(staffOfferView),
    events: events.map((e) => ({
      id: e.id,
      actorType: e.actor_type === "staff" || e.actor_type === "system" ? e.actor_type : "customer",
      actorLabel: e.actor_label,
      event: e.event,
      fromStatus: e.from_status,
      toStatus: e.to_status,
      detail: (e.detail && typeof e.detail === "object" && !Array.isArray(e.detail) ? e.detail : {}) as Record<string, unknown>,
      createdAt: e.created_at,
    })),
    submittedAt: t.submitted_at,
    approvedAt: t.approved_at,
    receivedAt: t.received_at,
    finalOfferAt: t.final_offer_at,
    acceptedAt: t.accepted_at,
    paidAt: t.paid_at,
    completedAt: t.completed_at,
    closedAt: t.closed_at,
    inboundShippedAt: t.inbound_shipped_at,
    returnedAt: t.returned_at,
    cashPaidAt: t.cash_paid_at,
    paymentReference: t.payment_reference,
  };
}

export function customerSummaryView(t: TradeRow, wantedCount: number, offeredCount: number): CustomerTradeSummary {
  return {
    id: t.id,
    tradeNumber: t.trade_number,
    status: statusOf(t.status),
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    wantedTotalCents: t.wanted_total_cents,
    wantedCount,
    offeredCount,
    holdExpiresAt: t.hold_expires_at,
    shipBy: t.ship_by,
    paymentDueAt: t.payment_due_at,
  };
}

export function staffSummaryView(t: TradeRow): StaffTradeSummary {
  return {
    id: t.id,
    tradeNumber: t.trade_number,
    status: statusOf(t.status),
    customerName: t.customer_name,
    customerEmail: t.customer_email,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    submittedAt: t.submitted_at,
    wantedTotalCents: t.wanted_total_cents,
    estimatedValueCents: t.estimated_value_cents,
    approvedValueCents: t.approved_value_cents,
    finalValueCents: t.final_value_cents,
    holdExpiresAt: t.hold_expires_at,
    shipBy: t.ship_by,
    paymentDueAt: t.payment_due_at,
    inboundCarrier: t.inbound_carrier,
    inboundTracking: t.inbound_tracking,
    inboundShippedAt: t.inbound_shipped_at,
  };
}

// ---------------------------------------------------------------------------
// What the browser sends
// ---------------------------------------------------------------------------

/** Our cards: inventory ids and quantities, repeated ids added together. */
export function readWantedInputs(raw: unknown, maxLines: number): TradeWantedInput[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "Your cards didn't come through. Try again.");
  const merged = new Map<string, number>();
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const id = typeof o.inventoryItemId === "string" && UUID_RE.test(o.inventoryItemId) ? o.inventoryItemId.toLowerCase() : null;
    const quantity = wholeNumber(o.quantity, 1, TRADE_LIMITS.maxQuantity);
    if (!id || quantity === null) throw new HttpError(400, "One of the cards didn't come through. Try again.");
    merged.set(id, (merged.get(id) ?? 0) + quantity);
  }
  if (merged.size > maxLines) throw new HttpError(400, `A trade can have up to ${maxLines} different cards of ours.`);
  return [...merged].map(([inventoryItemId, quantity]) => {
    if (quantity > TRADE_LIMITS.maxQuantity) throw new HttpError(400, `Choose up to ${TRADE_LIMITS.maxQuantity} of a card.`);
    return { inventoryItemId, quantity };
  });
}

/** The customer's cards. The same printing, finish and condition twice becomes one line. */
export function readOfferInputs(raw: unknown, maxLines: number): TradeOfferInput[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "Your cards didn't come through. Try again.");
  const merged = new Map<string, TradeOfferInput>();
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const scryfallId = typeof o.scryfallId === "string" && UUID_RE.test(o.scryfallId) ? o.scryfallId.toLowerCase() : null;
    const finish = isTradeFinish(o.finish) ? o.finish : null;
    const condition = isConditionCode(o.condition) ? o.condition : null;
    const quantity = wholeNumber(o.quantity, 1, TRADE_LIMITS.maxQuantity);
    const id = typeof o.id === "string" && UUID_RE.test(o.id) ? o.id.toLowerCase() : undefined;
    const estimate =
      o.customerEstimateCents === undefined || o.customerEstimateCents === null
        ? null
        : wholeNumber(o.customerEstimateCents, 0, TRADE_LIMITS.maxEstimateCents);
    if (!scryfallId || !finish || !condition || quantity === null) {
      throw new HttpError(400, "One of your cards is missing its printing, finish, condition or quantity.");
    }
    if (o.customerEstimateCents !== undefined && o.customerEstimateCents !== null && estimate === null) {
      throw new HttpError(400, "One of your price notes isn't a number we can use.");
    }
    const key = `${scryfallId}|${finish}|${condition}`;
    const earlier = merged.get(key);
    if (earlier) {
      earlier.quantity = Math.min(earlier.quantity + quantity, TRADE_LIMITS.maxQuantity);
      earlier.id = earlier.id ?? id;
      continue;
    }
    merged.set(key, {
      id,
      scryfallId,
      finish,
      condition,
      quantity,
      customerEstimateCents: estimate,
      note: cleanText(o.note, TRADE_LIMITS.maxCardNote),
    });
  }
  if (merged.size > maxLines) throw new HttpError(400, `A trade can list up to ${maxLines} of your cards.`);
  return [...merged.values()];
}

/** Where our cards ship: a US address, as checkout takes it. */
export function readShipTo(raw: unknown, fallbackName: string | null): TradeShipToInput {
  const o = (raw ?? {}) as Record<string, unknown>;
  const line1 = cleanText(o.line1, 200);
  const city = cleanText(o.city, 100);
  if (!line1 || !city) throw new HttpError(400, "Add the street address and city to ship your new cards to.");
  const check = checkUsAddress({ state: o.state, postalCode: o.postalCode, country: SHIP_TO_COUNTRY });
  if (!check.ok) throw new HttpError(400, check.message);
  return {
    name: cleanText(o.name, 120) ?? fallbackName ?? "",
    line1,
    line2: cleanText(o.line2, 200),
    city,
    state: check.state,
    postalCode: check.postalCode,
  };
}

/** A saved address from the customer's own address book. */
export async function savedShipTo(admin: Admin, userId: string, addressId: unknown, fallbackName: string | null): Promise<TradeShipToInput> {
  if (typeof addressId !== "string" || !UUID_RE.test(addressId)) throw new HttpError(400, "Choose an address.");
  const { data, error } = await admin
    .from("addresses")
    .select("recipient, line1, line2, city, state, postal_code, country")
    .eq("id", addressId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, "We couldn't load your saved address. Try again.");
  if (!data) throw new HttpError(404, "We couldn't find that saved address. Choose another or type one in.");
  return readShipTo(
    { name: data.recipient, line1: data.line1, line2: data.line2, city: data.city, state: data.state, postalCode: data.postal_code },
    fallbackName,
  );
}

// ---------------------------------------------------------------------------
// Pricing the customer's cards
// ---------------------------------------------------------------------------

/** Reference prices younger than this are used as they are; older ones are fetched again. */
const PRICE_FRESH_MS = 24 * 60 * 60 * 1000;

interface PrintingInfo {
  scryfallId: string;
  cardName: string;
  setCode: string;
  setName: string | null;
  collectorNumber: string;
  imageUrl: string | null;
  finishes: string[];
  prices: { usd: number | null; usdFoil: number | null; usdEtched: number | null };
  checkedAt: string | null;
}

function imageFromJson(images: Json | null): string | null {
  if (!images || typeof images !== "object" || Array.isArray(images)) return null;
  const o = images as Record<string, unknown>;
  const pick = [o.normal, o.large, o.small].find((v) => typeof v === "string" && v);
  return (pick as string | undefined) ?? null;
}

/** The printings, from the card_printings cache when fresh, otherwise from Scryfall (and cached). */
export async function loadPrintings(admin: Admin, ids: string[]): Promise<Map<string, PrintingInfo>> {
  const out = new Map<string, PrintingInfo>();
  if (ids.length === 0) return out;
  const { data: cached, error } = await admin
    .from("card_printings")
    .select(
      "scryfall_id, card_name, set_code, set_name, collector_number, available_finishes, images, price_usd_cents, price_usd_foil_cents, price_usd_etched_cents, prices_updated_at",
    )
    .in("scryfall_id", ids);
  if (error) console.error("[tradeCenter] card_printings read failed", error.message);
  for (const row of cached ?? []) {
    out.set(row.scryfall_id, {
      scryfallId: row.scryfall_id,
      cardName: row.card_name,
      setCode: row.set_code,
      setName: row.set_name,
      collectorNumber: row.collector_number,
      imageUrl: imageFromJson(row.images),
      finishes: row.available_finishes ?? [],
      prices: { usd: row.price_usd_cents, usdFoil: row.price_usd_foil_cents, usdEtched: row.price_usd_etched_cents },
      checkedAt: row.prices_updated_at,
    });
  }
  const now = Date.now();
  const stale = ids.filter((id) => {
    const p = out.get(id);
    return !p || !p.checkedAt || now - Date.parse(p.checkedAt) > PRICE_FRESH_MS;
  });
  if (stale.length === 0) return out;
  try {
    const fetched = await scryfallCollection(stale);
    const checkedAt = new Date().toISOString();
    for (const [id, card] of fetched) {
      const p = normalizeScryfallCard(card);
      out.set(id, {
        scryfallId: id,
        cardName: p.cardName,
        setCode: p.setCode,
        setName: p.setName,
        collectorNumber: p.collectorNumber,
        imageUrl: p.imageUrl || null,
        finishes: p.availableFinishes,
        prices: { usd: p.prices.usd, usdFoil: p.prices.usdFoil, usdEtched: p.prices.usdEtched },
        checkedAt,
      });
    }
    await Promise.allSettled([...fetched.values()].map((card) => cachePrinting(admin, card)));
  } catch (err) {
    // Scryfall is down or slow: keep whatever the cache had. A card with no
    // price at all is valued by hand (needs_review), never guessed.
    console.error("[tradeCenter] Scryfall lookup failed", err instanceof Error ? err.message : err);
  }
  return out;
}

/** The market reference for the exact finish: no stand-in from another finish. */
export function referencePriceFor(prices: PrintingInfo["prices"], finish: TradeFinish): number | null {
  const cents = finish === "foil" ? prices.usdFoil : finish === "etched" ? prices.usdEtched : prices.usd;
  return typeof cents === "number" && Number.isFinite(cents) && cents >= 0 ? Math.round(cents) : null;
}

/** One card as trade_save_offer stores it. */
export interface PricedOffer {
  id?: string;
  scryfall_id: string;
  card_name: string;
  set_code: string | null;
  set_name: string | null;
  collector_number: string | null;
  finish: TradeFinish;
  image_url: string | null;
  quantity: number;
  reported_condition: CardConditionCode;
  customer_estimate_cents: number | null;
  customer_note: string | null;
  reference_price_cents: number | null;
  reference_checked_at: string | null;
  condition_percent: number;
  estimated_unit_cents: number | null;
  eligibility: TradeEligibility;
  stock_on_hand: number;
}

/**
 * Prices the customer's cards for a trade: each printing's market reference
 * for its finish, the trade's condition percentage, and whether we can take
 * it (the trade's minimum, and today's exclusions and overstock limit).
 * The card's name, set and picture come from Scryfall, never the browser.
 */
export async function priceOffers(
  admin: Admin,
  inputs: TradeOfferInput[],
  trade: Pick<TradeRow, "condition_percents" | "min_card_value_cents">,
  settings: TradeSettingsRow,
): Promise<PricedOffer[]> {
  const ids = [...new Set(inputs.map((i) => i.scryfallId))];
  const printings = await loadPrintings(admin, ids);
  const stock = new Map<string, number>();
  if (ids.length > 0) {
    const { data, error } = await admin
      .from("inventory_items")
      .select("scryfall_id, quantity")
      .in("scryfall_id", ids)
      .eq("status", "active");
    if (error) throw new HttpError(500, "We couldn't check your cards. Try again.");
    for (const row of data ?? []) {
      if (row.scryfall_id) stock.set(row.scryfall_id, (stock.get(row.scryfall_id) ?? 0) + row.quantity);
    }
  }
  const percents = tradeConditionPercents(trade.condition_percents);
  const terms = {
    minCardValueCents: trade.min_card_value_cents,
    excludedSetCodes: settings.excluded_set_codes ?? [],
    excludedCardNames: settings.excluded_card_names ?? [],
    overstockThreshold: settings.overstock_threshold,
  };
  return inputs.map((input) => {
    const p = printings.get(input.scryfallId);
    if (!p) throw new HttpError(400, "We couldn't find one of your cards. Search for it again and re-add it.");
    if (p.finishes.length > 0 && !p.finishes.includes(input.finish)) {
      throw new HttpError(400, `${p.cardName} (${p.setCode}) doesn't come in ${input.finish === "nonfoil" ? "non-foil" : input.finish}.`);
    }
    const reference = referencePriceFor(p.prices, input.finish);
    const pct = conditionPercent(percents, input.condition);
    const estimate = estimatedUnitCents(reference, pct);
    const onHand = stock.get(input.scryfallId) ?? 0;
    return {
      ...(input.id ? { id: input.id } : {}),
      scryfall_id: input.scryfallId,
      card_name: p.cardName.slice(0, 200),
      set_code: p.setCode ? p.setCode.slice(0, 12) : null,
      set_name: p.setName ? p.setName.slice(0, 120) : null,
      collector_number: p.collectorNumber ? p.collectorNumber.slice(0, 16) : null,
      finish: input.finish,
      image_url: p.imageUrl,
      quantity: input.quantity,
      reported_condition: input.condition,
      customer_estimate_cents: input.customerEstimateCents ?? null,
      customer_note: input.note ?? null,
      reference_price_cents: reference,
      reference_checked_at: reference === null ? null : p.checkedAt,
      condition_percent: pct,
      estimated_unit_cents: estimate,
      eligibility: eligibilityFor({ estimatedUnitCents: estimate, setCode: p.setCode, cardName: p.cardName, stockOnHand: onHand }, terms),
      stock_on_hand: onHand,
    };
  });
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export function adminTradePath(tradeId: string): string {
  return `/admin_dashboard/trades?trade=${tradeId}`;
}
