import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { requireStaff } from "../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { referralCategoryLabel } from "../../src/store/lib/referralTypes.js";

type NotificationKind =
  | "order"
  | "pickup"
  | "buying_lead"
  | "partner_lead"
  | "scan"
  | "inventory";

type NotificationTone = "info" | "warning" | "danger" | "success";

interface LiveNotification {
  key: string;
  kind: NotificationKind;
  tone: NotificationTone;
  title: string;
  detail: string;
  at: string;
  href: string;
  unread: boolean;
}

interface NotificationCandidate extends Omit<LiveNotification, "unread"> {}

interface StateRow {
  notification_key: string;
  read_at: string | null;
  dismissed_at: string | null;
}

interface PatchBody {
  action?: "mark_read" | "dismiss" | "mark_all_read";
  key?: string;
}

function orderNumber(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

function safeName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim() || "Customer";
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function buildCandidates(): Promise<NotificationCandidate[]> {
  const admin = getSupabaseAdmin();

  const [ordersRes, pickupsRes, leadsRes, scansRes, inventoryRes, partnerLeadsRes] = await Promise.all([
    admin
      .from("orders")
      .select("id, status, paid_at, ready_at, updated_at, created_at, email, ship_recipient")
      .in("status", ["paid", "ready_to_ship"])
      .order("updated_at", { ascending: false })
      .limit(25),
    admin
      .from("pickup_requests")
      .select("id, customer_name, status, created_at, ready_at, updated_at")
      .in("status", ["waiting", "ready"])
      .order("updated_at", { ascending: false })
      .limit(20),
    admin
      .from("sell_submissions")
      .select(
        "id, reference_number, status, priority, first_name, last_name, created_at, updated_at, total_cards, offer_value_cents, offer_response, counter_offer_cents, offer_responded_at",
      )
      // Two independent reasons a lead needs staff attention: its workflow
      // status (new/needs-photos/etc, or accepted — which a seller's own
      // "accept" response also sets, see respond-to-offer.ts), OR a
      // decline/counter response, which deliberately does NOT change status
      // (staff still decide what happens next) and so would never surface
      // here without checking offer_response too.
      .or(
        "status.in.(new,needs_more_photos,needs_in_person_review,accepted),offer_response.in.(declined,countered)",
      )
      .order("updated_at", { ascending: false })
      .limit(20),
    admin
      .from("scan_sessions")
      .select("id, label, status, failed_cards, ready_cards, total_cards, updated_at, created_at")
      .in("status", ["pending_review", "partially_failed", "failed"])
      .order("updated_at", { ascending: false })
      .limit(20),
    admin
      .from("inventory_items")
      .select("id, card_name, set_code, collector_number, quantity, updated_at")
      .eq("status", "active")
      .lte("quantity", 2)
      .order("quantity", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(12),
    // Pokémon / One Piece / video game sellers still waiting to be passed on.
    admin
      .from("referral_leads")
      .select("id, reference_number, categories, first_name, last_name, created_at")
      .eq("status", "new")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const firstError =
    ordersRes.error ??
    pickupsRes.error ??
    leadsRes.error ??
    scansRes.error ??
    inventoryRes.error ??
    partnerLeadsRes.error;
  if (firstError) {
    throw new HttpError(500, "Could not load live notification data.");
  }

  const notifications: NotificationCandidate[] = [];

  for (const order of ordersRes.data ?? []) {
    const displayName = order.ship_recipient || order.email || "Customer";
    if (order.status === "paid") {
      notifications.push({
        key: `order:paid:${order.id}`,
        kind: "order",
        tone: "warning",
        title: `${orderNumber(order.id)} needs packing`,
        detail: `${displayName} has a paid order waiting to be packed.`,
        at: order.paid_at ?? order.updated_at ?? order.created_at,
        href: `/admin_dashboard/orders?order=${order.id}`,
      });
    } else if (order.status === "ready_to_ship") {
      notifications.push({
        key: `order:ready_to_ship:${order.id}`,
        kind: "order",
        tone: "info",
        title: `${orderNumber(order.id)} is ready to ship`,
        detail: `${displayName}'s order is packed and waiting for shipment.`,
        at: order.ready_at ?? order.updated_at ?? order.created_at,
        href: `/admin_dashboard/orders?order=${order.id}`,
      });
    }
  }

  for (const pickup of pickupsRes.data ?? []) {
    const ready = pickup.status === "ready";
    notifications.push({
      key: `pickup:${pickup.status}:${pickup.id}`,
      kind: "pickup",
      tone: ready ? "success" : "warning",
      title: ready ? "Pickup ready for checkout" : "New pickup request",
      detail: ready
        ? `${pickup.customer_name}'s cards are pulled and ready for payment.`
        : `${pickup.customer_name} is waiting for cards to be pulled.`,
      at: (ready ? pickup.ready_at : null) ?? pickup.updated_at ?? pickup.created_at,
      href: "/admin_dashboard/pickup",
    });
  }

  // Statuses this loop knows how to describe. The query below also returns
  // leads matched ONLY via a decline/counter response (see the .or() filter
  // above), which can carry any other status (typically "offer_made") — those
  // fall through to the offer-response notification below instead of this
  // status-driven one, rather than being mislabeled with a "New buying lead"
  // default that no longer reflects what's actually going on.
  const KNOWN_LEAD_STATUSES = new Set(["new", "needs_more_photos", "needs_in_person_review", "accepted"]);

  for (const lead of leadsRes.data ?? []) {
    const name = safeName(lead.first_name, lead.last_name);
    const ref = lead.reference_number || "Buying lead";

    if (KNOWN_LEAD_STATUSES.has(lead.status)) {
      let title = `New buying lead · ${ref}`;
      let detail = `${name} submitted a collection${lead.total_cards ? ` with ${lead.total_cards} cards` : ""}.`;
      let tone: NotificationTone = lead.priority === "high_interest" ? "danger" : "info";

      if (lead.status === "needs_more_photos") {
        title = `Buying lead needs photos · ${ref}`;
        detail = `${name}'s submission is waiting on additional photos.`;
        tone = "warning";
      } else if (lead.status === "needs_in_person_review") {
        title = `In-person review needed · ${ref}`;
        detail = `${name}'s collection needs an in-person review.`;
        tone = "warning";
      } else if (lead.status === "accepted") {
        title = `Offer accepted · ${ref}`;
        detail = `${name} accepted the offer; finish the purchase workflow.`;
        tone = "success";
      }

      notifications.push({
        key: `buying_lead:${lead.status}:${lead.id}`,
        kind: "buying_lead",
        tone,
        title,
        detail,
        at: lead.updated_at ?? lead.created_at,
        href: `/admin_dashboard/buying-leads?submission=${lead.id}`,
      });
    }

    // Declining or countering deliberately never changes `status` (staff
    // still decide the next step — see respond-to-offer.ts), so it needs its
    // own notification entirely separate from the status-based one above;
    // otherwise it would be invisible here. Accepting isn't handled a second
    // time — it already set status to "accepted" and is covered above.
    if (lead.offer_response === "declined" && lead.offer_responded_at) {
      notifications.push({
        key: `buying_lead:offer_declined:${lead.id}`,
        kind: "buying_lead",
        tone: "warning",
        title: `Seller declined offer · ${ref}`,
        detail: `${name} declined your ${money(lead.offer_value_cents ?? 0)} offer.`,
        at: lead.offer_responded_at,
        href: `/admin_dashboard/buying-leads?submission=${lead.id}`,
      });
    } else if (lead.offer_response === "countered" && lead.offer_responded_at) {
      notifications.push({
        key: `buying_lead:offer_countered:${lead.id}`,
        kind: "buying_lead",
        tone: "warning",
        title: `Seller countered · ${ref}`,
        detail: `${name} countered your ${money(lead.offer_value_cents ?? 0)} offer with ${money(
          lead.counter_offer_cents ?? 0,
        )}.`,
        at: lead.offer_responded_at,
        href: `/admin_dashboard/buying-leads?submission=${lead.id}`,
      });
    }
  }

  for (const lead of partnerLeadsRes.data ?? []) {
    notifications.push({
      key: `partner_lead:new:${lead.id}`,
      kind: "partner_lead",
      tone: "info",
      title: `New partner lead · ${lead.reference_number}`,
      detail: `${safeName(lead.first_name, lead.last_name)} is selling ${lead.categories
        .map(referralCategoryLabel)
        .join(", ")}. Pass it on to the buying partner.`,
      at: lead.created_at,
      href: `/admin_dashboard/partner-leads?lead=${lead.id}`,
    });
  }

  for (const scan of scansRes.data ?? []) {
    if (scan.status === "pending_review") {
      notifications.push({
        key: `scan:pending_review:${scan.id}`,
        kind: "scan",
        tone: "info",
        title: `${scan.label} is ready for review`,
        detail: `${scan.ready_cards} ready · ${scan.total_cards} total cards.`,
        at: scan.updated_at ?? scan.created_at,
        href: `/admin_dashboard/scanning/${scan.id}`,
      });
    } else {
      notifications.push({
        key: `scan:${scan.status}:${scan.id}`,
        kind: "scan",
        tone: scan.status === "failed" ? "danger" : "warning",
        title:
          scan.status === "failed"
            ? `${scan.label} failed`
            : `${scan.label} has scan failures`,
        detail: `${scan.failed_cards} failed card${scan.failed_cards === 1 ? "" : "s"} need attention.`,
        at: scan.updated_at ?? scan.created_at,
        href: `/admin_dashboard/scanning/${scan.id}`,
      });
    }
  }

  for (const item of inventoryRes.data ?? []) {
    const out = item.quantity === 0;
    notifications.push({
      key: `inventory:low:${item.id}`,
      kind: "inventory",
      tone: out ? "danger" : "warning",
      title: out ? `Out of stock: ${item.card_name}` : `Low stock: ${item.card_name}`,
      detail: `${item.set_code.toUpperCase()} #${item.collector_number} · ${item.quantity} remaining.`,
      at: item.updated_at,
      href: `/admin_dashboard/inventory?search=${encodeURIComponent(item.card_name)}`,
    });
  }

  return notifications
    .sort((a, b) => {
      const toneRank: Record<NotificationTone, number> = {
        danger: 0,
        warning: 1,
        info: 2,
        success: 3,
      };
      const toneDiff = toneRank[a.tone] - toneRank[b.tone];
      if (toneDiff !== 0) return toneDiff;
      return new Date(b.at).getTime() - new Date(a.at).getTime();
    })
    .slice(0, 40);
}

async function notificationsForUser(userId: string): Promise<LiveNotification[]> {
  const admin = getSupabaseAdmin();
  const candidates = await buildCandidates();
  if (candidates.length === 0) return [];

  const { data: stateRows, error } = await admin
    .from("admin_notification_state")
    .select("notification_key, read_at, dismissed_at")
    .eq("user_id", userId)
    .in("notification_key", candidates.map((item) => item.key));
  if (error) throw new HttpError(500, "Could not load notification state.");

  const byKey = new Map<string, StateRow>(
    (stateRows ?? []).map((row) => [row.notification_key, row]),
  );

  return candidates.flatMap((item) => {
    const state = byKey.get(item.key);
    const sourceTime = new Date(item.at).getTime();
    const dismissedTime = state?.dismissed_at
      ? new Date(state.dismissed_at).getTime()
      : 0;

    // A dismissal hides the current version. If the source changes later,
    // updated_at advances and the notification is allowed to reappear.
    if (dismissedTime >= sourceTime) return [];

    const readTime = state?.read_at ? new Date(state.read_at).getTime() : 0;
    return [{ ...item, unread: readTime < sourceTime }];
  });
}

async function upsertState(
  userId: string,
  key: string,
  patch: { read_at?: string | null; dismissed_at?: string | null },
): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("admin_notification_state").upsert(
    {
      user_id: userId,
      notification_key: key,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,notification_key" },
  );
  if (error) throw new HttpError(500, "Could not update notification state.");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "PATCH") {
    return methodNotAllowed(res, ["GET", "PATCH"]);
  }

  try {
    const staff = await requireStaff(req);

    if (req.method === "GET") {
      const notifications = await notificationsForUser(staff.userId);
      return sendJson(res, 200, {
        notifications,
        unreadCount: notifications.filter((item) => item.unread).length,
        refreshedAt: new Date().toISOString(),
      });
    }

    const body = (await readJsonBody(req)) as PatchBody;
    const now = new Date().toISOString();

    if (body.action === "mark_read") {
      if (!body.key) throw new HttpError(400, "Notification key is required.");
      await upsertState(staff.userId, body.key, { read_at: now });
    } else if (body.action === "dismiss") {
      if (!body.key) throw new HttpError(400, "Notification key is required.");
      await upsertState(staff.userId, body.key, {
        read_at: now,
        dismissed_at: now,
      });
    } else if (body.action === "mark_all_read") {
      const current = await notificationsForUser(staff.userId);
      await Promise.all(
        current
          .filter((item) => item.unread)
          .map((item) => upsertState(staff.userId, item.key, { read_at: now })),
      );
    } else {
      throw new HttpError(400, "Invalid notification action.");
    }

    const notifications = await notificationsForUser(staff.userId);
    return sendJson(res, 200, {
      notifications,
      unreadCount: notifications.filter((item) => item.unread).length,
      refreshedAt: new Date().toISOString(),
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
