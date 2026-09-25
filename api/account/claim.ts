import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";
import { ServerEnv } from "../_lib/env.js";
import { methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { verifyGuestToken, type GuestRecordKind } from "../_lib/guestAccess.js";
import { checkRateLimit, getClientIp } from "../_lib/rateLimit.js";

// POST /api/account/claim   { kind: "order" | "sell", id, token }
//
// Attaches a record made as a guest (an order or a sell submission) to the
// signed-in account, so it shows up under Account > Orders / Sell
// submissions. The caller must present the record's signed guest token —
// only the browser that created it, or someone who received its
// confirmation email, has it — so an account can never pull in somebody
// else's order just by knowing an id or an email address.
//
// claim_guest_record only fills an EMPTY user_id: a record already on an
// account is never moved to another one.

const KINDS: ReadonlySet<string> = new Set(["order", "sell"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const ip = getClientIp(req);
  const rl = checkRateLimit("account-claim", ip, 20, 10 * 60_000);
  if (!rl.allowed) {
    return sendJson(res, 429, { ok: false, message: "Too many attempts. Please try again shortly." });
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, message: "Bad request body." });
  }

  const accessToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!accessToken) return sendJson(res, 401, { ok: false, message: "Please sign in." });

  const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? (body.kind as GuestRecordKind) : null;
  if (!kind || !verifyGuestToken(kind, body.id, body.token)) {
    return sendJson(res, 400, { ok: false, message: "This link isn’t valid." });
  }
  const id = body.id as string;

  const userClient = createClient<Database>(
    ServerEnv.supabaseUrl(),
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return sendJson(res, 401, { ok: false, message: "Please sign in again." });
  }

  const { data, error } = await (getSupabaseAdmin() as any).rpc("claim_guest_record", {
    p_kind: kind,
    p_id: id,
    p_user_id: userData.user.id,
  });
  if (error) {
    console.error("[account/claim] claim failed", { kind, id, error: error.message });
    return sendJson(res, 500, { ok: false, message: "Couldn’t link it to your account. Please try again." });
  }
  if (data !== true) {
    // Already on a different account.
    return sendJson(res, 409, { ok: false, message: "That’s already linked to another account." });
  }
  return sendJson(res, 200, { ok: true, kind, id });
}
