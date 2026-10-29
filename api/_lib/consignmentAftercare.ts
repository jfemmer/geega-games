import type { StaffContext } from "./adminAuth.js";
import { logAdminAction } from "./auditLog.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { HttpError } from "./http.js";
import { salesDbError } from "./consignmentSales.js";
import { consignmentLabel } from "../../src/store/lib/consignmentAgreement.js";

// After the sale: shipment insurance, holds, adjustments, shipping claims,
// returns of unsold cards and closing a consignment (agreement sections 5, 6
// and 7). The database keeps the books
// (supabase/migrations/20261029160000_consignment_claims_returns.sql); this
// module checks input, audits every change, and assembles what the admin
// pages show.

type Admin = ReturnType<typeof getSupabaseAdmin>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOLD_SOURCES = ["buyer_report", "dispute", "chargeback", "other"] as const;
const ADJUSTMENT_KINDS = ["reversal", "chargeback", "refund_costs", "return_shipping", "correction", "goodwill"] as const;
const CLAIM_STATUSES = ["open", "filed", "approved", "denied", "paid"] as const;
const REFUND_STATUSES = ["none", "pending", "refunded"] as const;
const RETURN_STEPS = ["quote", "paid", "ship", "delivered"] as const;

const actor = (staff: StaffContext) => staff.email ?? "staff";

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(400, `Choose ${label}.`);
  return value;
}
function optionalId(value: unknown, label: string): string | null {
  return value === null || value === undefined || value === "" ? null : id(value, label);
}
function cents(value: unknown, label: string, { required = false, min = 0, max = 100_000_000 } = {}): number | null {
  if (value === null || value === undefined || value === "") {
    if (required) throw new HttpError(400, `Enter ${label}.`);
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new HttpError(400, `Enter ${label} as a whole number of cents.`);
  return value;
}
function text(value: unknown, max: number, label = "That"): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text.`);
  const t = value.trim();
  if (t.length > max) throw new HttpError(400, `${label} must be under ${max} characters.`);
  return t || null;
}
function when(value: unknown, label: string, required = false): string | null {
  if (value === null || value === undefined || value === "") {
    if (required) throw new HttpError(400, `Enter ${label}.`);
    return null;
  }
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `Enter ${label}.`);
  return d.toISOString();
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const v = allowed.find((a) => a === value);
  if (!v) throw new HttpError(400, `Choose ${label}.`);
  return v;
}

async function rpc<T>(admin: Admin, fn: string, args: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await (admin.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: T; error: { code?: string; message?: string } | null }>)(fn, args);
  if (error) throw aftercareDbError(error, fallback);
  return data;
}

/** GC08x/GC09x refusals (and the earlier GC0xx ones) carry messages written for staff. */
export function aftercareDbError(error: { code?: string; message?: string } | null, fallback: string): HttpError {
  const code = error?.code ?? "";
  if (/^GC0[89][0-9]$/.test(code) && error?.message) {
    return new HttpError(["GC080", "GC087"].includes(code) ? 404 : ["GC081", "GC082", "GC083", "GC084", "GC086", "GC088", "GC090"].includes(code) ? 409 : 400, error.message);
  }
  return salesDbError(error, fallback);
}

async function audit(admin: Admin, staff: StaffContext, action: string, resourceType: string, resourceId: string, after?: Record<string, unknown>) {
  await logAdminAction(admin, staff, { action, resourceType, resourceId, after });
}

// ---------------------------------------------------------------- insurance and marketplace funds

export async function recordInsurance(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const orderId = id(body.orderId, "an order");
  const args = {
    p_order_id: orderId,
    p_insured_value_cents: cents(body.insuredValueCents, "the value insured", { required: true }),
    p_premium_cents: cents(body.premiumCents, "the premium paid", { required: true, max: 1_000_000 }),
    p_source: text(body.source, 100, "Where it was bought") ?? "",
    p_notes: text(body.notes, 1000, "The note") ?? "",
    p_actor: actor(staff),
  };
  await rpc(admin, "consignment_record_insurance", args, "Could not record the insurance.");
  await audit(admin, staff, "consignment.shipment.insurance", "order", orderId, { insuredValueCents: args.p_insured_value_cents, premiumCents: args.p_premium_cents, source: args.p_source });
}

export async function markFundsReleased(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const saleId = id(body.saleId, "a sale");
  const at = when(body.releasedAt, "when the funds were released", true)!;
  await rpc(admin, "consignment_mark_funds_released", { p_sale_id: saleId, p_released_at: at, p_actor: actor(staff) }, "Could not record the release.");
  await audit(admin, staff, "consignment.sale.funds_released", "consignment_sale", saleId, { releasedAt: at });
}

// ---------------------------------------------------------------- holds (6.4)

export async function openHold(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const saleId = id(body.saleId, "a sale");
  const source = oneOf(body.source, HOLD_SOURCES, "what kind of problem it is");
  const reason = text(body.reason, 500, "The reason");
  if (!reason || reason.length < 3) throw new HttpError(400, "Say what the problem is. The consignor is told the reason.");
  const holdId = await rpc<string>(admin, "consignment_open_hold", { p_sale_id: saleId, p_source: source, p_reason: reason, p_actor: actor(staff) }, "Could not hold the sale.");
  await audit(admin, staff, "consignment.hold.open", "consignment_sale", saleId, { holdId, source, reason });
  return { holdId };
}

export async function releaseHold(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const holdId = id(body.holdId, "a hold");
  const resolution = text(body.resolution, 500, "The resolution");
  if (!resolution) throw new HttpError(400, "Say how it was resolved.");
  await rpc(admin, "consignment_release_hold", { p_hold_id: holdId, p_resolution: resolution, p_actor: actor(staff) }, "Could not release the hold.");
  await audit(admin, staff, "consignment.hold.release", "consignment_hold", holdId, { resolution });
}

// ---------------------------------------------------------------- adjustments (owner)

export async function addAdjustment(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const consignmentId = id(body.consignmentId, "a consignment");
  const kind = oneOf(body.kind, ADJUSTMENT_KINDS, "the kind of adjustment");
  const amount = cents(body.amountCents, "the amount", { required: true, min: -100_000_000 })!;
  if (amount === 0) throw new HttpError(400, "Enter an amount other than $0.");
  const reason = text(body.reason, 500, "The reason");
  if (!reason || reason.length < 3) throw new HttpError(400, "Document the reason. The consignor sees it on their statement.");
  const args = { p_consignment_id: consignmentId, p_sale_id: optionalId(body.saleId, "a sale"), p_kind: kind, p_amount_cents: amount, p_reason: reason, p_actor: actor(staff) };
  const adjustmentId = await rpc<string>(admin, "consignment_add_adjustment", args, "Could not add the adjustment.");
  await audit(admin, staff, "consignment.adjustment.add", "consignment_adjustment", adjustmentId, { consignmentId, kind, amountCents: amount, reason, saleId: args.p_sale_id });
  return { adjustmentId };
}

export async function voidAdjustment(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const adjustmentId = id(body.adjustmentId, "an adjustment");
  const reason = text(body.reason, 500, "The reason");
  if (!reason) throw new HttpError(400, "Say why it is void.");
  await rpc(admin, "consignment_void_adjustment", { p_adjustment_id: adjustmentId, p_reason: reason, p_actor: actor(staff) }, "Could not void the adjustment.");
  await audit(admin, staff, "consignment.adjustment.void", "consignment_adjustment", adjustmentId, { reason });
}

// ---------------------------------------------------------------- shipping claims (5.4, 5.5)

export async function openClaim(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const orderId = id(body.orderId, "an order");
  const kind = oneOf(body.kind, ["lost", "damaged"] as const, "lost or damaged");
  const claimId = await rpc<string>(admin, "consignment_open_claim", { p_order_id: orderId, p_kind: kind, p_notes: text(body.notes, 2000, "The note") ?? "", p_actor: actor(staff) }, "Could not open the claim.");
  await audit(admin, staff, "consignment.claim.open", "consignment_claim", claimId, { orderId, kind });
  return { claimId };
}

export async function updateClaim(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const claimId = id(body.claimId, "a claim");
  const args = {
    p_claim_id: claimId,
    p_status: body.status === undefined || body.status === null ? null : oneOf(body.status, CLAIM_STATUSES, "a claim status"),
    p_claim_number: text(body.claimNumber, 100, "The claim number") ?? "",
    p_filed_at: when(body.filedAt, "when it was filed"),
    p_customer_refund_status: body.customerRefundStatus === undefined || body.customerRefundStatus === null ? null : oneOf(body.customerRefundStatus, REFUND_STATUSES, "the buyer's refund status"),
    p_reimbursement_cents: cents(body.reimbursementCents, "what the carrier paid"),
    p_reimbursed_at: when(body.reimbursedAt, "when the carrier paid"),
    p_notes: text(body.notes, 2000, "The note") ?? "",
    p_actor: actor(staff),
  };
  await rpc(admin, "consignment_update_claim", args, "Could not update the claim.");
  await audit(admin, staff, "consignment.claim.update", "consignment_claim", claimId, { ...args, p_actor: undefined });
}

export async function closeClaim(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const claimId = id(body.claimId, "a claim");
  const outcome = oneOf(body.outcome, ["carrier_loss", "our_responsibility"] as const, "the outcome");
  const note = text(body.note, 1000, "The note");
  if (!note) throw new HttpError(400, "Note how the claim ended.");
  let allocations: { saleId: string; claimPaymentCents: number; returnedDamaged: boolean }[] | null = null;
  if (outcome === "carrier_loss") {
    if (!Array.isArray(body.allocations) || body.allocations.length === 0) throw new HttpError(400, "Say what happened to each card.");
    allocations = body.allocations.map((a, i) => {
      const r = (a ?? {}) as Record<string, unknown>;
      return {
        saleId: id(r.saleId, `card ${i + 1}`),
        claimPaymentCents: cents(r.claimPaymentCents, `card ${i + 1}'s claim payment`) ?? 0,
        returnedDamaged: r.returnedDamaged === true,
      };
    });
  }
  await rpc(admin, "consignment_close_claim", { p_claim_id: claimId, p_outcome: outcome, p_allocations: allocations, p_note: note, p_actor: actor(staff) }, "Could not close the claim.");
  await audit(admin, staff, "consignment.claim.close", "consignment_claim", claimId, { outcome, allocations, note });
}

// ---------------------------------------------------------------- returns (7.4) and closing

function returnLines(value: unknown) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000) throw new HttpError(400, "Choose the cards to return.");
  return value.map((v, i) => {
    const r = (v ?? {}) as Record<string, unknown>;
    const quantity = r.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) throw new HttpError(400, `Line ${i + 1} needs a quantity of at least 1.`);
    return { lotId: id(r.lotId, `line ${i + 1}'s card`), pool: oneOf(r.pool ?? "accepted", ["accepted", "rejected"] as const, "accepted or declined copies"), quantity };
  });
}

/** Staff start a return on the consignor's behalf, or the consignor asks for one in their account. */
export async function requestReturn(admin: Admin, consignmentId: string, body: Record<string, unknown>, by: "staff" | "consignor", who: string) {
  const args = {
    p_consignment_id: consignmentId,
    p_lines: returnLines(body.lines),
    p_ends_consignment: body.endsConsignment === true,
    p_requested_by: by,
    p_note: text(body.note, 1000, "The note") ?? "",
    p_actor: who,
  };
  return rpc<string>(admin, "consignment_request_return", args, "Could not request the return.");
}

export async function staffRequestReturn(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const consignmentId = id(body.consignmentId, "a consignment");
  const returnId = await requestReturn(admin, consignmentId, body, "staff", actor(staff));
  await audit(admin, staff, "consignment.return.request", "consignment_return", returnId, { consignmentId, lines: body.lines ?? "all unsold", endsConsignment: body.endsConsignment === true });
  return { returnId };
}

export async function approveReturn(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const returnId = id(body.returnId, "a return");
  await rpc(admin, "consignment_approve_return", { p_return_id: returnId, p_actor: actor(staff) }, "Could not approve the return.");
  await audit(admin, staff, "consignment.return.approve", "consignment_return", returnId);
}

export async function advanceReturn(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const returnId = id(body.returnId, "a return");
  const step = oneOf(body.step, RETURN_STEPS, "the next step");
  const args = {
    p_return_id: returnId,
    p_step: step,
    p_shipping_cost_cents: cents(body.shippingCostCents, "the return shipping cost", { max: 100_000 }),
    p_we_pay: body.wePay === true,
    p_carrier: text(body.carrier, 60, "The carrier") ?? "",
    p_tracking: text(body.trackingNumber, 60, "The tracking number") ?? "",
    p_insured_value_cents: cents(body.insuredValueCents, "the value insured"),
    p_at: when(body.at, "the date"),
    p_actor: actor(staff),
  };
  const status = await rpc<string>(admin, "consignment_advance_return", args, "Could not update the return.");
  await audit(admin, staff, `consignment.return.${step}`, "consignment_return", returnId, { ...args, p_actor: undefined, status });
  return { status };
}

export async function cancelReturn(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const returnId = id(body.returnId, "a return");
  const reason = text(body.reason, 500, "The reason");
  if (!reason) throw new HttpError(400, "Say why the return is cancelled.");
  await rpc(admin, "consignment_cancel_return", { p_return_id: returnId, p_reason: reason, p_actor: actor(staff) }, "Could not cancel the return.");
  await audit(admin, staff, "consignment.return.cancel", "consignment_return", returnId, { reason });
}

export async function closeConsignment(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const consignmentId = id(body.consignmentId, "a consignment");
  await rpc(admin, "consignment_close", { p_consignment_id: consignmentId, p_actor: actor(staff) }, "Could not close the consignment.");
  await audit(admin, staff, "consignment.close", "consignment", consignmentId);
}

// ---------------------------------------------------------------- reading

/** Holds, adjustments, shipments, claims and returns for one consignment's page. */
export async function aftercareForConsignment(admin: Admin, consignmentId: string, orderIds: string[]) {
  const [holds, adjustments, returns] = await Promise.all([
    admin.from("consignment_sale_holds").select("*").eq("consignment_id", consignmentId).order("opened_at", { ascending: false }),
    admin.from("consignment_adjustments").select("*").eq("consignment_id", consignmentId).order("created_at", { ascending: false }),
    admin.from("consignment_returns").select("*").eq("consignment_id", consignmentId).order("requested_at", { ascending: false }),
  ]);
  if (holds.error || adjustments.error || returns.error) throw new HttpError(500, "Could not load the consignment's records.");
  const returnIds = (returns.data ?? []).map((r) => r.id);
  const [lines, shipments, claims, orders] = await Promise.all([
    returnIds.length ? admin.from("consignment_return_lines").select("*").in("return_id", returnIds) : Promise.resolve({ data: [], error: null }),
    orderIds.length ? admin.from("consignment_shipments").select("*").in("order_id", orderIds) : Promise.resolve({ data: [], error: null }),
    orderIds.length ? admin.from("consignment_shipping_claims").select("*").in("order_id", orderIds).order("opened_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    orderIds.length
      ? admin.from("orders").select("id, status, shipped_at, delivered_at, tracking_carrier, tracking_number, shipping_service, postage_cost_cents").in("id", orderIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (lines.error || shipments.error || claims.error || orders.error) throw new HttpError(500, "Could not load the consignment's shipments.");
  // Every consigned card in those packages, whoever consigned it: a claim is
  // settled for the whole package.
  let orderSales: { id: string; order_id: string; status: string; gross_cents: number; cardName: string }[] = [];
  if (orderIds.length) {
    const { data: os, error } = await admin.from("consignment_sales").select("id, order_id, lot_id, status, gross_cents").in("order_id", orderIds);
    if (error) throw new HttpError(500, "Could not load the packages' cards.");
    const lotIds = [...new Set((os ?? []).map((s) => s.lot_id))];
    const { data: ls } = lotIds.length ? await admin.from("consignment_lots").select("id, card_name").in("id", lotIds) : { data: [] };
    const nm = new Map((ls ?? []).map((l) => [l.id, l.card_name]));
    orderSales = (os ?? []).map((s) => ({ id: s.id, order_id: s.order_id!, status: s.status, gross_cents: s.gross_cents, cardName: nm.get(s.lot_id) ?? "Card" }));
  }
  return {
    orderSales,
    holds: holds.data ?? [],
    adjustments: adjustments.data ?? [],
    returns: (returns.data ?? []).map((r) => ({ ...r, lines: ((lines.data ?? []) as { return_id: string }[]).filter((l) => l.return_id === r.id) })),
    shipments: shipments.data ?? [],
    claims: claims.data ?? [],
    orders: orders.data ?? [],
  };
}

/**
 * The payout dashboard (spec part 12): every unpaid sale across consignments,
 * with its money columns, delivery, inspection end and payout due date,
 * plus recent payouts.
 */
export async function payoutDashboard(admin: Admin) {
  const [sales, payouts, holds] = await Promise.all([
    admin.from("consignment_sales").select("*").in("status", ["open", "settled"]).order("sold_at", { ascending: true }).limit(2000),
    admin.from("consignment_payouts").select("*").order("paid_at", { ascending: false }).limit(100),
    admin.from("consignment_sale_holds").select("sale_id, reason, source").is("resolved_at", null),
  ]);
  if (sales.error || payouts.error || holds.error) throw new HttpError(500, "Could not load payouts.");
  const consignmentIds = [...new Set([...(sales.data ?? []).map((s) => s.consignment_id), ...(payouts.data ?? []).map((p) => p.consignment_id)])];
  const lotIds = [...new Set((sales.data ?? []).map((s) => s.lot_id))];
  const [cs, lots] = await Promise.all([
    consignmentIds.length ? admin.from("consignments").select("id, consignment_number, consignor_id").in("id", consignmentIds) : Promise.resolve({ data: [], error: null }),
    lotIds.length ? admin.from("consignment_lots").select("id, card_name, set_code, collector_number").in("id", lotIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const consignorIds = [...new Set((cs.data ?? []).map((c) => c.consignor_id))];
  const { data: consignors } = consignorIds.length ? await admin.from("consignors").select("id, legal_name").in("id", consignorIds) : { data: [] };
  const name = new Map((consignors ?? []).map((p) => [p.id, p.legal_name]));
  const who = new Map((cs.data ?? []).map((c) => [c.id, { label: consignmentLabel(c.consignment_number), consignor: name.get(c.consignor_id) ?? "" }]));
  const card = new Map((lots.data ?? []).map((l) => [l.id, `${l.card_name} (${l.set_code.toUpperCase()} #${l.collector_number})`]));
  const held = new Map<string, string>();
  for (const h of holds.data ?? []) held.set(h.sale_id, h.reason);
  return {
    sales: (sales.data ?? []).map((s) => ({
      ...s,
      consignmentLabel: who.get(s.consignment_id)?.label ?? "",
      consignorName: who.get(s.consignment_id)?.consignor ?? "",
      cardName: card.get(s.lot_id) ?? "Card",
      holdReason: held.get(s.id) ?? null,
    })),
    payouts: (payouts.data ?? []).map((p) => ({ ...p, consignmentLabel: who.get(p.consignment_id)?.label ?? "", consignorName: who.get(p.consignment_id)?.consignor ?? "" })),
  };
}
