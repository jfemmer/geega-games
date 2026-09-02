import crypto from "node:crypto";
import { ServerEnv } from "./env.js";

// ---------------------------------------------------------------------------
// Email normalization + validation (server-side source of truth).
// The browser also does a light check, but this is what actually decides.
// ---------------------------------------------------------------------------

// Conservative but practical email pattern. We intentionally do not attempt full
// RFC 5322 compliance; we reject the obviously invalid and normalize the rest.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 254) return null;
  if (!EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Confirmation / unsubscribe tokens.
//
// We generate a high-entropy random token, hand the RAW token to the user (in
// the email link) and persist only an HMAC of it. Verifying hashes the incoming
// token the same way and compares in constant time. The DB never holds anything
// that can be replayed if the table leaks.
// ---------------------------------------------------------------------------

export function generateToken(bytes = 32): string {
  // URL-safe base64 without padding.
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto
    .createHmac("sha256", ServerEnv.emailTokenSecret())
    .update(token)
    .digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
