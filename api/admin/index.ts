import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../_lib/http.js";
import { requireStaff, type StaffContext } from "../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { normalizeEmail } from "../_lib/tokens.js";
import {
  mapAuthUserToStaff,
  isStaffUser,
  staffRoleOf,
  STAFF_ROLES,
  type StaffRole,
} from "../_lib/staff.js";
import type { Database } from "../../src/types/database.js";
import { sendOrderStatusEmail } from "../_lib/orderStatusEmail.js";
import { logAdminAction } from "../_lib/auditLog.js";
import { sendPickupReadyEmail } from "../_lib/pickupEmails.js";
import { UUID_RE, loadLivePrices, yardSaleDbError } from "../_lib/yardSale.js";
import { getStripe } from "../_lib/stripe.js";
import { buyShippingLabel, isEasyPostConnected } from "../_lib/easypost.js";

// ─────────────────────────────────────────────────────────────────────────────
// Consolidated admin API router.
//
// WHY ONE FILE: Vercel counts one Serverless Function per file under `api/`.
// The Hobby plan caps a deployment at 12 functions. The customers / reservations
// / campaigns / staff features were originally eight small files; collapsing
// them into this single router keeps the whole surface at/under the cap while
// preserving identical behavior and security.
//
// ROUTING: the browser calls `/api/admin?resource=<r>&action=<a>` (and, for
// per-id operations, `&id=<uuid>`). Method still matters (GET reads, POST/PATCH
// writes). Every branch calls requireStaff() first; the underlying SECURITY
// DEFINER RPCs re-check is_staff()/service_role, so this is defense in depth.
//
// This file contains exactly the same logic as the previous endpoints:
//   resource=customers   action=list           GET
//   resource=customers   action=create         POST
//   resource=customers   action=status  &id=   POST
//   resource=reservations action=list          GET
//   resource=reservations action=create        POST
//   resource=reservations action=release       POST
//   resource=orders       action=set-status    POST
//   resource=orders       action=ship          POST
//   resource=orders       action=buy-label     POST
//   resource=orders       action=shipping-setup GET
//   resource=orders       action=add-note      POST
//   resource=orders       action=toggle-packed POST
//   resource=campaigns   action=list           GET
//   resource=campaigns   action=save           POST
//   resource=campaigns   action=audience-count GET   (&audience=)
//   resource=staff       action=list           GET
//   resource=staff       action=invite         POST
//   resource=staff       action=update  &id=   PATCH
//   resource=pos          action=settings          GET
//   resource=pos          action=save-settings     POST
//   resource=pos          action=create-sale       POST
//   resource=pos          action=mark-cash-paid    POST
//   resource=pos          action=void-sale         POST
//   resource=pos          action=terminal-connection-token  POST
//   resource=pos          action=terminal-create-intent     POST
//   resource=pos          action=terminal-locations         GET
//   resource=pos          action=terminal-create-location   POST
//   resource=pos          action=terminal-readers           GET
//   resource=pickup        action=list                       GET
//   resource=pickup        action=toggle-item                POST
//   resource=pickup        action=mark-ready                 POST
//   resource=pickup        action=cancel                     POST
//   resource=pickup        action=complete-sale              POST
//   resource=pickup        action=remove-item                POST
//   resource=pickup        action=complete-yard-sale         POST
// ─────────────────────────────────────────────────────────────────────────────

type CampaignRow = Database["public"]["Tables"]["campaigns"]["Row"];
type Audience = Database["public"]["Enums"]["campaign_audience"];

const AUDIENCES = new Set<Audience>([
  "active_subscribers",
  "confirmed_recent",
  "all_customers",
]);

const BAN_DURATION = "876000h"; // ~100 years; lifted with "none".
const STAFF_PAGE_SIZE = 200;

function q(req: VercelRequest, key: string): string {
  const v = req.query[key];
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

function actorLabel(staff: StaffContext, bodyActor?: string | null): string {
  return (bodyActor && bodyActor.trim()) || staff.email || staff.userId;
}

function appRoleFor(staffRole: StaffRole): "admin" | "staff" {
  return staffRole === "owner" ? "admin" : "staff";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const staff = await requireStaff(req);
    const admin = getSupabaseAdmin();
    const resource = q(req, "resource");
    const action = q(req, "action");
    const method = (req.method ?? "GET").toUpperCase();

    // ───────────────────────────── customers ─────────────────────────────
    if (resource === "customers") {
      if (action === "list" && method === "GET") {
        const { data, error } = await admin.rpc("admin_customer_list");
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true, rows: (data ?? []) as unknown[] });
      }

      if (action === "create" && method === "POST") {
        const body = await readJsonBody(req);
        const email = normalizeEmail(body.email as string | undefined);
        if (!email) throw new HttpError(400, "A valid email address is required.");

        const { data: existing } = await admin
          .from("customers")
          .select("id")
          .eq("email", email)
          .maybeSingle();

        const { data, error } = await admin.rpc("admin_upsert_customer", {
          p_email: email,
          p_first_name: (body.firstName as string) ?? undefined,
          p_last_name: (body.lastName as string) ?? undefined,
          p_source: "manual",
        });
        if (error) throw new HttpError(500, error.message);

        return sendJson(res, existing ? 200 : 201, {
          ok: true,
          created: !existing,
          customer: data as unknown as Record<string, unknown>,
        });
      }

      if (action === "status" && method === "POST") {
        const id = q(req, "id");
        if (!id) throw new HttpError(400, "Customer id is required.");
        const body = await readJsonBody(req);
        const status = body.status;
        if (status !== "active" && status !== "disabled") {
          throw new HttpError(400, "status must be 'active' or 'disabled'.");
        }

        const { data: customer, error: readErr } = await admin
          .from("customers")
          .select("id, auth_user_id")
          .eq("id", id)
          .maybeSingle();
        if (readErr) throw new HttpError(500, readErr.message);
        if (!customer) throw new HttpError(404, "Customer not found.");

        const { data: updated, error: updErr } = await admin
          .from("customers")
          .update({ status })
          .eq("id", id)
          .select("*")
          .single();
        if (updErr) throw new HttpError(500, updErr.message);

        if (customer.auth_user_id) {
          const { error: authErr } = await admin.auth.admin.updateUserById(
            customer.auth_user_id,
            { ban_duration: status === "disabled" ? BAN_DURATION : "none" },
          );
          if (authErr) {
            throw new HttpError(
              500,
              `Customer flag updated, but the linked account could not be ${
                status === "disabled" ? "banned" : "unbanned"
              }: ${authErr.message}`,
            );
          }
        }

        return sendJson(res, 200, {
          ok: true,
          customer: updated as unknown as Record<string, unknown>,
        });
      }
    }

    // ──────────────────────────── reservations ───────────────────────────
    if (resource === "reservations") {
      if (action === "list" && method === "GET") {
        const { data, error } = await admin.rpc("admin_list_reservations");
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true, rows: (data ?? []) as unknown[] });
      }

      if (action === "create" && method === "POST") {
        const body = await readJsonBody(req);
        const inventoryItemId = String(body.inventoryItemId ?? "");
        const customerId = String(body.customerId ?? "");
        const quantity = Math.floor(Number(body.quantity));
        if (!inventoryItemId) throw new HttpError(400, "inventoryItemId is required.");
        if (!customerId) throw new HttpError(400, "customerId is required.");
        if (!Number.isFinite(quantity) || quantity < 1) {
          throw new HttpError(400, "quantity must be a whole number of at least 1.");
        }

        const { data, error } = await admin.rpc("admin_create_reservation", {
          p_inventory_item_id: inventoryItemId,
          p_customer_id: customerId,
          p_quantity: quantity,
          p_note: (body.note as string) ?? undefined,
          p_reserved_by: actorLabel(staff, body.reservedBy as string | null),
        });
        if (error) {
          const overbook =
            typeof error.message === "string" &&
            /available to reserve/i.test(error.message);
          throw new HttpError(overbook ? 409 : 500, error.message);
        }
        return sendJson(res, 201, {
          ok: true,
          reservation: data as unknown as Record<string, unknown>,
        });
      }

      if (action === "release" && method === "POST") {
        const body = await readJsonBody(req);
        const releasedBy = actorLabel(staff, body.releasedBy as string | null);

        if (body.reservationId) {
          const qtyRaw = body.quantity;
          const quantity =
            qtyRaw == null ? undefined : Math.max(1, Math.floor(Number(qtyRaw)));
          const { data, error } = await admin.rpc("admin_release_reservation", {
            p_reservation_id: String(body.reservationId),
            p_quantity: quantity,
            p_released_by: releasedBy,
          });
          if (error) throw new HttpError(500, error.message);
          return sendJson(res, 200, {
            ok: true,
            reservation: data as unknown as Record<string, unknown>,
          });
        }

        if (body.customerId) {
          const { data, error } = await admin.rpc(
            "admin_release_customer_reservations",
            {
              p_customer_id: String(body.customerId),
              p_inventory_item_id: (body.inventoryItemId as string) ?? undefined,
              p_released_by: releasedBy,
            },
          );
          if (error) throw new HttpError(500, error.message);
          return sendJson(res, 200, { ok: true, releasedCount: Number(data ?? 0) });
        }

        throw new HttpError(
          400,
          "Provide either reservationId or customerId to release.",
        );
      }
    }

    // ────────────────────────────── pos ──────────────────────────────
    // In-store register: staff-only sale creation against the same
    // inventory_items pool the storefront sells from (pos_create_sale), plus
    // cash tendering, voiding an unpaid sale, tax-rate settings, and the
    // Stripe Terminal plumbing (card-present PaymentIntents run through the
    // SAME webhook that marks online orders paid — no separate mark-paid
    // path for card here).
    if (resource === "pos") {
      async function loadPosOrder(orderId: string) {
        const { data, error } = await admin
          .from("orders")
          .select("id, channel, payment_status, amount_due_cents")
          .eq("id", orderId)
          .maybeSingle();
        if (error) throw new HttpError(500, error.message);
        if (!data) throw new HttpError(404, "Order not found.");
        if (data.channel !== "pos") {
          throw new HttpError(400, "That order wasn't created at the register.");
        }
        return data;
      }

      if (action === "settings" && method === "GET") {
        const { data, error } = await admin
          .from("pos_settings")
          .select("sales_tax_bps, updated_at, updated_by")
          .eq("id", 1)
          .single();
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true, settings: data as unknown as Record<string, unknown> });
      }

      if (action === "save-settings" && method === "POST") {
        const body = await readJsonBody(req);
        const bps = Math.round(Number(body.salesTaxBps));
        if (!Number.isFinite(bps) || bps < 0 || bps > 10000) {
          throw new HttpError(400, "salesTaxBps must be between 0 and 10000 (0%-100%).");
        }
        const { data, error } = await admin
          .from("pos_settings")
          .update({ sales_tax_bps: bps, updated_by: actorLabel(staff, null) })
          .eq("id", 1)
          .select("sales_tax_bps, updated_at, updated_by")
          .single();
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true, settings: data as unknown as Record<string, unknown> });
      }

      if (action === "create-sale" && method === "POST") {
        const body = await readJsonBody(req);
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0) throw new HttpError(400, "Add at least one item to the sale.");
        const rpcItems = items.map((raw) => {
          const item = raw as Record<string, unknown>;
          const inventoryItemId = String(item.inventoryItemId ?? "");
          const quantity = Math.floor(Number(item.quantity));
          if (!inventoryItemId || !Number.isFinite(quantity) || quantity < 1) {
            throw new HttpError(400, "Each item needs a valid inventoryItemId and quantity.");
          }
          return { inventory_item_id: inventoryItemId, quantity };
        });

        const { data, error } = await admin.rpc("pos_create_sale", {
          p_items: rpcItems,
          p_customer_id: (body.customerId as string) || undefined,
          p_notes: (body.notes as string) || undefined,
        });
        if (error) {
          const msg = error.message.toLowerCase();
          const status =
            msg.includes("insufficient stock") || msg.includes("no longer available")
              ? 409
              : msg.includes("no price") || msg.includes("invalid") || msg.includes("at least one")
                ? 400
                : 500;
          throw new HttpError(status, error.message);
        }
        const sale = Array.isArray(data) ? data[0] : data;
        if (!sale) throw new HttpError(500, "Sale did not return a result.");
        return sendJson(res, 201, { ok: true, sale: sale as unknown as Record<string, unknown> });
      }

      if (action === "mark-cash-paid" && method === "POST") {
        const body = await readJsonBody(req);
        const orderId = String(body.orderId ?? "");
        if (!orderId) throw new HttpError(400, "orderId is required.");
        const order = await loadPosOrder(orderId);
        if (order.payment_status === "paid") {
          throw new HttpError(409, "This sale is already paid.");
        }
        const tenderedCents = Math.round(Number(body.tenderedCents));
        if (!Number.isFinite(tenderedCents) || tenderedCents < order.amount_due_cents) {
          throw new HttpError(400, "Cash tendered must cover the amount due.");
        }
        const changeCents = tenderedCents - order.amount_due_cents;
        const reference = `Cash — tendered $${(tenderedCents / 100).toFixed(2)}, change $${(changeCents / 100).toFixed(2)}`;
        const { error } = await admin.rpc("mark_order_paid", {
          p_order_id: orderId,
          p_provider: "manual",
          p_reference: reference,
        });
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true, changeCents });
      }

      if (action === "void-sale" && method === "POST") {
        const body = await readJsonBody(req);
        const orderId = String(body.orderId ?? "");
        if (!orderId) throw new HttpError(400, "orderId is required.");
        const order = await loadPosOrder(orderId);
        if (order.payment_status === "paid") {
          throw new HttpError(409, "A paid sale can't be voided here.");
        }
        const { error } = await admin.rpc("cancel_unpaid_order", {
          p_order_id: orderId,
          p_reason: (body.reason as string) || "Voided at register",
        });
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true });
      }

      if (action === "terminal-connection-token" && method === "POST") {
        const stripe = getStripe();
        const token = await stripe.terminal.connectionTokens.create();
        return sendJson(res, 200, { ok: true, secret: token.secret });
      }

      if (action === "terminal-create-intent" && method === "POST") {
        const body = await readJsonBody(req);
        const orderId = String(body.orderId ?? "");
        if (!orderId) throw new HttpError(400, "orderId is required.");
        const order = await loadPosOrder(orderId);
        if (order.payment_status === "paid") {
          throw new HttpError(409, "This sale is already paid.");
        }
        if (order.amount_due_cents <= 0) {
          throw new HttpError(400, "This sale has nothing due.");
        }
        const stripe = getStripe();
        try {
          const intent = await stripe.paymentIntents.create(
            {
              amount: order.amount_due_cents,
              currency: "usd",
              payment_method_types: ["card_present"],
              capture_method: "automatic",
              metadata: { order_id: orderId, channel: "pos" },
            },
            { idempotencyKey: `pos_pi_${orderId}` },
          );
          return sendJson(res, 200, {
            ok: true,
            clientSecret: intent.client_secret,
            paymentIntentId: intent.id,
          });
        } catch (err) {
          console.error("[pos] terminal paymentIntents.create failed", err);
          throw new HttpError(502, "Could not start a card payment. Please try again.");
        }
      }

      if (action === "terminal-locations" && method === "GET") {
        const stripe = getStripe();
        const locations = await stripe.terminal.locations.list({ limit: 20 });
        return sendJson(res, 200, { ok: true, locations: locations.data });
      }

      if (action === "terminal-create-location" && method === "POST") {
        const body = await readJsonBody(req);
        const displayName = String(body.displayName ?? "").trim();
        const line1 = String(body.line1 ?? "").trim();
        const city = String(body.city ?? "").trim();
        const state = String(body.state ?? "").trim();
        const postalCode = String(body.postalCode ?? "").trim();
        const country = String(body.country ?? "US").trim();
        if (!displayName || !line1 || !city || !state || !postalCode) {
          throw new HttpError(400, "displayName, line1, city, state, and postalCode are required.");
        }
        const stripe = getStripe();
        const location = await stripe.terminal.locations.create({
          display_name: displayName,
          address: {
            line1,
            line2: (body.line2 as string) || undefined,
            city,
            state,
            postal_code: postalCode,
            country,
          },
        });
        return sendJson(res, 201, { ok: true, location });
      }

      if (action === "terminal-readers" && method === "GET") {
        const stripe = getStripe();
        const locationId = q(req, "locationId");
        const readers = await stripe.terminal.readers.list({
          location: locationId || undefined,
          limit: 20,
        });
        return sendJson(res, 200, { ok: true, readers: readers.data });
      }
    }

    // ─────────────────────────── pickup requests ───────────────────────────
    // Kiosk-submitted pickup requests (see api/kiosk/submit.ts for how a
    // customer creates one, with no login). Staff work the queue here: pull
    // items, mark ready, cancel (releases the hold), or complete the sale
    // (converts it into a real payable order via pos_complete_pickup_sale,
    // then the client collects payment through the normal Register flow).
    if (resource === "pickup") {
      if (action === "list" && method === "GET") {
        const { data: requests, error } = await admin
          .from("pickup_requests")
          .select("*")
          .in("status", ["waiting", "ready"])
          .order("created_at", { ascending: true });
        if (error) throw new HttpError(500, error.message);

        const ids = (requests ?? []).map((r) => r.id);
        let itemsByRequest = new Map<string, unknown[]>();
        // Where each card is kept and what it sells for now: the website
        // price, a storewide sale included (yard sale lists are charged that,
        // less the sale's discount).
        const inventoryById = new Map<string, { storage_location: string | null; status: string }>();
        let livePrices = new Map<string, number>();
        if (ids.length > 0) {
          const { data: items, error: itemsErr } = await admin
            .from("pickup_request_items")
            .select("*")
            .in("pickup_request_id", ids)
            .order("created_at", { ascending: true });
          if (itemsErr) throw new HttpError(500, itemsErr.message);
          const inventoryIds = [
            ...new Set((items ?? []).map((i) => i.inventory_item_id).filter((v): v is string => !!v)),
          ];
          if (inventoryIds.length > 0) {
            const [invRes, prices] = await Promise.all([
              admin.from("inventory_items").select("id, storage_location, status").in("id", inventoryIds),
              loadLivePrices(inventoryIds),
            ]);
            if (invRes.error) throw new HttpError(500, invRes.error.message);
            for (const row of invRes.data ?? []) inventoryById.set(row.id, row);
            livePrices = prices;
          }
          itemsByRequest = new Map();
          for (const item of items ?? []) {
            const inv = item.inventory_item_id ? inventoryById.get(item.inventory_item_id) : undefined;
            const livePrice = item.inventory_item_id ? livePrices.get(item.inventory_item_id) : undefined;
            const list = itemsByRequest.get(item.pickup_request_id) ?? [];
            list.push({
              ...item,
              storage_location: inv?.storage_location ?? null,
              current_price_cents: livePrice ?? null,
              available: !!inv && inv.status !== "archived" && livePrice != null,
            });
            itemsByRequest.set(item.pickup_request_id, list);
          }
        }
        const rows = (requests ?? []).map((r) => ({
          ...r,
          items: itemsByRequest.get(r.id) ?? [],
        }));

        // The yard sales these lists belong to, and the latest one (on or not).
        const saleColumns = "id, started_at, ends_at, ended_at, discount_percent, min_price_cents";
        const saleIds = [...new Set(rows.map((r) => r.yard_sale_id).filter((v): v is string => !!v))];
        const [latestRes, listedRes, posRes] = await Promise.all([
          admin.from("yard_sales").select(saleColumns).order("started_at", { ascending: false }).limit(1),
          saleIds.length > 0
            ? admin.from("yard_sales").select(saleColumns).in("id", saleIds)
            : Promise.resolve({ data: [], error: null }),
          admin.from("pos_settings").select("sales_tax_bps").order("id").limit(1).maybeSingle(),
        ]);
        if (latestRes.error || listedRes.error) {
          throw new HttpError(500, (latestRes.error ?? listedRes.error)?.message ?? "Could not load yard sales.");
        }
        const yardSales = new Map<string, Record<string, unknown>>();
        for (const sale of [...(latestRes.data ?? []), ...(listedRes.data ?? [])]) {
          yardSales.set(sale.id, {
            ...sale,
            active: sale.ended_at === null && Date.parse(sale.ends_at) > Date.now(),
          });
        }
        return sendJson(res, 200, {
          ok: true,
          rows,
          yardSales: [...yardSales.values()],
          taxBps: Number(posRes.data?.sales_tax_bps ?? 0) || 0,
        });
      }

      if (action === "toggle-item" && method === "POST") {
        const body = await readJsonBody(req);
        const itemId = String(body.itemId ?? "");
        if (!itemId) throw new HttpError(400, "itemId is required.");
        const { data: item, error: readErr } = await admin
          .from("pickup_request_items")
          .select("id, pulled")
          .eq("id", itemId)
          .maybeSingle();
        if (readErr) throw new HttpError(500, readErr.message);
        if (!item) throw new HttpError(404, "Pickup item not found.");
        const { error } = await admin
          .from("pickup_request_items")
          .update({ pulled: !item.pulled })
          .eq("id", itemId);
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true });
      }

      if (action === "mark-ready" && method === "POST") {
        const body = await readJsonBody(req);
        const requestId = String(body.requestId ?? "");
        if (!requestId) throw new HttpError(400, "requestId is required.");
        const { error } = await admin
          .from("pickup_requests")
          .update({ status: "ready", ready_at: new Date().toISOString() })
          .eq("id", requestId)
          .eq("status", "waiting");
        if (error) throw new HttpError(500, error.message);
        // Email failure must not fail marking it ready — the request is
        // already updated in the DB either way. Silently no-ops when the
        // customer didn't leave an email (only phone is required at kiosk).
        try {
          await sendPickupReadyEmail(requestId);
        } catch (mailErr) {
          console.error("[admin/pickup/mark-ready] pickup-ready email failed", mailErr);
        }
        return sendJson(res, 200, { ok: true });
      }

      if (action === "cancel" && method === "POST") {
        const body = await readJsonBody(req);
        const requestId = String(body.requestId ?? "");
        if (!requestId) throw new HttpError(400, "requestId is required.");
        const { error } = await admin.rpc("pos_cancel_pickup_request", {
          p_pickup_request_id: requestId,
          p_reason: (body.reason as string) || "Cancelled at register",
        });
        if (error) throw new HttpError(500, error.message);
        await logAdminAction(admin, staff, {
          action: "pickup.cancelled",
          resourceType: "pickup_request",
          resourceId: requestId,
        });
        return sendJson(res, 200, { ok: true });
      }

      // Take a card (or some of its copies) off an open list; it goes back
      // on the website. A list left empty is closed.
      if (action === "remove-item" && method === "POST") {
        const body = await readJsonBody(req);
        const itemId = String(body.itemId ?? "").toLowerCase();
        if (!UUID_RE.test(itemId)) throw new HttpError(400, "itemId is required.");
        const rawQuantity = body.quantity;
        const quantity = rawQuantity === undefined || rawQuantity === null ? null : Number(rawQuantity);
        if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1)) {
          throw new HttpError(400, "quantity must be a whole number.");
        }
        const { data, error } = await admin.rpc("pickup_remove_item", {
          p_item_id: itemId,
          p_quantity: quantity ?? undefined,
        });
        if (error) throw yardSaleDbError(error, "Could not take that card off the list.");
        const result = (data ?? {}) as {
          request_id?: string;
          card_name?: string;
          removed?: number;
          items_left?: number;
          cancelled?: boolean;
        };
        await logAdminAction(admin, staff, {
          action: "pickup.item_removed",
          resourceType: "pickup_request",
          resourceId: String(result.request_id ?? ""),
          after: {
            item_id: itemId,
            card_name: result.card_name ?? null,
            removed: result.removed ?? null,
            items_left: result.items_left ?? null,
            list_closed: result.cancelled ?? false,
          },
        });
        return sendJson(res, 200, {
          ok: true,
          result: {
            cardName: result.card_name ?? "",
            removed: Number(result.removed ?? 0),
            itemsLeft: Number(result.items_left ?? 0),
            listClosed: Boolean(result.cancelled),
          },
        });
      }

      // A yard sale list paid in person (cash or Venmo): the cards are sold
      // and off the website, the sale is recorded. No payment service.
      if (action === "complete-yard-sale" && method === "POST") {
        const body = await readJsonBody(req);
        const requestId = String(body.requestId ?? "").toLowerCase();
        if (!UUID_RE.test(requestId)) throw new HttpError(400, "requestId is required.");
        const paymentMethod = body.paymentMethod;
        if (paymentMethod !== "cash" && paymentMethod !== "venmo") {
          throw new HttpError(400, "Choose how they paid: cash or Venmo.");
        }
        const { data, error } = await admin.rpc("yard_sale_complete_list", {
          p_request_id: requestId,
          p_payment_method: paymentMethod,
        });
        if (error) throw yardSaleDbError(error, "Could not complete this list.");
        const row = (Array.isArray(data) ? data[0] : data) as {
          order_id?: string;
          subtotal_cents?: number;
          discount_cents?: number;
          tax_cents?: number;
          total_cents?: number;
        } | null;
        if (!row?.order_id) throw new HttpError(500, "Completing the list didn't return a sale.");
        await logAdminAction(admin, staff, {
          action: "yard_sale.list_completed",
          resourceType: "pickup_request",
          resourceId: requestId,
          after: {
            order_id: row.order_id,
            payment_method: paymentMethod,
            subtotal_cents: row.subtotal_cents ?? null,
            discount_cents: row.discount_cents ?? null,
            tax_cents: row.tax_cents ?? null,
            total_cents: row.total_cents ?? null,
          },
        });
        return sendJson(res, 200, {
          ok: true,
          sale: {
            orderId: row.order_id,
            subtotalCents: Number(row.subtotal_cents ?? 0),
            discountCents: Number(row.discount_cents ?? 0),
            taxCents: Number(row.tax_cents ?? 0),
            totalCents: Number(row.total_cents ?? 0),
          },
        });
      }

      if (action === "complete-sale" && method === "POST") {
        const body = await readJsonBody(req);
        const requestId = String(body.requestId ?? "");
        if (!requestId) throw new HttpError(400, "requestId is required.");
        // Yard sale lists are paid outside the register and completed with
        // their discount (complete-yard-sale), never rung up here.
        const { data: listRow, error: listErr } = await admin
          .from("pickup_requests")
          .select("yard_sale_id")
          .eq("id", requestId)
          .maybeSingle();
        if (listErr) throw new HttpError(500, listErr.message);
        if (listRow?.yard_sale_id) {
          throw new HttpError(409, "This is a yard sale list. Use Complete instead.");
        }
        const { data, error } = await admin.rpc("pos_complete_pickup_sale", {
          p_pickup_request_id: requestId,
          p_customer_id: (body.customerId as string) || undefined,
        });
        if (error) {
          const msg = error.message.toLowerCase();
          const status =
            msg.includes("insufficient") || msg.includes("no longer available") || msg.includes("missing or was released")
              ? 409
              : msg.includes("not found") || msg.includes("cancelled") || msg.includes("already completed")
                ? 400
                : 500;
          throw new HttpError(status, error.message);
        }
        const sale = Array.isArray(data) ? data[0] : data;
        if (!sale) throw new HttpError(500, "Sale did not return a result.");
        return sendJson(res, 200, { ok: true, sale: sale as unknown as Record<string, unknown> });
      }
    }

    // ───────────────────────────── orders ─────────────────────────────
    // Reads (list/get) go straight from the browser via RLS (orders/order_items
    // select policies already allow `user_id = auth.uid() OR is_staff()`), so
    // only the WRITES that RLS doesn't grant staff live here, service-role.
    if (resource === "orders") {
      const SETTABLE_STATUSES = new Set(["packing", "ready_to_ship", "cancelled"]);

      // Whether postage labels can be bought and deliveries tracked yet, so
      // the Orders page can say so before anyone clicks "Buy & print label".
      if (action === "shipping-setup" && method === "GET") {
        return sendJson(res, 200, { ok: true, easypostConnected: isEasyPostConnected() });
      }

      if (action === "set-status" && method === "POST") {
        const body = await readJsonBody(req);
        const orderId = String(body.orderId ?? "");
        const status = String(body.status ?? "");
        if (!orderId) throw new HttpError(400, "orderId is required.");
        if (!SETTABLE_STATUSES.has(status)) {
          throw new HttpError(
            400,
            "status must be one of: packing, ready_to_ship, cancelled. Use the ship action to mark an order shipped.",
          );
        }
        const nextStatus = status as "packing" | "ready_to_ship" | "cancelled";
        const { data: existing, error: readErr } = await admin
          .from("orders")
          .select("id, status, packed_at, ready_at, cancelled_at, channel, shipping_method")
          .eq("id", orderId)
          .maybeSingle();
        if (readErr) throw new HttpError(500, readErr.message);
        if (!existing) throw new HttpError(404, "Order not found.");

        const now = new Date().toISOString();
        // Only stamp the timestamp the first time an order reaches this status.
        if (nextStatus === "packing") {
          const { error } = await admin
            .from("orders")
            .update({ status: nextStatus, packed_at: existing.packed_at ?? now })
            .eq("id", orderId);
          if (error) throw new HttpError(500, error.message);
        } else if (nextStatus === "ready_to_ship") {
          const { error } = await admin
            .from("orders")
            .update({ status: nextStatus, ready_at: existing.ready_at ?? now })
            .eq("id", orderId);
          if (error) throw new HttpError(500, error.message);
          // "Your order is packed" — only for orders that ship. Idempotent
          // per order, so marking it ready a second time never re-sends, and
          // an email failure never undoes the status change.
          if (existing.channel === "online" && existing.shipping_method) {
            try {
              await sendOrderStatusEmail(orderId, "packed");
            } catch (mailErr) {
              console.error("[admin/orders/set-status] packed email failed", mailErr);
            }
          }
        } else {
          const { error } = await admin
            .from("orders")
            .update({ status: nextStatus, cancelled_at: existing.cancelled_at ?? now })
            .eq("id", orderId);
          if (error) throw new HttpError(500, error.message);
          // Email failure must not fail the status change — the order is
          // already cancelled in the DB either way.
          try {
            await sendOrderStatusEmail(orderId, "cancelled");
          } catch (mailErr) {
            console.error("[admin/orders/set-status] cancellation email failed", mailErr);
          }
        }
        await logAdminAction(admin, staff, {
          action: `order.${nextStatus}`,
          resourceType: "order",
          resourceId: orderId,
          before: { status: existing.status },
          after: { status: nextStatus },
        });
        return sendJson(res, 200, { ok: true });
      }

      if (action === "ship" && method === "POST") {
        const body = await readJsonBody(req);
        const orderId = String(body.orderId ?? "");
        if (!orderId) throw new HttpError(400, "orderId is required.");

        const { data: order, error: readErr } = await admin
          .from("orders")
          .select("id, status, shipping_method")
          .eq("id", orderId)
          .maybeSingle();
        if (readErr) throw new HttpError(500, readErr.message);
        if (!order) throw new HttpError(404, "Order not found.");
        if (order.status !== "ready_to_ship") {
          throw new HttpError(
            409,
            "This order must be ready to ship before it can be marked shipped.",
          );
        }

        const isPwe = order.shipping_method === "pwe";
        let carrier: string | null = null;
        let trackingNumber: string | null = null;
        if (isPwe) {
          // PWE is intentionally untracked — never persist tracking data for
          // it, even if the caller (a stale client) sent some.
          carrier = null;
          trackingNumber = null;
        } else {
          carrier = String(body.carrier ?? "").trim() || null;
          trackingNumber = String(body.trackingNumber ?? "").trim() || null;
          if (!carrier || !trackingNumber) {
            throw new HttpError(
              400,
              "A carrier and tracking number are required for tracked shipping.",
            );
          }
        }

        const { error: updErr } = await admin
          .from("orders")
          .update({
            status: "shipped",
            shipped_at: new Date().toISOString(),
            tracking_carrier: carrier,
            tracking_number: trackingNumber,
            // A hand-typed number gets its EasyPost tracker from the hourly
            // shipping-updates worker (api/_lib/shippingUpdates.ts).
            easypost_tracker_id: null,
            tracking_status: null,
            tracking_checked_at: null,
          })
          .eq("id", orderId);
        if (updErr) throw new HttpError(500, updErr.message);
        // Email failure must not fail the ship action — the order is already
        // marked shipped in the DB either way.
        try {
          await sendOrderStatusEmail(orderId, "shipped");
        } catch (mailErr) {
          console.error("[admin/orders/ship] shipped email failed", mailErr);
        }
        await logAdminAction(admin, staff, {
          action: "order.shipped",
          resourceType: "order",
          resourceId: orderId,
          before: { status: order.status },
          after: { status: "shipped", carrier, trackingNumber },
        });
        return sendJson(res, 200, { ok: true });
      }

      // Buys a real, tracked postage label via EasyPost and marks the order
      // shipped with the resulting carrier/tracking — the "click print, no
      // other apps" replacement for the ship action's hand-typed carrier +
      // tracking number. PWE orders are never eligible (they're untracked by
      // design) and print a plain address label client-side instead, which
      // needs no server call at all.
      if (action === "buy-label" && method === "POST") {
        const body = await readJsonBody(req);
        const orderId = String(body.orderId ?? "");
        if (!orderId) throw new HttpError(400, "orderId is required.");

        const { data: order, error: readErr } = await admin
          .from("orders")
          .select(
            "id, status, shipping_method, ship_recipient, ship_line1, ship_line2, ship_city, ship_state, ship_postal_code, ship_country",
          )
          .eq("id", orderId)
          .maybeSingle();
        if (readErr) throw new HttpError(500, readErr.message);
        if (!order) throw new HttpError(404, "Order not found.");
        if (order.status !== "ready_to_ship") {
          throw new HttpError(409, "This order must be ready to ship before a label can be purchased.");
        }
        if (order.shipping_method !== "tracked") {
          throw new HttpError(
            400,
            "Only tracked orders can have a postage label purchased — Plain White Envelope orders print a plain address label instead.",
          );
        }

        let purchased;
        try {
          purchased = await buyShippingLabel({
            name: order.ship_recipient ?? "",
            street1: order.ship_line1 ?? "",
            street2: order.ship_line2,
            city: order.ship_city ?? "",
            state: order.ship_state ?? "",
            zip: order.ship_postal_code ?? "",
            country: order.ship_country,
          });
        } catch (err) {
          throw new HttpError(502, err instanceof Error ? err.message : "Could not purchase a shipping label.");
        }

        const { error: updErr } = await admin
          .from("orders")
          .update({
            status: "shipped",
            shipped_at: new Date().toISOString(),
            tracking_carrier: purchased.carrier,
            tracking_number: purchased.trackingCode,
            label_url: purchased.labelUrl,
            postage_cost_cents: purchased.rateCents,
            easypost_shipment_id: purchased.shipmentId,
            easypost_tracker_id: purchased.trackerId,
            tracking_status: "pre_transit",
            tracking_checked_at: null,
            shipping_service: purchased.service,
            package_weight_oz: purchased.weightOz,
          })
          .eq("id", orderId);
        if (updErr) throw new HttpError(500, updErr.message);

        // Email failure must not fail the label purchase — postage is already
        // bought and the order is already marked shipped either way.
        try {
          await sendOrderStatusEmail(orderId, "shipped");
        } catch (mailErr) {
          console.error("[admin/orders/buy-label] shipped email failed", mailErr);
        }

        return sendJson(res, 200, {
          ok: true,
          labelUrl: purchased.labelUrl,
          trackingCarrier: purchased.carrier,
          trackingNumber: purchased.trackingCode,
          postageCostCents: purchased.rateCents,
        });
      }

      if (action === "add-note" && method === "POST") {
        const body = await readJsonBody(req);
        const orderId = String(body.orderId ?? "");
        if (!orderId) throw new HttpError(400, "orderId is required.");
        const note = String(body.note ?? "").trim();

        const { error } = await admin
          .from("orders")
          .update({ internal_notes: note || null })
          .eq("id", orderId);
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true });
      }

      if (action === "toggle-packed" && method === "POST") {
        const body = await readJsonBody(req);
        const orderId = String(body.orderId ?? "");
        const itemId = String(body.itemId ?? "");
        if (!orderId || !itemId) {
          throw new HttpError(400, "orderId and itemId are required.");
        }
        const { data: item, error: readErr } = await admin
          .from("order_items")
          .select("id, packed")
          .eq("id", itemId)
          .eq("order_id", orderId)
          .maybeSingle();
        if (readErr) throw new HttpError(500, readErr.message);
        if (!item) throw new HttpError(404, "Order item not found.");

        const { error: updErr } = await admin
          .from("order_items")
          .update({ packed: !item.packed })
          .eq("id", itemId);
        if (updErr) throw new HttpError(500, updErr.message);
        return sendJson(res, 200, { ok: true });
      }
    }

    // ───────────────────────────── campaigns ─────────────────────────────
    if (resource === "campaigns") {
      if (action === "audience-count" && method === "GET") {
        const audience = q(req, "audience") as Audience;
        if (!AUDIENCES.has(audience)) {
          throw new HttpError(400, "A valid audience is required.");
        }
        const { data, error } = await admin.rpc("campaign_audience_count", {
          p_audience: audience,
        });
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true, count: Number(data ?? 0) });
      }

      if (action === "list" && method === "GET") {
        const { data, error } = await admin
          .from("campaigns")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, {
          ok: true,
          rows: (data ?? []) as unknown as CampaignRow[],
        });
      }

      if (action === "save" && method === "POST") {
        const body = await readJsonBody(req);
        const name = String(body.name ?? "").trim();
        const subject = String(body.subject ?? "").trim();
        if (!name) throw new HttpError(400, "An internal campaign name is required.");
        if (!subject) throw new HttpError(400, "A subject line is required.");

        const audience = ((body.audience as string) ??
          "active_subscribers") as Audience;
        if (!AUDIENCES.has(audience)) throw new HttpError(400, "Invalid audience.");

        const { data: countData, error: countErr } = await admin.rpc(
          "campaign_audience_count",
          { p_audience: audience },
        );
        if (countErr) throw new HttpError(500, countErr.message);
        const recipientCount = Number(countData ?? 0);

        const fields = {
          name,
          subject,
          preview_text: String(body.previewText ?? "").trim(),
          body: String(body.body ?? "").trim(),
          button_text: (body.buttonText as string)?.trim() || null,
          button_url: (body.buttonUrl as string)?.trim() || null,
          audience,
          recipient_count: recipientCount,
          scheduled_at: (body.scheduledAt as string) ?? null,
        };

        if (body.id) {
          const { data: existing, error: exErr } = await admin
            .from("campaigns")
            .select("status")
            .eq("id", body.id as string)
            .maybeSingle();
          if (exErr) throw new HttpError(500, exErr.message);
          if (!existing) throw new HttpError(404, "Campaign not found.");
          if (existing.status !== "draft") {
            throw new HttpError(409, "Only draft campaigns can be edited.");
          }
          const { data, error } = await admin
            .from("campaigns")
            .update(fields)
            .eq("id", body.id as string)
            .select("*")
            .single();
          if (error) throw new HttpError(500, error.message);
          return sendJson(res, 200, {
            ok: true,
            campaign: data as unknown as CampaignRow,
          });
        }

        const { data, error } = await admin
          .from("campaigns")
          .insert({
            ...fields,
            status: "draft",
            created_by: staff.email || staff.userId,
          })
          .select("*")
          .single();
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 201, {
          ok: true,
          campaign: data as unknown as CampaignRow,
        });
      }
    }

    // ─────────────────────────────── staff ───────────────────────────────
    if (resource === "staff") {
      if (action === "list" && method === "GET") {
        const { data, error } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: STAFF_PAGE_SIZE,
        });
        if (error) throw new HttpError(500, error.message);
        const rows = (data?.users ?? []).filter(isStaffUser).map(mapAuthUserToStaff);
        return sendJson(res, 200, { ok: true, rows });
      }

      if (action === "invite" && method === "POST") {
        if (staff.role !== "admin") {
          throw new HttpError(403, "Only an admin/owner can invite staff.");
        }
        const body = await readJsonBody(req);
        const email = normalizeEmail(body.email as string | undefined);
        if (!email) throw new HttpError(400, "A valid email address is required.");
        const staffRole = ((body.role as string) ?? "fulfillment") as StaffRole;
        if (!STAFF_ROLES.includes(staffRole)) {
          throw new HttpError(400, "Invalid staff role.");
        }
        if (staffRole === "owner") {
          throw new HttpError(400, "Invite as another role, then promote to owner.");
        }
        const first = String(body.firstName ?? "").trim();
        const last = String(body.lastName ?? "").trim();

        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { first_name: first, last_name: last },
        });
        if (error) throw new HttpError(500, error.message);
        const user = data?.user;
        if (!user) throw new HttpError(500, "Invite did not return a user.");

        const { error: metaErr } = await admin.auth.admin.updateUserById(user.id, {
          app_metadata: { role: "staff", staff_role: staffRole },
        });
        if (metaErr) throw new HttpError(500, metaErr.message);

        const refreshed = await admin.auth.admin.getUserById(user.id);
        const staffMember = refreshed.data?.user
          ? mapAuthUserToStaff(refreshed.data.user)
          : mapAuthUserToStaff(user);
        return sendJson(res, 201, { ok: true, staff: staffMember });
      }

      if (action === "update" && method === "PATCH") {
        if (staff.role !== "admin") {
          throw new HttpError(403, "Only an admin/owner can manage staff.");
        }
        const id = q(req, "id");
        if (!id) throw new HttpError(400, "Staff id is required.");
        const body = await readJsonBody(req);

        const target = await admin.auth.admin.getUserById(id);
        if (target.error || !target.data?.user) {
          throw new HttpError(404, "Staff member not found.");
        }
        const user = target.data.user;
        if (!isStaffUser(user)) {
          throw new HttpError(400, "That user is not a staff member.");
        }

        const currentRole = staffRoleOf(user);
        const isSelf = user.id === staff.userId;

        const activeOwnerCount = async (): Promise<number> => {
          const { data } = await admin.auth.admin.listUsers({
            page: 1,
            perPage: STAFF_PAGE_SIZE,
          });
          return (data?.users ?? []).filter((u) => {
            if (!isStaffUser(u)) return false;
            if (staffRoleOf(u) !== "owner") return false;
            const bannedUntil = (u as { banned_until?: string | null })
              .banned_until;
            const disabled =
              !!bannedUntil && new Date(bannedUntil).getTime() > Date.now();
            return !disabled;
          }).length;
        };

        if (body.role !== undefined) {
          const nextRole = body.role as StaffRole;
          if (!STAFF_ROLES.includes(nextRole)) {
            throw new HttpError(400, "Invalid staff role.");
          }
          if (currentRole === "owner" && nextRole !== "owner") {
            if (isSelf) {
              throw new HttpError(
                400,
                "You can't remove your own owner role — ask another owner.",
              );
            }
            if ((await activeOwnerCount()) <= 1) {
              throw new HttpError(
                400,
                "The store must always have at least one active owner.",
              );
            }
          }
          const { error } = await admin.auth.admin.updateUserById(id, {
            app_metadata: { role: appRoleFor(nextRole), staff_role: nextRole },
          });
          if (error) throw new HttpError(500, error.message);
        }

        if (body.status !== undefined) {
          if (body.status !== "active" && body.status !== "disabled") {
            throw new HttpError(400, "status must be 'active' or 'disabled'.");
          }
          if (body.status === "disabled") {
            if (isSelf) throw new HttpError(400, "You can't disable your own account.");
            if (currentRole === "owner" && (await activeOwnerCount()) <= 1) {
              throw new HttpError(
                400,
                "The store must always have at least one active owner.",
              );
            }
          }
          const { error } = await admin.auth.admin.updateUserById(id, {
            ban_duration: body.status === "disabled" ? BAN_DURATION : "none",
          });
          if (error) throw new HttpError(500, error.message);
        }

        const refreshed = await admin.auth.admin.getUserById(id);
        const staffMember = refreshed.data?.user
          ? mapAuthUserToStaff(refreshed.data.user)
          : mapAuthUserToStaff(user);
        return sendJson(res, 200, { ok: true, staff: staffMember });
      }
    }

    // No branch matched.
    if (method !== "GET" && method !== "POST" && method !== "PATCH") {
      return methodNotAllowed(res, ["GET", "POST", "PATCH"]);
    }
    throw new HttpError(
      404,
      `Unknown admin route: resource='${resource}' action='${action}' (${method}).`,
    );
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}