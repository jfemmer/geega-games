import crypto from "node:crypto";
import { ServerEnv } from "./env.js";

// Signed "I placed this" tokens for guest records (orders and sell
// submissions made without an account).
//
// A token is HMAC-SHA256(EMAIL_TOKEN_SECRET, "<kind>:<id>") — deterministic,
// so nothing is stored: the server can re-derive and compare it any time.
// It is handed out only to whoever created the record (the checkout /
// submit response in that browser) and inside the confirmation email sent
// to the record's address. Holding it proves possession of the record, which
// is what lets a guest:
//   * pay for their own pending order (PayPal / Stripe status calls), and
//   * attach the record to an account they create or sign in to later
//     (api/account/claim.ts -> claim_guest_record).
// It deliberately does NOT depend on Supabase's email-confirmation setting.

export type GuestRecordKind = "order" | "sell";

const ID_RE = /^[0-9a-f-]{36}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function signGuestToken(kind: GuestRecordKind, id: string): string {
  return crypto
    .createHmac("sha256", ServerEnv.emailTokenSecret())
    .update(`guest-${kind}:${id.toLowerCase()}`)
    .digest("base64url");
}

/** False when EMAIL_TOKEN_SECRET isn't configured (guest features then switch off safely). */
export function guestTokensAvailable(): boolean {
  try {
    return ServerEnv.emailTokenSecret().length > 0;
  } catch {
    return false;
  }
}

export function verifyGuestToken(kind: GuestRecordKind, id: unknown, token: unknown): boolean {
  if (typeof id !== "string" || typeof token !== "string") return false;
  if (!guestTokensAvailable()) return false;
  if (!ID_RE.test(id) || !TOKEN_RE.test(token)) return false;
  const expected = Buffer.from(signGuestToken(kind, id));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/**
 * `/signup?claim=<kind>.<id>.<token>` — the storefront stores it and claims
 * after sign-in. Null when tokens aren't configured (the link is just omitted).
 */
export function claimParam(kind: GuestRecordKind, id: string): string | null {
  if (!guestTokensAvailable()) return null;
  return `${kind}.${id}.${signGuestToken(kind, id)}`;
}
