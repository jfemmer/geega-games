import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { requireStaff } from "../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { logAdminAction } from "../_lib/auditLog.js";
import { UUID_RE, YardSaleError, yardSaleDbError } from "../_lib/yardSale.js";
import { YARD_SALE_LIMITS } from "../../src/store/lib/yardSale.js";

// Staff-only: the Yard Sale Mode switch (Admin → Yard Sale Mode).
//
//   GET    /api/admin/yard-sale                    the current (or last) sale and its lists
//   POST   /api/admin/yard-sale                    { endsAt, discountPercent, minPriceCents }  turn it on
//   PATCH  /api/admin/yard-sale                    { saleId, endsAt?, discountPercent?, minPriceCents? }
//   POST   /api/admin/yard-sale?action=end         { saleId }  turn it off now
//
// The rules (one sale at a time, an end time within 7 days, online orders
// paused while it's on, open lists left alone when it ends) are in the
// database functions; every change is in the audit log. Each answer is the
// same snapshot GET returns, so the page just shows what came back.

type SaleRow = {
  id: string;
  started_at: string;
  ends_at: string;
  ended_at: string | null;
  discount_percent: number;
  min_price_cents: number;
  next_pickup_number: number;
};

export interface YardSaleSnapshot {
  sale: {
    id: string;
    startedAt: string;
    endsAt: string;
    endedAt: string | null;
    active: boolean;
    discountPercent: number;
    minPriceCents: number;
    listsSent: number;
  } | null;
  /** Lists still open, from any sale. */
  openLists: number;
  /** Of those, lists whose sale is over: they need completing or cancelling. */
  openListsFromEndedSales: number;
  /** This sale's completed lists and what they brought in. */
  completedLists: number;
  completedTotalCents: number;
}

function isActive(sale: Pick<SaleRow, "ends_at" | "ended_at">): boolean {
  return sale.ended_at === null && Date.parse(sale.ends_at) > Date.now();
}

async function snapshot(): Promise<YardSaleSnapshot> {
  const admin = getSupabaseAdmin();
  const [saleRes, openRes] = await Promise.all([
    admin.from("yard_sales").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    admin
      .from("pickup_requests")
      .select("id, yard_sale_id")
      .not("yard_sale_id", "is", null)
      .in("status", ["waiting", "ready"]),
  ]);
  if (saleRes.error || openRes.error) throw new HttpError(500, "Could not load Yard Sale Mode.");
  const sale = (saleRes.data as SaleRow | null) ?? null;
  const open = (openRes.data ?? []) as { id: string; yard_sale_id: string }[];
  const activeId = sale && isActive(sale) ? sale.id : null;

  let completedLists = 0;
  let completedTotalCents = 0;
  if (sale) {
    const { data: done, error } = await admin
      .from("pickup_requests")
      .select("order_id")
      .eq("yard_sale_id", sale.id)
      .eq("status", "completed");
    if (error) throw new HttpError(500, "Could not load Yard Sale Mode.");
    const orderIds = ((done ?? []) as { order_id: string | null }[]).map((r) => r.order_id).filter((id): id is string => !!id);
    completedLists = (done ?? []).length;
    if (orderIds.length > 0) {
      const { data: orders, error: ordersError } = await admin.from("orders").select("total_cents").in("id", orderIds);
      if (ordersError) throw new HttpError(500, "Could not load Yard Sale Mode.");
      completedTotalCents = ((orders ?? []) as { total_cents: number }[]).reduce((sum, o) => sum + o.total_cents, 0);
    }
  }

  return {
    sale: sale
      ? {
          id: sale.id,
          startedAt: sale.started_at,
          endsAt: sale.ends_at,
          endedAt: sale.ended_at,
          active: activeId === sale.id,
          discountPercent: sale.discount_percent,
          minPriceCents: sale.min_price_cents,
          listsSent: sale.next_pickup_number - 1,
        }
      : null,
    openLists: open.length,
    openListsFromEndedSales: open.filter((r) => r.yard_sale_id !== activeId).length,
    completedLists,
    completedTotalCents,
  };
}

interface Body {
  saleId?: unknown;
  endsAt?: unknown;
  discountPercent?: unknown;
  minPriceCents?: unknown;
}

function endsAtFrom(value: unknown, required: boolean): string | null {
  if (value === undefined || value === null) {
    if (required) throw new YardSaleError(400, "Pick when the yard sale ends.", "invalid");
    return null;
  }
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time)) throw new YardSaleError(400, "Pick when the yard sale ends.", "invalid");
  return new Date(time).toISOString();
}

function discountFrom(value: unknown, required: boolean): number | null {
  if (value === undefined || value === null) {
    if (required) return 0;
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > YARD_SALE_LIMITS.maxDiscountPercent) {
    throw new YardSaleError(400, `The discount must be a whole number from 0% to ${YARD_SALE_LIMITS.maxDiscountPercent}%.`, "invalid");
  }
  return value;
}

function minPriceFrom(value: unknown, required: boolean): number | null {
  if (value === undefined || value === null) {
    if (required) throw new YardSaleError(400, "Enter the lowest card price to show.", "invalid");
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > YARD_SALE_LIMITS.maxMinPriceCents) {
    throw new YardSaleError(400, "The minimum price must be between $0 and $1,000.", "invalid");
  }
  return value;
}

function saleIdFrom(value: unknown): string {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!UUID_RE.test(id)) throw new YardSaleError(400, "Which yard sale?", "invalid");
  return id;
}

/** A function returning a table row comes back as the row or a one-row array, depending on the client. */
function saleRowOf(data: unknown): SaleRow {
  const row = (Array.isArray(data) ? data[0] : data) as SaleRow | null | undefined;
  if (!row?.id) throw new HttpError(500, "The yard sale didn't come back.");
  return row;
}

function auditFields(row: SaleRow): Record<string, unknown> {
  return {
    ends_at: row.ends_at,
    ended_at: row.ended_at,
    discount_percent: row.discount_percent,
    min_price_cents: row.min_price_cents,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const method = req.method ?? "";
  if (!["GET", "POST", "PATCH"].includes(method)) return methodNotAllowed(res, ["GET", "POST", "PATCH"]);

  try {
    const staff = await requireStaff(req);
    const admin = getSupabaseAdmin();

    if (method === "GET") {
      return sendJson(res, 200, { ok: true, ...(await snapshot()) });
    }

    const body = (await readJsonBody(req)) as Body;
    const action = typeof req.query.action === "string" ? req.query.action : "";

    if (method === "POST" && action === "end") {
      const saleId = saleIdFrom(body.saleId);
      const { data: before } = await admin.from("yard_sales").select("*").eq("id", saleId).maybeSingle();
      const { data, error } = await admin.rpc("yard_sale_end", { p_sale_id: saleId, p_actor: staff.userId });
      if (error) throw yardSaleDbError(error, "Could not end the yard sale.");
      const after = saleRowOf(data);
      await logAdminAction(admin, staff, {
        action: "yard_sale.ended",
        resourceType: "yard_sale",
        resourceId: saleId,
        before: before ? auditFields(before as SaleRow) : null,
        after: auditFields(after),
      });
      return sendJson(res, 200, { ok: true, ...(await snapshot()) });
    }

    if (method === "POST") {
      if (action) throw new YardSaleError(400, "Unknown action.", "invalid");
      const endsAt = endsAtFrom(body.endsAt, true) as string;
      const discountPercent = discountFrom(body.discountPercent, true) as number;
      const minPriceCents = minPriceFrom(body.minPriceCents, true) as number;
      const { data, error } = await admin.rpc("yard_sale_start", {
        p_ends_at: endsAt,
        p_discount_percent: discountPercent,
        p_min_price_cents: minPriceCents,
        p_actor: staff.userId,
      });
      if (error) {
        if (error.code === "23505") throw new YardSaleError(409, "A yard sale is already on.", "not_allowed");
        throw yardSaleDbError(error, "Could not start the yard sale.");
      }
      const sale = saleRowOf(data);
      await logAdminAction(admin, staff, {
        action: "yard_sale.started",
        resourceType: "yard_sale",
        resourceId: sale.id,
        after: auditFields(sale),
      });
      return sendJson(res, 201, { ok: true, ...(await snapshot()) });
    }

    // PATCH: change the sale while it's on.
    const saleId = saleIdFrom(body.saleId);
    const endsAt = endsAtFrom(body.endsAt, false);
    const discountPercent = discountFrom(body.discountPercent, false);
    const minPriceCents = minPriceFrom(body.minPriceCents, false);
    if (endsAt === null && discountPercent === null && minPriceCents === null) {
      throw new YardSaleError(400, "Nothing to change.", "invalid");
    }
    const { data: before } = await admin.from("yard_sales").select("*").eq("id", saleId).maybeSingle();
    const { data, error } = await admin.rpc("yard_sale_update", {
      p_sale_id: saleId,
      p_ends_at: endsAt ?? undefined,
      p_discount_percent: discountPercent ?? undefined,
      p_min_price_cents: minPriceCents ?? undefined,
      p_actor: staff.userId,
    });
    if (error) throw yardSaleDbError(error, "Could not save the yard sale.");
    const after = saleRowOf(data);
    await logAdminAction(admin, staff, {
      action: "yard_sale.updated",
      resourceType: "yard_sale",
      resourceId: saleId,
      before: before ? auditFields(before as SaleRow) : null,
      after: auditFields(after),
    });
    return sendJson(res, 200, { ok: true, ...(await snapshot()) });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/admin/yard-sale] error", err);
    return sendJson(res, status, { ok: false, message });
  }
}
