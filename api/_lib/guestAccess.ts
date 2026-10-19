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
//
// "checkin" tokens sign a partner referral id: they let the seller answer the
// "did the store get in touch?" email (api/partner-referrals/checkin.ts) and
// nothing else.
//
// "sorting" tokens sign a collection sorting request id: the link in the
// quote email carries one, and it's what lets a customer approve, decline
// or pay their quote (api/sorting-quote.ts) without signing in. Looking at
// the quote only needs the reference number and email.
//
// "yard_sale" tokens sign a yard sale pickup list id: the shopper's phone
// gets one with its pickup number and uses it to show the list and add more
// cards (api/yard-sale.ts). They can't be claimed by an account.

export type GuestRecordKind = "order" | "sell" | "checkin" | "sorting" | "yard_sale";

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
