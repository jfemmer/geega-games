import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff, type StaffContext } from "../_lib/adminAuth.js";
import { logAdminAction } from "../_lib/auditLog.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import type { Database, Json } from "../../src/types/database.js";
import {
  consignmentDetail,
  createConsignment,
  deleteDraft,
  inviteConsignor,
  listConsignments,
  listVersions,
  publishVersion,
  resendSignedCopy,
  saveDraft,
  staffPdfLink,
  voidAgreement,
} from "../_lib/consignmentAdmin.js";
import { inspectLot, previewReceive, receiveCards } from "../_lib/consignmentReceiving.js";
import {
  cancelSale,
  listLot,
  markDelivered,
  proposeSettlement,
  recordExternalSale,
  recordPayout,
  setLotPrice,
  settleSale,
  unlistLot,
  unsettleSale,
  voidPayout,
} from "../_lib/consignmentSales.js";
import {
  addAdjustment,
  advanceReturn,
  approveReturn,
  cancelReturn,
  closeClaim,
  closeConsignment,
  markFundsReleased,
  openClaim,
  openHold,
  payoutDashboard,
  recordInsurance,
  releaseHold,
  staffRequestReturn,
  updateClaim,
  voidAdjustment,
} from "../_lib/consignmentAftercare.js";
import { buildStatementPdf, loadStatement } from "../_lib/consignmentStatement.js";
import { consignmentLabel } from "../../src/store/lib/consignmentAgreement.js";

type SettingsUpdate = Database["public"]["Tables"]["consignment_settings"]["Update"];

// Admin Consignments.
//
//   GET  ?view=settings            every fee, insurance and commission schedule
//                                  (newest first), the settings row, and what's
//                                  in effect now
//   GET  ?view=list                consignments with their consignor and latest
//                                  agreement
//   GET  ?view=detail&id=          one consignment: consignor, agreements,
//                                  signatures, elections in force
//   GET  ?view=versions            agreement versions, with what blocks a draft
//                                  from being published
//   GET  ?view=pdf&signature=      a five-minute link to a signed PDF
//   GET  ?view=settlement&sale=    the expenses proposed for settling a sale
//   GET  ?view=payouts             every unpaid sale across consignments (the payout dashboard)
//   GET  ?view=statement&payout=   a payout statement PDF
//   POST { action, ... }           see ACTIONS below
//
// Receiving (staff): previewReceive matches lines to exact printings without
// saving; receiveCards saves a batch (refused if any line has a problem);
// inspectLot { lotId, step: start|accept|reject|reopen, ... } grades a line.
//
// Selling (staff): listLot, unlistLot, setLotPrice, recordExternalSale,
// markSaleDelivered, settleSale, unsettleSale, cancelSale. Payouts move money,
// so recordPayout and voidPayout are for the owner.
//
// After the sale (staff): recordInsurance, markFundsReleased, openHold,
// releaseHold, openClaim, updateClaim, requestReturn, approveReturn,
// advanceReturn, cancelReturn. Owner: addAdjustment, voidAdjustment,
// closeClaim (it moves money), closeConsignment.
//
// Staff can create consignments and send, cancel and resend agreements. Only
// the owner (role admin) can change rates, settings and the agreement's
// text, since those go into new consignment agreements. Schedules are
// effective-dated and can't be backdated, edited or removed once in effect
// (the database enforces it: tg_consignment_schedule_lock), so a change never
// alters a signed agreement or a past payout. Every change is audited.

const CHANNELS = ["website", "tcgplayer", "ebay"] as const;
type Channel = (typeof CHANNELS)[number];
const FEE_BASES = ["item", "item_shipping", "item_shipping_tax"] as const;
const PAYOUT_METHODS = ["paypal", "venmo", "zelle", "check", "ach", "store_credit"] as const;
const SCHEDULE_TABLES = {
  fee: "consignment_fee_schedules",
  insurance: "consignment_insurance_schedules",
  commission: "consignment_commission_schedules",
} as const;
type ScheduleKind = keyof typeof SCHEDULE_TABLES;

type Admin = ReturnType<typeof getSupabaseAdmin>;

function requireOwner(staff: StaffContext) {
  if (staff.role !== "admin") throw new HttpError(403, "Only the owner can change consignment rates, terms and the agreement.");
}

/** A whole number in [min, max], or throws with the field's label. */
function whole(value: unknown, label: string, min: number, max: number): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

function wholeOrNull(value: unknown, label: string, min: number, max: number): number | null {
  return value === null || value === undefined || value === "" ? null : whole(value, label, min, max);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new HttpError(400, `Choose a valid ${label}.`);
  return value as T;
}

function note(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new HttpError(400, "The note must be text.");
  const t = value.trim();
  if (t.length > 1000) throw new HttpError(400, "Keep the note under 1,000 characters.");
  return t || null;
}

/** When a new schedule starts: now when omitted, never in the past. */
function effectiveFrom(value: unknown, now = Date.now()): string {
  if (value === null || value === undefined || value === "") return new Date(now).toISOString();
  if (typeof value !== "string") throw new HttpError(400, "Choose when the new rates start.");
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw new HttpError(400, "Choose when the new rates start.");
  // A minute of slack for the time the form took to send.
  if (at.getTime() < now - 60_000) throw new HttpError(400, "New rates can start now or later, not in the past.");
  return at.toISOString();
}

/** Commission tiers: ascending price caps, exactly one open-ended top tier. */
export function readTiers(value: unknown): { maxPriceCents: number | null; rateBps: number }[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw new HttpError(400, "Add 1 to 10 commission tiers.");
  const tiers = value.map((t, i) => {
    if (typeof t !== "object" || t === null) throw new HttpError(400, `Tier ${i + 1} isn't valid.`);
    const r = t as Record<string, unknown>;
    return {
      maxPriceCents: wholeOrNull(r.maxPriceCents, `Tier ${i + 1}'s top price (cents)`, 1, 100_000_000),
      rateBps: whole(r.rateBps, `Tier ${i + 1}'s rate (basis points)`, 0, 5000),
    };
  });
  const open = tiers.filter((t) => t.maxPriceCents == null);
  if (open.length !== 1) throw new HttpError(400, "Exactly one tier must have no top price (it covers everything above).");
  const caps = tiers.map((t) => t.maxPriceCents).filter((c): c is number => c != null);
  if (new Set(caps).size !== caps.length) throw new HttpError(400, "Two tiers can't end at the same price.");
  return [...tiers].sort((a, b) => (a.maxPriceCents ?? Infinity) - (b.maxPriceCents ?? Infinity));
}

export function readBrackets(value: unknown): { maxValueCents: number; premiumCents: number }[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) throw new HttpError(400, "Add 1 to 40 insurance brackets.");
  const brackets = value.map((b, i) => {
    if (typeof b !== "object" || b === null) throw new HttpError(400, `Bracket ${i + 1} isn't valid.`);
    const r = b as Record<string, unknown>;
    return {
      maxValueCents: whole(r.maxValueCents, `Bracket ${i + 1}'s top value (cents)`, 1, 100_000_000),
      premiumCents: whole(r.premiumCents, `Bracket ${i + 1}'s premium (cents)`, 0, 1_000_000),
    };
  });
  const tops = brackets.map((b) => b.maxValueCents);
  if (new Set(tops).size !== tops.length) throw new HttpError(400, "Two brackets can't end at the same value.");
  return brackets.sort((a, b) => a.maxValueCents - b.maxValueCents);
}

function readBuyerTerms(value: unknown): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "Buyer shipping and tax aren't valid.");
  const out: Record<string, Json> = {};
  for (const channel of CHANNELS) {
    const t = (value as Record<string, unknown>)[channel];
    if (t === undefined) continue;
    if (typeof t !== "object" || t === null) throw new HttpError(400, `${channel}'s buyer terms aren't valid.`);
    const r = t as Record<string, unknown>;
    out[channel] = {
      shippingCents: whole(r.shippingCents, `${channel} buyer shipping (cents)`, 0, 10_000),
      freeShippingAtCents: wholeOrNull(r.freeShippingAtCents, `${channel} free-shipping threshold (cents)`, 1, 10_000_000),
      salesTaxBps: whole(r.salesTaxBps, `${channel} sales tax (basis points)`, 0, 1500),
    };
  }
  return out;
}

/** Turn the database's own refusals into messages staff can act on. */
function dbError(error: { code?: string; message?: string }, fallback: string): HttpError {
  if (error.code === "GC010") return new HttpError(409, "Those rates are already in effect, so they can't be changed or removed. Add new rates that start later.");
  if (error.code === "GC011") return new HttpError(400, "New rates can start now or later, not in the past.");
  if (error.code === "23505") return new HttpError(409, "Rates already start at that exact time. Pick a different start time.");
  if (error.code === "23514") return new HttpError(400, "Those numbers aren't valid. Check each field and try again.");
  return new HttpError(500, fallback);
}

async function loadSettings(admin: Admin) {
  const [fees, insurance, commission, settings, current] = await Promise.all([
    admin.from("consignment_fee_schedules").select("*").order("effective_from", { ascending: false }).limit(200),
    admin.from("consignment_insurance_schedules").select("*").order("effective_from", { ascending: false }).limit(100),
    admin.from("consignment_commission_schedules").select("*").order("effective_from", { ascending: false }).limit(100),
    admin.from("consignment_settings").select("*").maybeSingle(),
    admin.rpc("consignment_estimator_settings"),
  ]);
  const failed = [fees, insurance, commission, settings, current].find((r) => r.error);
  if (failed?.error) throw new HttpError(500, "Could not load consignment settings.");
  return {
    feeSchedules: fees.data ?? [],
    insuranceSchedules: insurance.data ?? [],
    commissionSchedules: commission.data ?? [],
    settings: settings.data,
    current: current.data,
  };
}

async function addFeeSchedule(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const channel: Channel = oneOf(body.channel, CHANNELS, "sales channel");
  const threshold = wholeOrNull(body.marketplaceThresholdCents, "The threshold (cents)", 1, 100_000_000);
  const above = wholeOrNull(body.marketplaceAboveThresholdBps, "The rate above the threshold (basis points)", 0, 5000);
  if ((threshold == null) !== (above == null)) throw new HttpError(400, "Give both a threshold and the rate above it, or neither.");
  const small = wholeOrNull(body.perOrderSmallCents, "The small-order fee (cents)", 0, 10_000);
  const smallMax = wholeOrNull(body.perOrderSmallMaxCents, "The small-order limit (cents)", 1, 10_000_000);
  if ((small == null) !== (smallMax == null)) throw new HttpError(400, "Give both a small-order fee and the order total it applies to, or neither.");
  const row = {
    channel,
    effective_from: effectiveFrom(body.effectiveFrom),
    marketplace_bps: whole(body.marketplaceBps, "The marketplace fee (basis points)", 0, 5000),
    marketplace_threshold_cents: threshold,
    marketplace_above_threshold_bps: above,
    marketplace_base: oneOf(body.marketplaceBase, FEE_BASES, "fee base"),
    per_order_cents: whole(body.perOrderCents ?? 0, "The per-order fee (cents)", 0, 10_000),
    per_order_small_cents: small,
    per_order_small_max_cents: smallMax,
    processing_bps: whole(body.processingBps ?? 0, "Processing (basis points)", 0, 2000),
    processing_fixed_cents: whole(body.processingFixedCents ?? 0, "The fixed processing fee (cents)", 0, 1000),
    processing_base: oneOf(body.processingBase ?? "item_shipping_tax", FEE_BASES, "processing base"),
    source_note: note(body.sourceNote),
    created_by: staff.email,
  };
  const { data, error } = await admin.from("consignment_fee_schedules").insert(row).select("*").single();
  if (error || !data) throw dbError(error ?? {}, "Could not save the new fees.");
  await logAdminAction(admin, staff, {
    action: "consignment.fee_schedule.add",
    resourceType: "consignment_fee_schedule",
    resourceId: data.id,
    after: data as unknown as Record<string, unknown>,
  });
  return data;
}

async function addInsuranceSchedule(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const sourceUrl = typeof body.sourceUrl === "string" && body.sourceUrl.trim() ? body.sourceUrl.trim() : null;
  if (sourceUrl && (!/^https:\/\//.test(sourceUrl) || sourceUrl.length > 500)) throw new HttpError(400, "The source link must be an https:// address.");
  const row = {
    effective_from: effectiveFrom(body.effectiveFrom),
    service: typeof body.service === "string" && body.service.trim() ? body.service.trim().slice(0, 100) : "USPS Ground Advantage",
    included_coverage_cents: whole(body.includedCoverageCents, "Included coverage (cents)", 0, 10_000_000),
    brackets: readBrackets(body.brackets) as unknown as Json,
    step_cents: whole(body.stepCents, "The step above the last bracket (cents)", 1, 10_000_000),
    step_premium_cents: whole(body.stepPremiumCents, "The premium per step (cents)", 0, 1_000_000),
    max_insurable_cents: whole(body.maxInsurableCents, "The most the carrier insures (cents)", 1, 100_000_000),
    source_url: sourceUrl,
    source_note: note(body.sourceNote),
    created_by: staff.email,
  };
  const { data, error } = await admin.from("consignment_insurance_schedules").insert(row).select("*").single();
  if (error || !data) throw dbError(error ?? {}, "Could not save the new insurance rates.");
  await logAdminAction(admin, staff, {
    action: "consignment.insurance_schedule.add",
    resourceType: "consignment_insurance_schedule",
    resourceId: data.id,
    after: data as unknown as Record<string, unknown>,
  });
  return data;
}

async function addCommissionSchedule(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const row = {
    effective_from: effectiveFrom(body.effectiveFrom),
    tiers: readTiers(body.tiers) as unknown as Json,
    source_note: note(body.sourceNote),
    created_by: staff.email,
  };
  const { data, error } = await admin.from("consignment_commission_schedules").insert(row).select("*").single();
  if (error || !data) throw dbError(error ?? {}, "Could not save the new commission tiers.");
  await logAdminAction(admin, staff, {
    action: "consignment.commission_schedule.add",
    resourceType: "consignment_commission_schedule",
    resourceId: data.id,
    after: data as unknown as Record<string, unknown>,
  });
  return data;
}

async function deleteSchedule(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const kind = oneOf(body.kind, Object.keys(SCHEDULE_TABLES) as ScheduleKind[], "schedule");
  const id = typeof body.id === "string" ? body.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Choose a schedule to remove.");
  const table = SCHEDULE_TABLES[kind];
  const { data: before, error: readError } = await admin.from(table).select("*").eq("id", id).maybeSingle();
  if (readError) throw new HttpError(500, "Could not load that schedule.");
  if (!before) throw new HttpError(404, "That schedule isn't there.");
  const { error } = await admin.from(table).delete().eq("id", id);
  if (error) throw dbError(error, "Could not remove that schedule.");
  await logAdminAction(admin, staff, {
    action: `consignment.${kind}_schedule.delete`,
    resourceType: `consignment_${kind}_schedule`,
    resourceId: id,
    before: before as unknown as Record<string, unknown>,
  });
}

async function updateSettings(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const { data: before, error: readError } = await admin.from("consignment_settings").select("*").maybeSingle();
  if (readError || !before) throw new HttpError(500, "Could not load consignment settings.");
  const patch: SettingsUpdate = {};
  if (body.defaultPostageCents !== undefined) patch.default_postage_cents = whole(body.defaultPostageCents, "Typical postage (cents)", 0, 10_000);
  if (body.buyerTerms !== undefined) patch.buyer_terms = readBuyerTerms(body.buyerTerms);
  if (body.estimatorInsuranceDefault !== undefined) {
    if (typeof body.estimatorInsuranceDefault !== "boolean") throw new HttpError(400, "Choose whether the estimator starts with insurance on.");
    patch.estimator_insurance_default = body.estimatorInsuranceDefault;
  }
  if (body.minCardValueCents !== undefined) patch.min_card_value_cents = whole(body.minCardValueCents, "The minimum card value (cents)", 0, 10_000_000);
  if (body.initialTermDays !== undefined) patch.initial_term_days = whole(body.initialTermDays, "The initial term (days)", 1, 3650);
  if (body.inspectionDays !== undefined) patch.inspection_days = whole(body.inspectionDays, "The inspection period (days)", 0, 60);
  if (body.payoutMethods !== undefined) {
    if (!Array.isArray(body.payoutMethods) || body.payoutMethods.length === 0) throw new HttpError(400, "Choose at least one payout method.");
    patch.payout_methods = [...new Set(body.payoutMethods.map((m) => oneOf(m, PAYOUT_METHODS, "payout method")))];
  }
  if (Object.keys(patch).length === 0) throw new HttpError(400, "Nothing to change.");
  patch.updated_by = staff.email;
  const { data, error } = await admin.from("consignment_settings").update(patch).eq("id", true).select("*").single();
  if (error || !data) throw dbError(error ?? {}, "Could not save consignment settings.");
  await logAdminAction(admin, staff, {
    action: "consignment.settings.update",
    resourceType: "consignment_settings",
    resourceId: "settings",
    before: before as unknown as Record<string, unknown>,
    after: data as unknown as Record<string, unknown>,
  });
  return data;
}

const OWNER_ACTIONS = new Set([
  "addFeeSchedule",
  "addInsuranceSchedule",
  "addCommissionSchedule",
  "deleteSchedule",
  "updateSettings",
  "saveDraft",
  "deleteDraft",
  "publishVersion",
  "recordPayout",
  "voidPayout",
  "addAdjustment",
  "voidAdjustment",
  "closeClaim",
  "closeConsignment",
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!["GET", "POST"].includes(req.method ?? "")) return methodNotAllowed(res, ["GET", "POST"]);
  try {
    const staff = await requireStaff(req);
    const admin = getSupabaseAdmin();

    if (req.method === "GET") {
      const view = String(req.query.view ?? "settings");
      switch (view) {
        case "settings":
          return sendJson(res, 200, await loadSettings(admin));
        case "list":
          return sendJson(res, 200, { consignments: await listConsignments(admin) });
        case "detail":
          return sendJson(res, 200, await consignmentDetail(admin, String(req.query.id ?? "")));
        case "versions":
          return sendJson(res, 200, { versions: await listVersions(admin) });
        case "pdf":
          return sendJson(res, 200, await staffPdfLink(admin, String(req.query.signature ?? "")));
        case "settlement":
          return sendJson(res, 200, await proposeSettlement(admin, String(req.query.sale ?? "")));
        case "payouts":
          return sendJson(res, 200, await payoutDashboard(admin));
        case "statement": {
          const data = await loadStatement(admin, String(req.query.payout ?? ""));
          const pdf = await buildStatementPdf(data);
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `attachment; filename="${consignmentLabel(data.consignmentNumber)}-statement-${data.payout.paid_at.slice(0, 10)}.pdf"`);
          res.setHeader("Cache-Control", "no-store");
          res.status(200).end(Buffer.from(pdf));
          return;
        }
        default:
          throw new HttpError(400, "Unknown view.");
      }
    }

    const body = await readJsonBody(req, 1024 * 1024);
    const action = String(body.action ?? "");
    if (OWNER_ACTIONS.has(action)) requireOwner(staff);
    switch (action) {
      case "addFeeSchedule":
        await addFeeSchedule(admin, staff, body);
        return sendJson(res, 200, await loadSettings(admin));
      case "addInsuranceSchedule":
        await addInsuranceSchedule(admin, staff, body);
        return sendJson(res, 200, await loadSettings(admin));
      case "addCommissionSchedule":
        await addCommissionSchedule(admin, staff, body);
        return sendJson(res, 200, await loadSettings(admin));
      case "deleteSchedule":
        await deleteSchedule(admin, staff, body);
        return sendJson(res, 200, await loadSettings(admin));
      case "updateSettings":
        await updateSettings(admin, staff, body);
        return sendJson(res, 200, await loadSettings(admin));
      case "createConsignment":
        return sendJson(res, 200, { consignment: await createConsignment(admin, staff, body) });
      case "sendInvitation":
        return sendJson(res, 200, { invitation: await inviteConsignor(admin, staff, body) });
      case "voidAgreement":
        await voidAgreement(admin, staff, body);
        return sendJson(res, 200, { ok: true });
      case "previewReceive":
        return sendJson(res, 200, await previewReceive(admin, body));
      case "receiveCards":
        return sendJson(res, 200, await receiveCards(admin, staff, body));
      case "inspectLot":
        return sendJson(res, 200, await inspectLot(admin, staff, body));
      case "listLot":
        return sendJson(res, 200, await listLot(admin, staff, body));
      case "unlistLot":
        return sendJson(res, 200, await unlistLot(admin, staff, body));
      case "setLotPrice":
        await setLotPrice(admin, staff, body);
        return sendJson(res, 200, { ok: true });
      case "recordExternalSale":
        return sendJson(res, 200, await recordExternalSale(admin, staff, body));
      case "markSaleDelivered":
        return sendJson(res, 200, await markDelivered(admin, staff, body));
      case "settleSale":
        return sendJson(res, 200, await settleSale(admin, staff, body));
      case "unsettleSale":
        await unsettleSale(admin, staff, body);
        return sendJson(res, 200, { ok: true });
      case "cancelSale":
        await cancelSale(admin, staff, body);
        return sendJson(res, 200, { ok: true });
      case "recordPayout":
        return sendJson(res, 200, await recordPayout(admin, staff, body));
      case "voidPayout":
        await voidPayout(admin, staff, body);
        return sendJson(res, 200, { ok: true });
      case "recordInsurance":
        await recordInsurance(admin, staff, body);
        return sendJson(res, 200, { ok: true });
      case "markFundsReleased":
        await markFundsReleased(admin, staff, body);
        return sendJson(res, 200, { ok: true });
      case "openHold":
        return sendJson(res, 200, await openHold(admin, staff, body));
      case "releaseHold":
        await releaseHold(admin, staff, body);
        return sendJson(res, 200, { ok: true });
      case "addAdjustment":
        return sendJson(res, 200, await addAdjustment(admin, staff, body));
      case "voidAdjustment":
        await voidAdjustment(admin, staff, body);
        return sendJson(res, 200, { ok: true });
      case "openClaim":
        return sendJson(res, 200, await openClaim(admin, staff, body));
      case "updateClaim":
        await updateClaim(admin, staff, body);
        return sendJson(res, 200, { ok: true });
      case "closeClaim":
        await closeClaim(admin, staff, body);
        return sendJson(res, 200, { ok: true });
      case "requestReturn":
        return sendJson(res, 200, await staffRequestReturn(admin, staff, body));
      case "approveReturn":
        await approveReturn(admin, staff, body);
        return sendJson(res, 200, { ok: true });
      case "advanceReturn":
        return sendJson(res, 200, await advanceReturn(admin, staff, body));
      case "cancelReturn":
        await cancelReturn(admin, staff, body);
        return sendJson(res, 200, { ok: true });
      case "closeConsignment":
        await closeConsignment(admin, staff, body);
        return sendJson(res, 200, { ok: true });
      case "resendSignedCopy":
        return sendJson(res, 200, { copy: await resendSignedCopy(admin, staff, body) });
      case "saveDraft":
        await saveDraft(admin, staff, body);
        return sendJson(res, 200, { versions: await listVersions(admin) });
      case "deleteDraft":
        await deleteDraft(admin, staff, body);
        return sendJson(res, 200, { versions: await listVersions(admin) });
      case "publishVersion":
        await publishVersion(admin, staff, body);
        return sendJson(res, 200, { versions: await listVersions(admin) });
      default:
        throw new HttpError(400, "Unknown action.");
    }
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { message: err.message });
    console.error("[admin/consignments] unexpected", err);
    return sendJson(res, 500, { message: "Something went wrong." });
  }
}
