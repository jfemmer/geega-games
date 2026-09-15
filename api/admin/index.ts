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
//   resource=orders       action=add-note      POST
//   resource=orders       action=toggle-packed POST
//   resource=campaigns   action=list           GET
//   resource=campaigns   action=save           POST
//   resource=campaigns   action=audience-count GET   (&audience=)
//   resource=staff       action=list           GET
//   resource=staff       action=invite         POST
//   resource=staff       action=update  &id=   PATCH
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

    // ───────────────────────────── orders ─────────────────────────────
    // Reads (list/get) go straight from the browser via RLS (orders/order_items
    // select policies already allow `user_id = auth.uid() OR is_staff()`), so
    // only the WRITES that RLS doesn't grant staff live here, service-role.
    if (resource === "orders") {
      const SETTABLE_STATUSES = new Set(["packing", "ready_to_ship", "cancelled"]);

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
          .select("id, packed_at, ready_at, cancelled_at")
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
        } else {
          const { error } = await admin
            .from("orders")
            .update({ status: nextStatus, cancelled_at: existing.cancelled_at ?? now })
            .eq("id", orderId);
          if (error) throw new HttpError(500, error.message);
        }
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
          })
          .eq("id", orderId);
        if (updErr) throw new HttpError(500, updErr.message);
        return sendJson(res, 200, { ok: true });
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