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
  RESERVED_STATUSES,
  TRADE_LIMITS,
  conditionPercent,
  eligibilityFor,
  estimatedUnitCents,
  isConditionCode,
  isDepositStatus,
  isHandoffMethod,
  isTradeFinish,
  isTradeStatus,
  timelineLabel,
  type CardConditionCode,
  type ConditionPercents,
  type CustomerTrade,
  type CustomerTradeSummary,
  type DepositStatus,
  type StaffTrade,
  type StaffTradeOfferCard,
  type StaffTradeSummary,
  type TradeAddress,
  type TradeConfirmation,
  type TradeConsentView,
  type TradeCustomerFault,
  type TradeDisputeView,
  type TradeEligibility,
  type TradeExtensionView,
  type TradeFinish,
  type TradeHandoffMethod,
  type TradeMessage,
  type TradeOfferCard,
  type TradeOfferInput,
  type TradeOutgoing,
  type TradeReviewFlag,
  type TradeSettings,
  type TradeShipToInput,
  type TradeStatus,
  type TradeTerms,
  type TradeWantedInput,
  type TradeWantedItem,
} from "../../src/store/lib/tradeCenter.js";
import { addQualifyingDays, addQualifyingHours } from "../../src/store/lib/tradeDeadlines.js";
import { conditionForAge } from "../../src/store/lib/tradeConditions.js";
import {
  depositFor,
  privilegesFor,
  readCustomerRecord,
  type CustomerRecord,
  type DepositDecision,
  type DepositOverride,
  type DepositReason,
  type DepositSettings,
  type Privileges,
  type ReliabilitySettings,
} from "../../src/store/lib/tradeRules.js";
import { readScans } from "../../src/store/lib/tradeTracking.js";

// Server side of the Trade Center (api/trade-center.ts for customers,
// api/admin/trade-center.ts for staff): reading settings, turning database
// rows into what each side may see, checking what the browser sends, pricing
// the customer's cards, working out deadlines and deposits, and turning
// database errors into answers. Every change itself happens in the trade_*
// database functions (supabase/migrations/20261025200000_trade_center.sql),
// each in one transaction under the trade's row lock.

export type Admin = SupabaseClient<Database>;
export type TradeRow = Database["public"]["Tables"]["trade_requests"]["Row"];
export type TradeItemRow = Database["public"]["Tables"]["trade_request_items"]["Row"];
export type TradeOfferRow = Database["public"]["Tables"]["trade_offer_cards"]["Row"];
export type TradeEventRow = Database["public"]["Tables"]["trade_events"]["Row"];
export type TradeMessageRow = Database["public"]["Tables"]["trade_messages"]["Row"];
export type TradeSettingsRow = Database["public"]["Tables"]["trade_settings"]["Row"];
export type TradeDisputeRow = Database["public"]["Tables"]["trade_disputes"]["Row"];
export type TradeExtensionRow = Database["public"]["Tables"]["trade_extensions"]["Row"];
export type TradeConsentRow = Database["public"]["Tables"]["trade_consents"]["Row"];
/** The trade's order, as far as shipping our cards goes (and what the label cost). */
export type TradeOrderShipping = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  "id" | "status" | "tracking_carrier" | "tracking_number" | "shipped_at" | "delivered_at" | "postage_cost_cents"
>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DISPUTE_BUCKET = "trade-dispute-files";

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

export function depositSettingsOf(s: TradeSettingsRow): DepositSettings {
  return {
    depositsEnabled: s.deposits_enabled,
    depositThresholdCents: s.deposit_threshold_cents,
    depositBand1MaxCents: s.deposit_band1_max_cents,
    depositBand2MaxCents: s.deposit_band2_max_cents,
    depositBand3MaxCents: s.deposit_band3_max_cents,
    depositBand1Cents: s.deposit_band1_cents,
    depositBand2Cents: s.deposit_band2_cents,
    depositBand3Cents: s.deposit_band3_cents,
    depositBand4Cents: s.deposit_band4_cents,
  };
}

export function reliabilitySettingsOf(s: TradeSettingsRow): ReliabilitySettings {
  return {
    shipDaysNew: s.ship_days_new,
    shipDaysTier1: s.ship_days_tier1,
    shipDaysTier2: s.ship_days_tier2,
    loyaltyTier1Trades: s.loyalty_tier1_trades,
    loyaltyTier2Trades: s.loyalty_tier2_trades,
    abandonLimit: s.abandon_limit,
    abandonPolicy: s.abandon_policy === "block" ? "block" : "deposit",
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
    draftDays: s.draft_days,
    revisionHours: s.revision_hours,
    confirmationHours: s.confirmation_hours,
    shipDaysNew: s.ship_days_new,
    shipDaysTier1: s.ship_days_tier1,
    shipDaysTier2: s.ship_days_tier2,
    loyaltyTier1Trades: s.loyalty_tier1_trades,
    loyaltyTier2Trades: s.loyalty_tier2_trades,
    scanGraceHours: s.scan_grace_hours,
    excludedDates: s.excluded_dates ?? [],
    paymentDueDays: s.payment_due_days,
    disputeWindowDays: s.dispute_window_days,
    maxActiveTrades: s.max_active_trades,
    maxWantedLines: s.max_wanted_lines,
    maxOfferedLines: s.max_offered_lines,
    minTradeValueCents: s.min_trade_value_cents,
    maxTradeValueCents: s.max_trade_value_cents,
    processingFeeCents: s.processing_fee_cents,
    cashPayoutEnabled: s.cash_payout_enabled,
    shippingPaidBy: s.shipping_paid_by === "store" ? "store" : "customer",
    shipFeeCents: s.ship_fee_cents,
    freeShipThresholdCents: s.free_ship_threshold_cents,
    freeShipFeeCents: s.free_ship_fee_cents,
    packingInstructions: s.packing_instructions,
    returnPolicy: s.return_policy,
    excludedSetCodes: s.excluded_set_codes ?? [],
    excludedCardNames: s.excluded_card_names ?? [],
    overstockThreshold: s.overstock_threshold,
    hasShipToAddress: hasShipToAddress(s),
    ...depositSettingsOf(s),
    depositTerms: s.deposit_terms,
    depositTermsVersion: s.deposit_terms_version,
    localPickupEnabled: s.local_pickup_enabled,
    localPickupArea: s.local_pickup_area,
    localMeetDays: s.local_meet_days,
    localPickupDetails: s.local_pickup_details,
    localCreditRatePercent: s.local_credit_rate_percent,
    localMinCardValueCents: s.local_min_card_value_cents,
    localMinTradeValueCents: s.local_min_trade_value_cents,
    localCashPayoutEnabled: s.local_cash_payout_enabled,
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
    draftDays: s.draft_days,
    revisionHours: s.revision_hours,
    confirmationHours: s.confirmation_hours,
    shipDaysNew: s.ship_days_new,
    shipDaysTier1: s.ship_days_tier1,
    shipDaysTier2: s.ship_days_tier2,
    loyaltyTier1Trades: s.loyalty_tier1_trades,
    loyaltyTier2Trades: s.loyalty_tier2_trades,
    scanGraceHours: s.scan_grace_hours,
    excludedDates: s.excluded_dates ?? [],
    paymentDueDays: s.payment_due_days,
    maxTransitDays: s.max_transit_days,
    stallAlertDays: s.stall_alert_days,
    confirmReminderHours: s.confirm_reminder_hours,
    shipReminderHours: s.ship_reminder_hours,
    disputeWindowDays: s.dispute_window_days,
    ...depositSettingsOf(s),
    allowForfeiture: s.allow_forfeiture,
    depositTerms: s.deposit_terms,
    depositTermsVersion: s.deposit_terms_version,
    abandonLimit: s.abandon_limit,
    abandonWindowDays: s.abandon_window_days,
    abandonPolicy: s.abandon_policy === "block" ? "block" : "deposit",
    maxActiveTrades: s.max_active_trades,
    maxWantedLines: s.max_wanted_lines,
    maxOfferedLines: s.max_offered_lines,
    minTradeValueCents: s.min_trade_value_cents,
    maxTradeValueCents: s.max_trade_value_cents,
    processingFeeCents: s.processing_fee_cents,
    cashPayoutEnabled: s.cash_payout_enabled,
    cashRatePercent: s.cash_rate_percent,
    overstockThreshold: s.overstock_threshold,
    excludedSetCodes: s.excluded_set_codes ?? [],
    excludedCardNames: s.excluded_card_names ?? [],
    notifyCustomer: s.notify_customer,
    notifyStaff: s.notify_staff,
    shippingPaidBy: s.shipping_paid_by === "store" ? "store" : "customer",
    shipFeeCents: s.ship_fee_cents,
    freeShipThresholdCents: s.free_ship_threshold_cents,
    freeShipFeeCents: s.free_ship_fee_cents,
    shipCostEstimateCents: s.ship_cost_estimate_cents,
    shipTo: shipToAddress(s),
    packingInstructions: s.packing_instructions,
    returnPolicy: s.return_policy,
    localPickupEnabled: s.local_pickup_enabled,
    localPickupArea: s.local_pickup_area,
    localMeetDays: s.local_meet_days,
    localPickupDetails: s.local_pickup_details,
    localCreditRatePercent: s.local_credit_rate_percent,
    localMinCardValueCents: s.local_min_card_value_cents,
    localMinTradeValueCents: s.local_min_trade_value_cents,
    localCashPayoutEnabled: s.local_cash_payout_enabled,
    localCashRatePercent: s.local_cash_rate_percent,
    updatedAt: s.updated_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Deadlines, deposits and reliability (worked out here, stored by the database)
// ---------------------------------------------------------------------------

/** The confirmation deadline for an approval at `nowMs`: confirmation_hours of qualifying time. */
export function confirmDeadline(nowMs: number, s: TradeSettingsRow): string {
  return new Date(addQualifyingHours(nowMs, s.confirmation_hours, s.excluded_dates)).toISOString();
}

/** The shipping deadline for a reservation at `nowMs`: `shipDays` qualifying days. */
export function shipDeadline(nowMs: number, shipDays: number, s: TradeSettingsRow): string {
  return new Date(addQualifyingDays(nowMs, shipDays, s.excluded_dates)).toISOString();
}

/** When a local pickup trade confirmed at `nowMs` stops holding our cards: local_meet_days qualifying days. */
export function meetDeadline(nowMs: number, s: TradeSettingsRow): string {
  return shipDeadline(nowMs, s.local_meet_days, s);
}

/** A trade's handoff: by mail unless it says local pickup. */
export function handoffOf(t: Pick<TradeRow, "handoff_method">): TradeHandoffMethod {
  return isHandoffMethod(t.handoff_method) ? t.handoff_method : "ship";
}

/**
 * What a customer agrees to when they confirm a local pickup trade (kept
 * with the trade, trade_consents, like the deposit terms of a shipped one).
 */
export function localPickupTerms(s: TradeSettingsRow): string {
  const days = s.local_meet_days === 1 ? "1 day" : `${s.local_meet_days} days`;
  return [
    `Confirming takes our cards off sale and holds them for you for ${days} (Sundays don't count) while we arrange a time and place to meet in ${s.local_pickup_area}.`,
    `Bring the cards you're trading in. We'll look them over together, value each one at its TCG low for the condition we see, and settle the trade on the spot: any of our cards your trade credit doesn't cover is paid then, in cash or by card, and credit left over is kept as store credit${
      s.local_cash_payout_enabled ? " (or, if you'd rather, paid in cash at a lower rate)" : ""
    }.`,
    "If you can't make it, message us or cancel your trade so we can put our cards back on sale. There's no deposit and no charge for canceling.",
  ].join("\n\n");
}

/** A customer's record (trade_customer_stats); an empty one if it can't be read. */
export async function loadCustomerRecord(admin: Admin, userId: string, s: TradeSettingsRow): Promise<CustomerRecord> {
  const { data, error } = await admin.rpc("trade_customer_stats", { p_user_id: userId, p_window_days: s.abandon_window_days });
  if (error) {
    console.error("[tradeCenter] customer stats failed", userId, error.message);
    throw new HttpError(500, "We couldn't check this customer's trades. Try again.");
  }
  return readCustomerRecord(data);
}

export interface CustomerStanding {
  record: CustomerRecord;
  privileges: Privileges;
}

export async function customerStanding(admin: Admin, userId: string, s: TradeSettingsRow): Promise<CustomerStanding> {
  const record = await loadCustomerRecord(admin, userId, s);
  return { record, privileges: privilegesFor(record, reliabilitySettingsOf(s)) };
}

/** The deposit a trade needs now, from the settings, its override, and the customer. */
export function depositDecision(
  trade: Pick<TradeRow, "wanted_total_cents" | "deposit_override">,
  standing: CustomerStanding,
  s: TradeSettingsRow,
  override?: DepositOverride,
): DepositDecision {
  const o = override ?? (trade.deposit_override === "required" || trade.deposit_override === "waived" ? trade.deposit_override : "auto");
  return depositFor(
    {
      wantedCents: trade.wanted_total_cents,
      override: o,
      customerRequired: standing.record.depositRequired,
      reliabilityRequired: standing.privileges.reliabilityDeposit,
    },
    depositSettingsOf(s),
  );
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
    case "GT012":
      return new HttpError(409, message);
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
    case "23505":
      return new HttpError(409, "That was already done. Refresh to see the latest.");
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
  disputes: TradeDisputeRow[];
  /** The trade's order, once it's finished: our cards' shipment and its postage. */
  order?: TradeOrderShipping | null;
}

export async function loadTradeRow(admin: Admin, tradeId: string): Promise<TradeRow | null> {
  const { data, error } = await admin.from("trade_requests").select("*").eq("id", tradeId).maybeSingle();
  if (error) throw new HttpError(500, "We couldn't load that trade. Try again.");
  return data ?? null;
}

export async function loadTradeBundle(admin: Admin, tradeId: string): Promise<TradeBundle | null> {
  const trade = await loadTradeRow(admin, tradeId);
  if (!trade) return null;
  const [items, offers, events, messages, disputes] = await Promise.all([
    admin.from("trade_request_items").select("*").eq("trade_request_id", tradeId).order("created_at"),
    admin.from("trade_offer_cards").select("*").eq("trade_request_id", tradeId).order("position"),
    admin.from("trade_events").select("*").eq("trade_request_id", tradeId).order("created_at"),
    admin.from("trade_messages").select("*").eq("trade_request_id", tradeId).order("created_at"),
    admin.from("trade_disputes").select("*").eq("trade_request_id", tradeId).order("created_at"),
  ]);
  if (items.error || offers.error || events.error || messages.error || disputes.error) {
    throw new HttpError(500, "We couldn't load that trade. Try again.");
  }
  let order: TradeOrderShipping | null = null;
  if (trade.order_id) {
    const found = await admin
      .from("orders")
      .select("id, status, tracking_carrier, tracking_number, shipped_at, delivered_at, postage_cost_cents")
      .eq("id", trade.order_id)
      .maybeSingle();
    // The order's shipment is extra: the trade still shows without it.
    if (found.error) console.error("[tradeCenter] couldn't load the trade's order", trade.order_id, found.error.message);
    else order = (found.data as TradeOrderShipping | null) ?? null;
  }
  return {
    trade,
    items: items.data ?? [],
    offers: offers.data ?? [],
    events: events.data ?? [],
    messages: messages.data ?? [],
    disputes: disputes.data ?? [],
    order,
  };
}

/** A customer's own trade, or 404 (someone else's looks the same as none). */
export async function loadCustomerBundle(admin: Admin, tradeId: string, userId: string): Promise<TradeBundle> {
  const bundle = await loadTradeBundle(admin, tradeId);
  if (!bundle || bundle.trade.user_id !== userId) throw new HttpError(404, "That trade isn't there.");
  return bundle;
}

/**
 * How many of each inventory line are free now (on hand, on sale, less every
 * active hold except this trade's own), for a trade whose cards aren't
 * reserved yet.
 */
export async function loadAvailability(admin: Admin, tradeId: string, inventoryIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(inventoryIds)];
  if (ids.length === 0) return out;
  const [inv, holds] = await Promise.all([
    admin.from("inventory_items").select("id, quantity, status, price_cents, original_price_cents, is_deal").in("id", ids),
    admin.from("inventory_reservations").select("inventory_item_id, quantity, trade_request_id").in("inventory_item_id", ids).eq("status", "active"),
  ]);
  if (inv.error || holds.error) {
    console.error("[tradeCenter] availability failed", inv.error?.message ?? holds.error?.message);
    return out;
  }
  const held = new Map<string, number>();
  for (const h of holds.data ?? []) {
    if (h.trade_request_id === tradeId) continue;
    held.set(h.inventory_item_id, (held.get(h.inventory_item_id) ?? 0) + h.quantity);
  }
  for (const row of inv.data ?? []) {
    const price = row.is_deal && row.original_price_cents != null ? row.original_price_cents : row.price_cents;
    const onSale = row.status === "active" && (price ?? 0) > 0;
    out.set(row.id, onSale ? Math.max(row.quantity - (held.get(row.id) ?? 0), 0) : 0);
  }
  return out;
}

/** Availability for a bundle's lines that are only requested (not held). */
export async function bundleAvailability(admin: Admin, bundle: TradeBundle): Promise<Map<string, number>> {
  const requested = bundle.items.filter((i) => i.status === "requested" && i.inventory_item_id).map((i) => i.inventory_item_id as string);
  return loadAvailability(admin, bundle.trade.id, requested);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function statusOf(value: string): TradeStatus {
  return isTradeStatus(value) ? value : "awaiting_trade_list";
}

function depositStatusOf(value: string): DepositStatus {
  return isDepositStatus(value) ? value : "not_required";
}

function conditionOf(value: string | null): CardConditionCode | null {
  return isConditionCode(value) ? value : null;
}

const DEPOSIT_REASONS: readonly DepositReason[] = ["threshold", "trade", "customer", "reliability"];
function depositReasonOf(value: string | null): DepositReason | null {
  return DEPOSIT_REASONS.includes(value as DepositReason) ? (value as DepositReason) : null;
}

const REVIEW_FLAGS: readonly TradeReviewFlag[] = ["late_acceptance", "early_scan", "tracking_check", "dispute"];
function reviewFlagOf(value: string | null): TradeReviewFlag | null {
  return REVIEW_FLAGS.includes(value as TradeReviewFlag) ? (value as TradeReviewFlag) : null;
}

const FAULTS: readonly TradeCustomerFault[] = ["canceled_while_reserved", "missed_deadline", "late_shipment"];
function faultOf(value: string | null): TradeCustomerFault | null {
  return FAULTS.includes(value as TradeCustomerFault) ? (value as TradeCustomerFault) : null;
}

function acceptanceSourceOf(value: string | null): "carrier" | "staff" | "received" | null {
  return value === "carrier" || value === "staff" || value === "received" ? value : null;
}

function localPaymentOf(value: string | null): CustomerTrade["localPaymentMethod"] {
  return value === "none" || value === "cash" || value === "card" || value === "other" ? value : null;
}

function returnStatusOf(value: string): "none" | "pending" | "returned" {
  return value === "pending" || value === "returned" ? value : "none";
}

const ITEM_STATUSES: readonly TradeWantedItem["status"][] = ["requested", "reserved", "released", "removed", "fulfilled"];

function wantedView(row: TradeItemRow, availability: Map<string, number> | undefined): TradeWantedItem {
  const status = ITEM_STATUSES.includes(row.status as TradeWantedItem["status"]) ? (row.status as TradeWantedItem["status"]) : "requested";
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
    status,
    available:
      status === "requested" && row.inventory_item_id && availability?.has(row.inventory_item_id)
        ? (availability.get(row.inventory_item_id) as number)
        : null,
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

interface DisputeFile {
  path: string;
  name: string;
  size: number;
  type: string;
}

export function disputeFilesOf(value: Json): DisputeFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((f) => {
    if (!f || typeof f !== "object" || Array.isArray(f)) return [];
    const o = f as Record<string, unknown>;
    if (typeof o.path !== "string") return [];
    return [{
      path: o.path,
      name: typeof o.name === "string" ? o.name : "file",
      size: typeof o.size === "number" ? o.size : 0,
      type: typeof o.type === "string" ? o.type : "",
    }];
  });
}

function disputeView(row: TradeDisputeRow, urls?: Map<string, string>): TradeDisputeView {
  return {
    id: row.id,
    status: row.status === "accepted" || row.status === "rejected" ? row.status : "open",
    note: row.note,
    files: disputeFilesOf(row.files).map((f) => ({ name: f.name, size: f.size, type: f.type, url: urls?.get(f.path) ?? null })),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

/** Where the customer mails their cards: shown once our cards are reserved, until they've shipped (never for local pickup). */
const MAIL_TO_STATUSES: ReadonlySet<TradeStatus> = new Set(["awaiting_shipment", "tracking_submitted", "in_transit"]);

export interface ViewExtras {
  availability?: Map<string, number>;
  /** EasyPost is connected: scans are checked automatically. */
  autoTracked?: boolean;
  now?: number;
}

function outgoingOf(order: TradeOrderShipping | null | undefined): TradeOutgoing | null {
  if (!order) return null;
  return {
    status: order.status,
    carrier: order.tracking_carrier,
    tracking: order.tracking_number,
    shippedAt: order.shipped_at,
    deliveredAt: order.delivered_at,
  };
}

function baseView(bundle: TradeBundle, forStaff: boolean, settings: TradeSettingsRow | null, extras: ViewExtras) {
  const { trade: t, items, messages } = bundle;
  const status = statusOf(t.status);
  const handoffMethod = handoffOf(t);
  const showMailTo = settings !== null && handoffMethod === "ship" && MAIL_TO_STATUSES.has(status);
  const carrierTracked = (extras.autoTracked ?? false) && t.inbound_carrier !== null && t.inbound_carrier !== "Other";
  return {
    id: t.id,
    tradeNumber: t.trade_number,
    status,
    handoffMethod,
    meetupDetails: t.meetup_details,
    metAt: t.met_at,
    localPaymentMethod: localPaymentOf(t.local_payment_method),
    localPaidCents: t.local_paid_cents,
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
    shipFeeCents: t.ship_fee_cents,
    freeShipThresholdCents: t.free_ship_threshold_cents,
    freeShipFeeCents: t.free_ship_fee_cents,
    listDueAt: t.list_due_at,
    confirmBy: t.confirm_by,
    shipBy: t.ship_by,
    shipDays: t.ship_days,
    paymentDueAt: t.payment_due_at,
    confirmedAt: t.confirmed_at,
    reservedAt: t.reserved_at,
    approvalConditions: t.approval_conditions,
    shipment: {
      carrier: t.inbound_carrier,
      tracking: t.inbound_tracking,
      trackingAddedAt: t.inbound_tracking_added_at,
      carrierStatus: t.inbound_tracking_status,
      scans: readScans(t.inbound_tracking_events),
      checkedAt: t.inbound_tracking_checked_at,
      acceptedAt: t.inbound_accepted_at,
      acceptanceSource: acceptanceSourceOf(t.inbound_acceptance_source),
      shippedOnTime: t.shipped_on_time,
      deliveredAt: t.inbound_delivered_at,
      autoTracked: carrierTracked,
      shippedOn: t.inbound_shipped_on,
      packagingConfirmedAt: t.inbound_packaging_confirmed_at,
    },
    returnStatus: returnStatusOf(t.return_status),
    returnCarrier: t.return_carrier,
    returnTracking: t.return_tracking,
    expiredStage: t.expired_stage,
    orderId: t.order_id,
    creditIssuedCents: t.credit_issued_cents,
    customerNote: t.customer_note,
    closeReason: t.close_reason,
    shipTo: shipToOf(t),
    outgoing: outgoingOf(bundle.order),
    wanted: items.map((row) => wantedView(row, extras.availability)),
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

/** When a customer can send proof of shipping, and until when. */
export function proofWindow(t: TradeRow, settings: TradeSettingsRow, disputes: TradeDisputeRow[], now: number) {
  // Nothing is shipped on a local pickup trade, so there's nothing to prove.
  if (handoffOf(t) === "local") return { canSendProof: false, proofDueAt: null as string | null };
  const open = disputes.some((d) => d.status === "open");
  if (open) return { canSendProof: false, proofDueAt: null as string | null };
  if (t.status === "awaiting_shipment" || t.status === "tracking_submitted") return { canSendProof: true, proofDueAt: null };
  if (t.status === "expired" && t.closed_at) {
    const due = Date.parse(t.closed_at) + settings.dispute_window_days * 86_400_000;
    return { canSendProof: due > now, proofDueAt: new Date(due).toISOString() };
  }
  return { canSendProof: false, proofDueAt: null };
}

export function customerTradeView(
  bundle: TradeBundle,
  settings: TradeSettingsRow,
  extras: ViewExtras & { confirmation?: TradeConfirmation | null } = {},
): CustomerTrade {
  const { trade: t, offers, events, disputes } = bundle;
  const proof = proofWindow(t, settings, disputes, extras.now ?? Date.now());
  return {
    ...baseView(bundle, false, settings, extras),
    deposit: {
      cents: t.deposit_cents,
      status: depositStatusOf(t.deposit_status),
      reason: depositReasonOf(t.deposit_reason),
      paidCents: t.deposit_paid_cents,
      paidAt: t.deposit_paid_at,
      refundRequestedAt: t.deposit_refund_requested_at,
      refundedAt: t.deposit_refunded_at,
    },
    offered: offers.map((row) => customerOfferView(row, t.status)),
    timeline: events.flatMap((e) => {
      const label = timelineLabel(e.event, handoffOf(t));
      return label === undefined ? [] : [{ event: e.event, label, createdAt: e.created_at }];
    }),
    confirmation: extras.confirmation ?? null,
    disputes: disputes.map((d) => disputeView(d)),
    canSendProof: proof.canSendProof,
    proofDueAt: proof.proofDueAt,
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

export interface StaffExtras extends ViewExtras {
  standing?: CustomerStanding | null;
  extensions?: TradeExtensionRow[];
  consents?: TradeConsentRow[];
  /** Signed links to proof-of-shipping files, by storage path. */
  fileUrls?: Map<string, string>;
}

export function staffTradeView(bundle: TradeBundle, settings: TradeSettingsRow | null, extras: StaffExtras = {}): StaffTrade {
  const { trade: t, offers, events, messages, disputes } = bundle;
  const base = baseView({ ...bundle, messages }, true, settings, extras);
  const proof = settings ? proofWindow(t, settings, disputes, extras.now ?? Date.now()) : { canSendProof: false, proofDueAt: null };
  return {
    ...base,
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
    deposit: {
      cents: t.deposit_cents,
      status: depositStatusOf(t.deposit_status),
      reason: depositReasonOf(t.deposit_reason),
      paidCents: t.deposit_paid_cents,
      paidAt: t.deposit_paid_at,
      refundRequestedAt: t.deposit_refund_requested_at,
      refundedAt: t.deposit_refunded_at,
      override: t.deposit_override === "required" || t.deposit_override === "waived" ? t.deposit_override : "auto",
      paymentIntentId: t.deposit_payment_intent,
      refundId: t.deposit_refund_id,
      refundAttempts: t.deposit_refund_attempts,
      refundFailure: t.deposit_refund_failure,
      feeCents: t.deposit_fee_cents,
      decidedAt: t.deposit_decided_at,
      decidedBy: t.deposit_decided_by,
      decisionNote: t.deposit_decision_note,
    },
    confirmation: null,
    disputes: disputes.map((d) => ({
      ...disputeView(d, extras.fileUrls),
      staffNote: d.staff_note,
      resolvedBy: d.resolved_by_label,
    })),
    canSendProof: proof.canSendProof,
    proofDueAt: proof.proofDueAt,
    extensions: (extras.extensions ?? []).map(
      (e): TradeExtensionView => ({
        id: e.id,
        kind: (["list", "confirmation", "shipping", "payment"].includes(e.kind) ? e.kind : "shipping") as TradeExtensionView["kind"],
        fromDeadline: e.from_deadline,
        toDeadline: e.to_deadline,
        hours: e.hours,
        customerRequested: e.customer_requested,
        reason: e.reason,
        createdBy: e.created_by_label,
        createdAt: e.created_at,
      }),
    ),
    consents: (extras.consents ?? []).map(
      (c): TradeConsentView => ({
        termsVersion: c.terms_version,
        termsText: c.terms_text,
        depositCents: c.deposit_cents,
        shipDays: c.ship_days,
        confirmBy: c.confirm_by,
        ip: c.ip,
        userAgent: c.user_agent,
        createdAt: c.created_at,
      }),
    ),
    reviewFlag: reviewFlagOf(t.review_flag),
    reviewFlagAt: t.review_flag_at,
    customerFault: faultOf(t.customer_fault),
    faultAt: t.fault_at,
    faultClearedAt: t.fault_cleared_at,
    faultClearedBy: t.fault_cleared_by,
    confirmByOriginal: t.confirm_by_original,
    shipByOriginal: t.ship_by_original,
    needsStaff: t.needs_staff,
    customerRecord: extras.standing?.record ?? null,
    privileges: extras.standing?.privileges ?? null,
    submittedAt: t.submitted_at,
    approvedAt: t.approved_at,
    receivedAt: t.received_at,
    finalOfferAt: t.final_offer_at,
    acceptedAt: t.accepted_at,
    paidAt: t.paid_at,
    completedAt: t.completed_at,
    closedAt: t.closed_at,
    returnedAt: t.returned_at,
    cashPaidAt: t.cash_paid_at,
    paymentReference: t.payment_reference,
    orderPostageCents: bundle.order?.postage_cost_cents ?? null,
    outboundPostageCents: t.outbound_postage_cents,
  };
}

export function customerSummaryView(t: TradeRow, wantedCount: number, offeredCount: number): CustomerTradeSummary {
  return {
    id: t.id,
    tradeNumber: t.trade_number,
    status: statusOf(t.status),
    handoffMethod: handoffOf(t),
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    wantedTotalCents: t.wanted_total_cents,
    wantedCount,
    offeredCount,
    listDueAt: t.list_due_at,
    confirmBy: t.confirm_by,
    shipBy: t.ship_by,
    paymentDueAt: t.payment_due_at,
    depositStatus: depositStatusOf(t.deposit_status),
    depositCents: t.deposit_cents,
  };
}

export function staffSummaryView(t: TradeRow): StaffTradeSummary {
  return {
    id: t.id,
    tradeNumber: t.trade_number,
    status: statusOf(t.status),
    handoffMethod: handoffOf(t),
    customerName: t.customer_name,
    customerEmail: t.customer_email,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    submittedAt: t.submitted_at,
    wantedTotalCents: t.wanted_total_cents,
    estimatedValueCents: t.estimated_value_cents,
    approvedValueCents: t.approved_value_cents,
    finalValueCents: t.final_value_cents,
    listDueAt: t.list_due_at,
    confirmBy: t.confirm_by,
    shipBy: t.ship_by,
    paymentDueAt: t.payment_due_at,
    inboundCarrier: t.inbound_carrier,
    inboundTracking: t.inbound_tracking,
    inboundAcceptedAt: t.inbound_accepted_at,
    depositStatus: depositStatusOf(t.deposit_status),
    depositCents: t.deposit_cents,
    depositPaidCents: t.deposit_paid_cents,
    reviewFlag: reviewFlagOf(t.review_flag),
    returnStatus: returnStatusOf(t.return_status),
    customerFault: faultOf(t.customer_fault),
    needsStaff: t.needs_staff,
  };
}

/** Our cards are held for this trade. */
export function isReserved(status: string): boolean {
  return (RESERVED_STATUSES as readonly string[]).includes(status);
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

/**
 * The customer's cards. The same printing and finish twice becomes one line:
 * its condition comes from the printing's age (priceOffers), so any
 * condition the browser sends is ignored.
 */
export function readOfferInputs(raw: unknown, maxLines: number): TradeOfferInput[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "Your cards didn't come through. Try again.");
  const merged = new Map<string, TradeOfferInput>();
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const scryfallId = typeof o.scryfallId === "string" && UUID_RE.test(o.scryfallId) ? o.scryfallId.toLowerCase() : null;
    const finish = isTradeFinish(o.finish) ? o.finish : null;
    const quantity = wholeNumber(o.quantity, 1, TRADE_LIMITS.maxQuantity);
    const id = typeof o.id === "string" && UUID_RE.test(o.id) ? o.id.toLowerCase() : undefined;
    const estimate =
      o.customerEstimateCents === undefined || o.customerEstimateCents === null
        ? null
        : wholeNumber(o.customerEstimateCents, 0, TRADE_LIMITS.maxEstimateCents);
    if (!scryfallId || !finish || quantity === null) {
      throw new HttpError(400, "One of your cards is missing its printing, finish or quantity.");
    }
    if (o.customerEstimateCents !== undefined && o.customerEstimateCents !== null && estimate === null) {
      throw new HttpError(400, "One of your price notes isn't a number we can use.");
    }
    const key = `${scryfallId}|${finish}`;
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
  /** "YYYY-MM-DD": the customer's card is listed at the condition its age gives (tradeConditions). */
  releasedAt: string | null;
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
      "scryfall_id, card_name, set_code, set_name, collector_number, available_finishes, images, price_usd_cents, price_usd_foil_cents, price_usd_etched_cents, prices_updated_at, released_at",
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
      releasedAt: row.released_at ?? null,
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
        releasedAt: p.releasedAt ?? null,
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
 * for its finish, the trade's percentage for the condition the printing's
 * age gives (tradeConditions: the browser's condition is never used), and
 * whether we can take it (the trade's minimum, and today's exclusions and
 * overstock limit). These are estimates: staff price each card at TCG low
 * when they review the list. The card's name, set and picture come from
 * Scryfall, never the browser.
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
    const condition = conditionForAge(p.releasedAt);
    const pct = conditionPercent(percents, condition);
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
      reported_condition: condition,
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
