import type { StaffContext } from "./adminAuth.js";
import { logAdminAction } from "./auditLog.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { HttpError } from "./http.js";
import {
  allocateByPrice,
  applyBps,
  commissionRateBps,
  type CommissionTier,
} from "../../src/store/lib/consignmentMath.js";

// Selling consigned cards: listing on the website, TCGplayer/eBay sales staff
// record, settling each sale once the buyer's inspection period is over, and
// payouts. The database does the bookkeeping and the commission math
// (supabase/migrations/20261029120000_consignment_sales.sql); this module
// checks input, works out the expenses to propose for a website sale from its
// order (agreement 4.3-4.5), and audits every change.

type Admin = ReturnType<typeof getSupabaseAdmin>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTERNAL_CHANNELS = ["tcgplayer", "ebay"] as const;
const PAYOUT_METHODS = ["paypal", "venmo", "zelle", "check", "ach", "store_credit"] as const;

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(400, `Choose ${label}.`);
  return value;
}

function cents(value: unknown, label: string, { required = false, min = 0, max = 100_000_000 } = {}): number | null {
  if (value === null || value === undefined || value === "") {
    if (required) throw new HttpError(400, `Enter ${label}.`);
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${label[0].toUpperCase()}${label.slice(1)} isn't a valid amount.`);
  }
  return value;
}

function count(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 9999) throw new HttpError(400, `${label} must be a whole number from 1 to 9,999.`);
  return value;
}

function text(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new HttpError(400, "Notes must be text.");
  const t = value.trim();
  if (t.length > max) throw new HttpError(400, `Keep it under ${max} characters.`);
  return t || null;
}

function when(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new HttpError(400, `Enter ${label}.`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `Enter ${label}.`);
  return d.toISOString();
}

/** The database's GC0xx refusals carry messages written for staff. */
export function salesDbError(error: { code?: string; message?: string } | null, fallback: string): HttpError {
  const code = error?.code ?? "";
  if (/^GC0[4-9][0-9]$/.test(code) && error?.message) {
    const status = ["GC041", "GC062", "GC066"].includes(code) ? 404 : ["GC044", "GC063", "GC064", "GC065", "GC082", "GC085"].includes(code) ? 409 : 400;
    return new HttpError(status, error.message);
  }
  return new HttpError(500, fallback);
}

async function rpc<T>(admin: Admin, fn: string, args: Record<string, unknown>, fallback: string): Promise<T> {
  // The generated types know every function; the names here are checked by the tests.
  const { data, error } = await (admin.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: T; error: { code?: string; message?: string } | null }>)(fn, args);
  if (error) throw salesDbError(error, fallback);
  return data;
}

const actor = (staff: StaffContext) => staff.email ?? "staff";

// ---------------------------------------------------------------- listing

export async function listLot(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const lotId = id(body.lotId, "a card line");
  const quantity = count(body.quantity, "Copies to list");
  const price = cents(body.priceCents, "the list price", { min: 1 });
  const inventoryId = await rpc<string>(admin, "consignment_list_lot", { p_lot_id: lotId, p_quantity: quantity, p_price_cents: price, p_actor: actor(staff) }, "Could not list those cards.");
  await logAdminAction(admin, staff, { action: "consignment.lot.list", resourceType: "consignment_lot", resourceId: lotId, after: { quantity, priceCents: price, inventoryId } });
  return { inventoryId };
}

export async function unlistLot(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const lotId = id(body.lotId, "a card line");
  const quantity = count(body.quantity, "Copies to take off sale");
  const status = await rpc<string>(admin, "consignment_unlist_lot", { p_lot_id: lotId, p_quantity: quantity, p_actor: actor(staff) }, "Could not take those cards off sale.");
  await logAdminAction(admin, staff, { action: "consignment.lot.unlist", resourceType: "consignment_lot", resourceId: lotId, after: { quantity, status } });
  return { status };
}

export async function setLotPrice(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const lotId = id(body.lotId, "a card line");
  const price = cents(body.priceCents, "the list price", { required: true, min: 1 })!;
  await rpc(admin, "consignment_set_lot_price", { p_lot_id: lotId, p_price_cents: price, p_actor: actor(staff) }, "Could not change the price.");
  await logAdminAction(admin, staff, { action: "consignment.lot.price", resourceType: "consignment_lot", resourceId: lotId, after: { priceCents: price } });
}

// ---------------------------------------------------------------- sales

export async function recordExternalSale(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const lotId = id(body.lotId, "a card line");
  const channel = EXTERNAL_CHANNELS.find((c) => c === body.channel);
  if (!channel) throw new HttpError(400, "Choose TCGplayer or eBay.");
  const args = {
    p_lot_id: lotId,
    p_channel: channel,
    p_quantity: count(body.quantity, "Copies sold"),
    p_unit_price_cents: cents(body.unitPriceCents, "what each card sold for", { required: true, min: 1 }),
    p_sold_at: when(body.soldAt, "when it sold"),
    p_external_ref: text(body.externalRef, 100) ?? "",
    p_marketplace_fee_cents: cents(body.marketplaceFeeCents, "the marketplace fee") ?? 0,
    p_processing_fee_cents: cents(body.processingFeeCents, "the processing fee") ?? 0,
    p_postage_cents: cents(body.postageCents, "the postage") ?? 0,
    p_notes: text(body.notes, 1000) ?? "",
    p_actor: actor(staff),
  };
  const saleId = await rpc<string>(admin, "consignment_record_external_sale", args, "Could not record the sale.");
  await logAdminAction(admin, staff, { action: "consignment.sale.record", resourceType: "consignment_sale", resourceId: saleId, after: { ...args, p_actor: undefined } });
  return { saleId };
}

export async function markDelivered(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const saleId = id(body.saleId, "a sale");
  const deliveredAt = when(body.deliveredAt, "when it was delivered");
  const payableAt = await rpc<string>(admin, "consignment_mark_sale_delivered", { p_sale_id: saleId, p_delivered_at: deliveredAt, p_actor: actor(staff) }, "Could not record the delivery.");
  await logAdminAction(admin, staff, { action: "consignment.sale.delivered", resourceType: "consignment_sale", resourceId: saleId, after: { deliveredAt, payableAt } });
  return { payableAt };
}

interface SaleRow {
  id: string;
  consignment_id: string;
  channel: "website" | "tcgplayer" | "ebay";
  order_id: string | null;
  order_item_id: string | null;
  quantity: number;
  unit_price_cents: number;
  gross_cents: number;
  sold_at: string;
  status: string;
  insurance_elected: boolean | null;
  commission_tiers: CommissionTier[];
  marketplace_fee_cents: number | null;
  processing_fee_cents: number | null;
  postage_cents: number | null;
}

export type SettlementProposal = {
  saleId: string;
  expenses: { marketplaceFeeCents: number; processingFeeCents: number; postageCents: number; insuranceCents: number; otherExpenseCents: number };
  /** How each figure was worked out, kept with the settlement. */
  basis: string[];
  /** Things staff must check before confirming. */
  warnings: string[];
  preview: { grossCents: number; expensesCents: number; netSaleCents: number; commissionRateBps: number; commissionCents: number; payoutCents: number };
};

/** The settlement math, exactly as consignment_settle_sale does it. */
export function previewSettlement(sale: Pick<SaleRow, "gross_cents" | "unit_price_cents" | "commission_tiers">, expenses: SettlementProposal["expenses"]) {
  const expensesCents = Object.values(expenses).reduce((a, b) => a + Math.max(0, b), 0);
  const net = Math.max(0, sale.gross_cents - expensesCents);
  const rate = commissionRateBps(sale.unit_price_cents, sale.commission_tiers);
  const commission = net > 0 ? applyBps(net, rate) : 0;
  return { grossCents: sale.gross_cents, expensesCents, netSaleCents: net, commissionRateBps: rate, commissionCents: commission, payoutCents: net - commission };
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

/** The expenses to propose for one sale: from its order for the website, as entered for marketplaces. */
export async function proposeSettlement(admin: Admin, saleId: string): Promise<SettlementProposal> {
  const { data: sale, error } = await admin.from("consignment_sales").select("*").eq("id", id(saleId, "a sale")).maybeSingle();
  if (error) throw new HttpError(500, "Could not load the sale.");
  if (!sale) throw new HttpError(404, "That sale isn't there.");
  const s = sale as unknown as SaleRow;
  const basis: string[] = [];
  const warnings: string[] = [];
  const expenses = { marketplaceFeeCents: 0, processingFeeCents: 0, postageCents: 0, insuranceCents: 0, otherExpenseCents: 0 };

  if (s.channel !== "website") {
    expenses.marketplaceFeeCents = s.marketplace_fee_cents ?? 0;
    expenses.processingFeeCents = s.processing_fee_cents ?? 0;
    expenses.postageCents = s.postage_cents ?? 0;
    basis.push(`Fees and postage as entered from the ${s.channel === "ebay" ? "eBay" : "TCGplayer"} order.`);
    return { saleId: s.id, expenses, basis, warnings, preview: previewSettlement(s, expenses) };
  }

  const [{ data: order, error: oErr }, { data: items, error: iErr }] = await Promise.all([
    admin
      .from("orders")
      .select("id, amount_due_cents, shipping_cents, postage_cost_cents, payment_provider, shipping_method, tracking_number")
      .eq("id", s.order_id!)
      .maybeSingle(),
    admin.from("order_items").select("id, line_total_cents").eq("order_id", s.order_id!).order("id", { ascending: true }),
  ]);
  if (oErr || iErr || !order) throw new HttpError(500, "Could not load the order.");
  const lines = (items ?? []) as { id: string; line_total_cents: number }[];
  const index = lines.findIndex((l) => l.id === s.order_item_id);
  if (index < 0) throw new HttpError(500, "Could not find this sale's line in its order.");
  const weights = lines.map((l) => l.line_total_cents);
  const share = (total: number) => allocateByPrice(total, weights)[index];
  const packageValue = weights.reduce((a, b) => a + b, 0);
  const others = lines.length > 1 ? ` (its share of ${lines.length} cards in the order, by price)` : "";

  // Processing on what the buyer was charged, under the website rates in effect when it sold.
  const { data: fee } = await admin
    .from("consignment_fee_schedules")
    .select("marketplace_bps, processing_bps, processing_fixed_cents")
    .eq("channel", "website")
    .lte("effective_from", s.sold_at)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  const charged = order.payment_provider === "store_credit" ? 0 : Math.max(0, order.amount_due_cents ?? 0);
  if (fee && charged > 0) {
    const orderProcessing = applyBps(charged, fee.processing_bps) + fee.processing_fixed_cents;
    expenses.processingFeeCents = share(orderProcessing);
    basis.push(`Processing: ${(fee.processing_bps / 100).toFixed(2)}% + ${usd(fee.processing_fixed_cents)} on ${usd(charged)} charged = ${usd(orderProcessing)}${others}.`);
    if (order.payment_provider === "paypal") warnings.push("Paid with PayPal: check the actual PayPal fee and adjust processing if it differs.");
  } else if (charged === 0) {
    basis.push("No card processing: the order was paid with store credit.");
  } else {
    warnings.push("No website fee schedule was in effect when this sold. Enter processing by hand.");
  }

  // Postage actually paid, less what the buyer paid for shipping (agreement 4.4).
  if (order.postage_cost_cents != null) {
    const net = Math.max(0, order.postage_cost_cents - (order.shipping_cents ?? 0));
    expenses.postageCents = share(net);
    basis.push(`Postage: ${usd(order.postage_cost_cents)} label − ${usd(order.shipping_cents ?? 0)} paid by the buyer = ${usd(net)}${others}.`);
  } else {
    warnings.push("The label wasn't bought through the site, so postage isn't known. Enter the postage you paid.");
  }

  // Additional insurance (5.2, 5.3): the premium recorded for this package,
  // by this card's share, only if the consignor had approved insurance when
  // it sold. Shares of consignors who declined, and of our own cards, are ours.
  const { data: shipment } = await admin
    .from("consignment_shipments")
    .select("insurance_needed, insurance_premium_cents, insured_value_cents, estimated_premium_cents, over_limit")
    .eq("order_id", s.order_id!)
    .maybeSingle();
  if (shipment?.insurance_premium_cents != null) {
    if (s.insurance_elected) {
      expenses.insuranceCents = share(shipment.insurance_premium_cents);
      basis.push(`Insurance: ${usd(shipment.insurance_premium_cents)} premium on a ${usd(packageValue)} package${others}.`);
    } else {
      basis.push("Insurance: the consignor declined additional insurance, so its premium isn't charged to them.");
    }
  } else if (shipment?.insurance_needed) {
    warnings.push(
      `The consignor approved additional insurance and the package was worth ${usd(packageValue)}${shipment.estimated_premium_cents != null ? ` (published premium ${usd(shipment.estimated_premium_cents)})` : ""}, but no insurance purchase is recorded. Record it on the shipment first. If it wasn't bought, a carrier loss on this package is ours under agreement 5.5.`,
    );
  }
  if (shipment?.over_limit) warnings.push("This package was worth more than USPS insures. Check how it was covered.");

  return { saleId: s.id, expenses, basis, warnings, preview: previewSettlement(s, expenses) };
}

export async function settleSale(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const saleId = id(body.saleId, "a sale");
  const proposal = await proposeSettlement(admin, saleId);
  const e = (body.expenses ?? {}) as Record<string, unknown>;
  const expenses = {
    marketplaceFeeCents: cents(e.marketplaceFeeCents, "the marketplace fee") ?? 0,
    processingFeeCents: cents(e.processingFeeCents, "the processing fee") ?? 0,
    postageCents: cents(e.postageCents, "the postage") ?? 0,
    insuranceCents: cents(e.insuranceCents, "the insurance") ?? 0,
    otherExpenseCents: cents(e.otherExpenseCents, "the other expense") ?? 0,
  };
  const note = text(body.otherExpenseNote, 500);
  const changed = (Object.keys(expenses) as (keyof typeof expenses)[]).filter((k) => expenses[k] !== proposal.expenses[k]);
  const detail = {
    basis: proposal.basis,
    proposed: proposal.expenses,
    adjusted: changed,
    adjustmentNote: text(body.adjustmentNote, 500),
  };
  const payout = await rpc<number>(
    admin,
    "consignment_settle_sale",
    {
      p_sale_id: saleId,
      p_marketplace_fee_cents: expenses.marketplaceFeeCents,
      p_processing_fee_cents: expenses.processingFeeCents,
      p_postage_cents: expenses.postageCents,
      p_insurance_cents: expenses.insuranceCents,
      p_other_expense_cents: expenses.otherExpenseCents,
      p_other_expense_note: note ?? "",
      p_detail: detail,
      p_actor: actor(staff),
    },
    "Could not settle the sale.",
  );
  await logAdminAction(admin, staff, { action: "consignment.sale.settle", resourceType: "consignment_sale", resourceId: saleId, after: { expenses, payoutCents: payout, adjusted: changed } });
  return { payoutCents: payout };
}

export async function unsettleSale(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const saleId = id(body.saleId, "a sale");
  await rpc(admin, "consignment_unsettle_sale", { p_sale_id: saleId, p_actor: actor(staff) }, "Could not reopen the settlement.");
  await logAdminAction(admin, staff, { action: "consignment.sale.unsettle", resourceType: "consignment_sale", resourceId: saleId });
}

export async function cancelSale(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const saleId = id(body.saleId, "a sale");
  const reason = text(body.reason, 500);
  if (!reason) throw new HttpError(400, "Say why the sale is cancelled.");
  await rpc(admin, "consignment_cancel_sale", { p_sale_id: saleId, p_reason: reason, p_actor: actor(staff) }, "Could not cancel the sale.");
  await logAdminAction(admin, staff, { action: "consignment.sale.cancel", resourceType: "consignment_sale", resourceId: saleId, after: { reason } });
}

// ---------------------------------------------------------------- payouts

export async function recordPayout(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const consignmentId = id(body.consignmentId, "a consignment");
  const list = (v: unknown, label: string) => {
    if (v === undefined || v === null) return [] as string[];
    if (!Array.isArray(v) || v.length > 500) throw new HttpError(400, `Choose the ${label} this payout covers.`);
    return [...new Set(v.map((x) => id(x, `a ${label.replace(/s$/, "")}`)))];
  };
  const saleIds = list(body.saleIds, "sales");
  const adjustmentIds = list(body.adjustmentIds, "adjustments");
  if (saleIds.length + adjustmentIds.length === 0) throw new HttpError(400, "Choose the sales and adjustments this payout covers.");
  const method = PAYOUT_METHODS.find((m) => m === body.method);
  if (!method) throw new HttpError(400, "Choose how you paid.");
  const args = {
    p_consignment_id: consignmentId,
    p_sale_ids: saleIds,
    p_adjustment_ids: adjustmentIds,
    p_method: method,
    p_reference: text(body.reference, 200) ?? "",
    p_paid_at: when(body.paidAt, "when you paid"),
    p_note: text(body.note, 1000) ?? "",
    p_actor: actor(staff),
  };
  const payoutId = await rpc<string>(admin, "consignment_record_payout", args, "Could not record the payout.");
  await logAdminAction(admin, staff, { action: "consignment.payout.record", resourceType: "consignment_payout", resourceId: payoutId, after: { ...args, p_actor: undefined } });
  return { payoutId };
}

export async function voidPayout(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const payoutId = id(body.payoutId, "a payout");
  const reason = text(body.reason, 500);
  if (!reason) throw new HttpError(400, "Say why the payout is void.");
  await rpc(admin, "consignment_void_payout", { p_payout_id: payoutId, p_reason: reason, p_actor: actor(staff) }, "Could not void the payout.");
  await logAdminAction(admin, staff, { action: "consignment.payout.void", resourceType: "consignment_payout", resourceId: payoutId, after: { reason } });
}

// ---------------------------------------------------------------- reading

/** Everything the Sales and Payouts sections of a consignment need. */
export async function salesForConsignment(admin: Admin, consignmentId: string) {
  const [sales, payouts, quantities] = await Promise.all([
    admin.from("consignment_sales").select("*").eq("consignment_id", consignmentId).order("sold_at", { ascending: false }).limit(5000),
    admin.from("consignment_payouts").select("*").eq("consignment_id", consignmentId).order("paid_at", { ascending: false }).limit(1000),
    admin.rpc("consignment_lot_quantities_all", { p_consignment_id: consignmentId }),
  ]);
  if (sales.error || payouts.error || quantities.error) throw new HttpError(500, "Could not load the consignment's sales.");
  const lotIds = ((quantities.data ?? []) as { lot_id: string }[]).map((q) => q.lot_id);
  let listings: unknown[] = [];
  if (lotIds.length) {
    const { data, error } = await admin.from("inventory_items").select("id, consignment_lot_id, quantity, price_cents, status").in("consignment_lot_id", lotIds);
    if (error) throw new HttpError(500, "Could not load the consignment's listings.");
    listings = data ?? [];
  }
  return { sales: sales.data ?? [], payouts: payouts.data ?? [], lotQuantities: quantities.data ?? [], listings };
}
