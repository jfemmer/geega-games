import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  requireJsonContentType,
  sendJson,
} from "./_lib/http.js";
import { normalizeEmail } from "./_lib/tokens.js";
import { subscribe } from "./_lib/subscribers.js";

// POST /api/subscribe
// Body: { email: string, website?: string /* honeypot */, source?: string }
//
// Always returns the SAME generic success for any valid email, regardless of
// whether the address is new, pending, or already subscribed — so the endpoint
// never reveals subscription status. The submitted email is never echoed back.
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, ["POST"]);
  }

  try {
    requireJsonContentType(req);
    const body = await readJsonBody(req);

    // Honeypot: real users never fill this hidden field. Silently succeed so
    // bots get no signal, but do nothing. The field is named 'hp_ref' (the old
    // 'website' name is still checked for backward compatibility) because
    // browser autofill would populate a field literally named 'website',
    // wrongly flagging real users as bots.
    const hp = body.hp_ref ?? body.website;
    const honeypot = typeof hp === "string" ? hp.trim() : "";
    if (honeypot.length > 0) {
      return sendJson(res, 200, { ok: true, status: "confirmation_sent" });
    }

    const email = normalizeEmail(body.email);
    if (!email) {
      return sendJson(res, 400, {
        ok: false,
        status: "validation_error",
        message: "Please enter a valid email address.",
      });
    }

    const source =
      typeof body.source === "string" && body.source.length <= 64
        ? body.source
        : "storefront";

    await subscribe(email, source);

    // Uniform response — do not disclose which internal branch occurred.
    return sendJson(res, 200, { ok: true, status: "confirmation_sent" });
  } catch (err) {
    if (err instanceof HttpError) {
      return sendJson(res, err.status, {
        ok: false,
        status: "error",
        message: err.message,
      });
    }
    // Log server-side detail, return a safe generic message.
    console.error("[/api/subscribe] error:", err);
    return sendJson(res, 500, {
      ok: false,
      status: "server_error",
      message: "Something went wrong on our end. Please try again shortly.",
    });
  }
}