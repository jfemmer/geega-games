import webpush, { WebPushError, type PushSubscription } from "web-push";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { ServerEnv } from "./env.js";
import { hasStaffRole } from "./adminAuth.js";
import type { StaffPushKind } from "../../src/admin/utils/pushKinds.js";
import type { Database } from "../../src/types/database.js";

// Push notifications to staff devices that installed the admin app and
// turned notifications on (staff_push_subscriptions — see its migration).
//
// notifyStaff() is called next to the matching staff email (new order, new
// buying lead, offer response, partner lead, kiosk pickup). Like those
// emails it is best-effort: it never throws, and a push failure never fails
// the order, submission or webhook that triggered it. Callers await it —
// Vercel can freeze a function once the response is sent.
//
// Exactly-once: the event key goes into staff_push_log first, and only the
// caller whose insert wins sends. So the Stripe webhook and the PayPal
// capture racing over one order, or a retried webhook, push once.

type SubscriptionRow = Database["public"]["Tables"]["staff_push_subscriptions"]["Row"];

export interface StaffPushEvent {
  /** Unique per real-world event, e.g. `order:<id>`. Already-sent keys are skipped. */
  key: string;
  kind: StaffPushKind;
  title: string;
  body: string;
  /** Admin page to open on tap, e.g. /admin_dashboard/orders?order=<id>. */
  url: string;
  /** Notifications with the same tag replace each other on a device instead of stacking. */
  tag?: string;
}

export type StaffPushResult =
  | { status: "skipped"; reason: "not-configured" | "no-subscribers" | "duplicate" | "error" }
  | { status: "sent"; delivered: number; failed: number; removed: number };

/** Push services the browsers actually use. Anything else is refused (no SSRF via a stored endpoint). */
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge (Android), Samsung Internet, Opera
  "android.googleapis.com",
  "updates.push.services.mozilla.com", // Firefox
  "push.apple.com", // Safari / iOS home-screen apps: web.push.apple.com
  "notify.windows.com", // Edge on Windows: *.notify.windows.com
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function pushConfigured(): boolean {
  return Boolean(ServerEnv.vapidPublicKey() && ServerEnv.vapidPrivateKey());
}

const PUSH_TTL_SECONDS = 12 * 60 * 60; // an undelivered alert older than this isn't worth showing
const SEND_TIMEOUT_MS = 8000;
const LOG_RETENTION_DAYS = 60;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** `kind` lets an open admin app play that event's own sound (src/admin/services/sounds.ts). */
export function pushPayload(
  event: Pick<StaffPushEvent, "title" | "body" | "url" | "tag"> & { kind?: StaffPushKind | "test" },
): string {
  return JSON.stringify({
    title: clip(event.title, 120),
    body: clip(event.body, 240),
    url: event.url,
    tag: event.tag,
    kind: event.kind,
    at: new Date().toISOString(),
  });
}

type SendOutcome = "delivered" | "gone" | "failed";

/** Send one payload to one device. 404/410 mean the device unsubscribed or expired. */
export async function sendToSubscription(sub: Pick<SubscriptionRow, "endpoint" | "p256dh" | "auth">, payload: string): Promise<SendOutcome> {
  if (!isAllowedPushEndpoint(sub.endpoint)) return "gone";
  const subscription: PushSubscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
  try {
    await webpush.sendNotification(subscription, payload, {
      vapidDetails: {
        subject: ServerEnv.vapidSubject(),
        publicKey: ServerEnv.vapidPublicKey(),
        privateKey: ServerEnv.vapidPrivateKey(),
      },
      TTL: PUSH_TTL_SECONDS,
      urgency: "high",
      timeout: SEND_TIMEOUT_MS,
    });
    return "delivered";
  } catch (err) {
    if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) return "gone";
    console.error(
      "[staffPush] send failed",
      err instanceof WebPushError ? `${err.statusCode} ${err.body}` : err,
    );
    return "failed";
  }
}

/**
 * Staff roles can be revoked after a device subscribed. Returns the user ids
 * that are still staff; users confirmed as not staff (or deleted) are
 * returned separately so their devices can be removed. A lookup error leaves
 * the user in neither list — skipped this time, not deleted.
 */
async function checkStaff(userIds: string[]): Promise<{ staff: Set<string>; revoked: string[] }> {
  const admin = getSupabaseAdmin();
  const staff = new Set<string>();
  const revoked: string[] = [];
  await Promise.all(
    userIds.map(async (id) => {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error && !/not found/i.test(error.message)) return;
      if (data?.user && hasStaffRole(data.user.app_metadata as Record<string, unknown> | undefined)) {
        staff.add(id);
      } else {
        revoked.push(id);
      }
    }),
  );
  return { staff, revoked };
}

export async function notifyStaff(event: StaffPushEvent): Promise<StaffPushResult> {
  try {
    if (!pushConfigured()) return { status: "skipped", reason: "not-configured" };
    const admin = getSupabaseAdmin();

    const { data: subs, error: subsErr } = await admin
      .from("staff_push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .contains("kinds", [event.kind]);
    if (subsErr) throw new Error(subsErr.message);
    if (!subs || subs.length === 0) return { status: "skipped", reason: "no-subscribers" };

    // Claim the event. Whoever inserts the key first sends; everyone else stops.
    const { error: claimErr } = await admin
      .from("staff_push_log")
      .insert({ event_key: clip(event.key, 200), kind: event.kind });
    if (claimErr) {
      if (claimErr.code === "23505") return { status: "skipped", reason: "duplicate" };
      throw new Error(claimErr.message);
    }

    const { staff, revoked } = await checkStaff([...new Set(subs.map((s) => s.user_id))]);
    const payload = pushPayload(event);
    const targets = subs.filter((s) => staff.has(s.user_id));
    const outcomes = await Promise.all(targets.map((s) => sendToSubscription(s, payload)));

    const deliveredIds = targets.filter((_, i) => outcomes[i] === "delivered").map((s) => s.id);
    const goneIds = targets.filter((_, i) => outcomes[i] === "gone").map((s) => s.id);
    const revokedIds = subs.filter((s) => revoked.includes(s.user_id)).map((s) => s.id);
    const removeIds = [...goneIds, ...revokedIds];

    const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await Promise.allSettled([
      deliveredIds.length
        ? admin.from("staff_push_subscriptions").update({ last_sent_at: new Date().toISOString() }).in("id", deliveredIds)
        : null,
      removeIds.length ? admin.from("staff_push_subscriptions").delete().in("id", removeIds) : null,
      admin.from("staff_push_log").delete().lt("created_at", cutoff),
    ]);

    return {
      status: "sent",
      delivered: deliveredIds.length,
      failed: outcomes.filter((o) => o === "failed").length,
      removed: removeIds.length,
    };
  } catch (err) {
    console.error("[staffPush] notifyStaff failed", event.key, err);
    return { status: "skipped", reason: "error" };
  }
}

/** "Jordan Vega" → "Jordan V." — enough to recognize someone on a lock screen. */
export function shortName(first: string | null | undefined, last: string | null | undefined): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (!f && !l) return "Someone";
  return l ? `${f} ${l[0]}.`.trim() : f;
}

export function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
