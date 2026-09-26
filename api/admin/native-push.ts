import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { requireStaff } from "../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { apnsConfigured, sendApns } from "../_lib/apns.js";
import { ALL_STAFF_PUSH_KINDS, isStaffPushKind, type StaffPushKind } from "../../src/admin/utils/pushKinds.js";

// Staff-only notification settings for the "Geega Admin" iPhone app (APNs).
// The web-push twin is /api/admin/push; both feed notifyStaff().
//
//   GET  /api/admin/native-push   → { configured }
//   POST /api/admin/native-push   { action, token, ... }
//     status      { token }                         → { subscribed, kinds }
//     register    { token, kinds?, deviceName? }    → saves this iPhone (keeps
//                                                     its kinds if known)
//     update      { token, kinds }                  → which events it gets
//     unregister  { token }                         → forgets it
//     test        { token }                         → sends a test notification
//
// A device is identified by its APNs token, which only that app install has.

const TOKEN = /^[0-9a-f]{32,400}$/;

interface Body {
  action?: unknown;
  token?: unknown;
  kinds?: unknown;
  deviceName?: unknown;
}

function parseToken(value: unknown): string {
  if (typeof value !== "string" || !TOKEN.test(value)) throw new HttpError(400, "Invalid device token.");
  return value;
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
    if (req.method === "GET") return sendJson(res, 200, { ok: true, configured: apnsConfigured() });

    const body = (await readJsonBody(req, 4 * 1024)) as Body;
    const admin = getSupabaseAdmin();
    const token = parseToken(body.token);

    switch (body.action) {
      case "status": {
        const { data, error } = await admin.from("staff_apns_devices").select("kinds").eq("token", token).maybeSingle();
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true, subscribed: Boolean(data), kinds: data?.kinds ?? [] });
      }

      case "register": {
        if (!apnsConfigured()) throw new HttpError(503, "Notifications for the iPhone app aren't set up on the server yet.");
        const kinds = body.kinds === undefined ? undefined : parseKinds(body.kinds);
        const deviceName = typeof body.deviceName === "string" ? body.deviceName.slice(0, 100) : null;
        const { data: existing, error: findErr } = await admin
          .from("staff_apns_devices")
          .select("id, kinds")
          .eq("token", token)
          .maybeSingle();
        if (findErr) throw new HttpError(500, findErr.message);

        if (existing) {
          // Same iPhone again (the app re-syncing on launch, or another staff
          // member signing in on it): keep its choices, update the owner.
          const { error } = await admin
            .from("staff_apns_devices")
            .update({ user_id: staff.userId, device_name: deviceName, updated_at: new Date().toISOString(), ...(kinds ? { kinds } : {}) })
            .eq("id", existing.id);
          if (error) throw new HttpError(500, error.message);
          return sendJson(res, 200, { ok: true, subscribed: true, kinds: kinds ?? existing.kinds });
        }

        const { error } = await admin.from("staff_apns_devices").insert({
          user_id: staff.userId,
          token,
          device_name: deviceName,
          kinds: kinds ?? ALL_STAFF_PUSH_KINDS,
        });
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true, subscribed: true, kinds: kinds ?? ALL_STAFF_PUSH_KINDS });
      }

      case "update": {
        const kinds = parseKinds(body.kinds);
        const { data, error } = await admin
          .from("staff_apns_devices")
          .update({ kinds, updated_at: new Date().toISOString() })
          .eq("token", token)
          .select("kinds")
          .maybeSingle();
        if (error) throw new HttpError(500, error.message);
        if (!data) throw new HttpError(404, "Notifications aren't on for this iPhone.");
        return sendJson(res, 200, { ok: true, subscribed: true, kinds: data.kinds });
      }

      case "unregister": {
        const { error } = await admin.from("staff_apns_devices").delete().eq("token", token);
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, { ok: true, subscribed: false, kinds: [] });
      }

      case "test": {
        if (!apnsConfigured()) throw new HttpError(503, "Notifications for the iPhone app aren't set up on the server yet.");
        const { data: device, error } = await admin.from("staff_apns_devices").select("id").eq("token", token).maybeSingle();
        if (error) throw new HttpError(500, error.message);
        if (!device) throw new HttpError(404, "Notifications aren't on for this iPhone.");

        const [outcome] = await sendApns([token], {
          title: "Notifications are on",
          body: "This is how Geega Admin will let you know about new orders and leads.",
          url: "/admin_dashboard",
          kind: "test",
          tag: "test",
        });
        if (outcome === "gone") {
          await admin.from("staff_apns_devices").delete().eq("id", device.id);
          throw new HttpError(410, "This iPhone's registration expired. Turn notifications on again.");
        }
        if (outcome === "failed") throw new HttpError(502, "Apple didn't accept the test. Check the APNs settings, then try again.");
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
