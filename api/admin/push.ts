import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { requireStaff } from "../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { ServerEnv } from "../_lib/env.js";
import { isAllowedPushEndpoint, pushConfigured, pushPayload, sendToSubscription } from "../_lib/staffPush.js";
import { ALL_STAFF_PUSH_KINDS, isStaffPushKind, type StaffPushKind } from "../../src/admin/utils/pushKinds.js";

// Staff-only push notification settings for this device (admin app).
//
//   GET  /api/admin/push   → { configured, publicKey }
//   POST /api/admin/push   { action, ... }
//     status       { endpoint }                 → { subscribed, kinds }
//     subscribe    { subscription, kinds? }     → saves this device (keeps its
//                                                 kinds if already saved)
//     update       { endpoint, kinds }          → which events this device gets
//     unsubscribe  { endpoint }                 → forgets this device
//     test         { endpoint }                 → sends a test notification
//
// A device is identified by its push endpoint, which only that browser knows.

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface Body {
  action?: unknown;
  endpoint?: unknown;
  subscription?: unknown;
  kinds?: unknown;
}

function parseEndpoint(value: unknown): string {
  if (typeof value !== "string" || value.length > 1000 || !isAllowedPushEndpoint(value)) {
    throw new HttpError(400, "Invalid push endpoint.");
  }
  return value;
}

function parseSubscription(value: unknown): SubscriptionInput {
  const sub = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = parseEndpoint(sub?.endpoint);
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (
    typeof p256dh !== "string" ||
    typeof auth !== "string" ||
    !BASE64URL.test(p256dh) ||
    !BASE64URL.test(auth) ||
    p256dh.length < 20 ||
    p256dh.length > 200 ||
    auth.length < 8 ||
    auth.length > 100
  ) {
    throw new HttpError(400, "Invalid push subscription keys.");
  }
  return { endpoint, keys: { p256dh, auth } };
}

function parseKinds(value: unknown): StaffPushKind[] {
  if (!Array.isArray(value) || value.length > ALL_STAFF_PUSH_KINDS.length || !value.every(isStaffPushKind)) {
    throw new HttpError(400, "Invalid notification types.");
  }
  return [...new Set(value)];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"]);
  try {
    const staff = await requireStaff(req);

    if (req.method === "GET") {
      const configured = pushConfigured();
      return sendJson(res, 200, {
        ok: true,
        configured,
        publicKey: configured ? ServerEnv.vapidPublicKey() : null,
      });
    }

    const body = (await readJsonBody(req, 8 * 1024)) as Body;
    const admin = getSupabaseAdmin();

    switch (body.action) {
      case "status": {
        const endpoint = parseEndpoint(body.endpoint);
        const { data, error } = await admin
          .from("staff_push_subscriptions")
          .select("kinds")
          .eq("endpoint", endpoint)
          .maybeSingle();
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true, subscribed: Boolean(data), kinds: data?.kinds ?? [] });
      }

      case "subscribe": {
        if (!pushConfigured()) throw new HttpError(503, "Push notifications aren't set up on the server yet.");
        const sub = parseSubscription(body.subscription);
        const kinds = body.kinds === undefined ? undefined : parseKinds(body.kinds);
        const userAgent = String(req.headers["user-agent"] ?? "").slice(0, 300) || null;
        const now = new Date().toISOString();

        const { data: existing, error: findErr } = await admin
          .from("staff_push_subscriptions")
          .select("id, kinds")
          .eq("endpoint", sub.endpoint)
          .maybeSingle();
        if (findErr) throw new HttpError(500, findErr.message);

        if (existing) {
          // Same device again (e.g. the app re-syncing on open, or another
          // staff member signing in on it): refresh keys and owner.
          const { error } = await admin
            .from("staff_push_subscriptions")
            .update({
              user_id: staff.userId,
              p256dh: sub.keys.p256dh,
              auth: sub.keys.auth,
              user_agent: userAgent,
              updated_at: now,
              ...(kinds ? { kinds } : {}),
            })
            .eq("id", existing.id);
          if (error) throw new HttpError(500, error.message);
          return sendJson(res, 200, { ok: true, subscribed: true, kinds: kinds ?? existing.kinds });
        }

        const { error } = await admin.from("staff_push_subscriptions").insert({
          user_id: staff.userId,
          endpoint: sub.endpoint,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
          user_agent: userAgent,
          kinds: kinds ?? ALL_STAFF_PUSH_KINDS,
        });
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true, subscribed: true, kinds: kinds ?? ALL_STAFF_PUSH_KINDS });
      }

      case "update": {
        const endpoint = parseEndpoint(body.endpoint);
        const kinds = parseKinds(body.kinds);
        const { data, error } = await admin
          .from("staff_push_subscriptions")
          .update({ kinds, updated_at: new Date().toISOString() })
          .eq("endpoint", endpoint)
          .select("kinds")
          .maybeSingle();
        if (error) throw new HttpError(500, error.message);
        if (!data) throw new HttpError(404, "Notifications aren't on for this device.");
        return sendJson(res, 200, { ok: true, subscribed: true, kinds: data.kinds });
      }

      case "unsubscribe": {
        const endpoint = parseEndpoint(body.endpoint);
        const { error } = await admin.from("staff_push_subscriptions").delete().eq("endpoint", endpoint);
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true, subscribed: false, kinds: [] });
      }

      case "test": {
        if (!pushConfigured()) throw new HttpError(503, "Push notifications aren't set up on the server yet.");
        const endpoint = parseEndpoint(body.endpoint);
        const { data: sub, error } = await admin
          .from("staff_push_subscriptions")
          .select("id, endpoint, p256dh, auth")
          .eq("endpoint", endpoint)
          .maybeSingle();
        if (error) throw new HttpError(500, error.message);
        if (!sub) throw new HttpError(404, "Notifications aren't on for this device.");

        const outcome = await sendToSubscription(
          sub,
          pushPayload({
            title: "Notifications are on",
            body: "This is how Geega Admin will let you know about new orders and leads.",
            url: "/admin_dashboard",
            tag: "test",
          }),
        );
        if (outcome === "gone") {
          await admin.from("staff_push_subscriptions").delete().eq("id", sub.id);
          throw new HttpError(410, "This device's notification subscription expired. Turn notifications on again.");
        }
        if (outcome === "failed") throw new HttpError(502, "The push service didn't accept the test. Try again in a minute.");
        return sendJson(res, 200, { ok: true });
      }

      default:
        throw new HttpError(400, "Unknown action.");
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
