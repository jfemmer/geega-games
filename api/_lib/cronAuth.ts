import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// Gate for endpoints run by Vercel Cron (the "crons" list in vercel.json).
//
// Vercel sends "Authorization: Bearer <CRON_SECRET>" on scheduled requests
// when the CRON_SECRET environment variable is set, and this refuses anything
// else. Without CRON_SECRET nothing runs (fails closed). Preview deployments
// skip the work: they share the production database and would email real
// customers or announce production URLs.
//
// Returns true when the caller should go ahead. Otherwise it has already
// sent the response.
export function allowCronRequest(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ ok: false, message: "Method not allowed." });
    return false;
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ ok: false, message: "CRON_SECRET is not configured." });
    return false;
  }
  if (!bearerMatches(req.headers.authorization, secret)) {
    res.status(401).json({ ok: false, message: "Unauthorized." });
    return false;
  }

  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    res.status(200).json({ ok: true, skipped: "not production" });
    return false;
  }
  return true;
}

/** The header the database's pg_cron jobs send (public.call_worker). */
export const WORKER_SECRET_HEADER = "x-geega-worker-secret";

// Gate for the background workers the database's pg_cron jobs call
// (public.call_worker in migration 20261105230000_worker_secret_header.sql):
// checkout hold expiry and the Trade Center worker, stock / deck / wishlist
// alerts, checkout recovery, the staff digest, shipping updates and partner
// check-ins.
//
// pg_cron sends a POST with WORKER_SECRET in the x-geega-worker-secret header.
// Anything without it is refused, so nobody outside can make these run (each
// run calls Stripe, the carrier and the email service). Without WORKER_SECRET
// nothing runs (fails closed). Preview deployments skip the work, for the
// same reason as allowCronRequest: they share the production database.
//
// Returns true when the caller should go ahead. Otherwise it has already
// sent the response.
export function allowWorkerRequest(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ ok: false, message: "Method not allowed." });
    return false;
  }

  const secret = process.env.WORKER_SECRET;
  if (!secret) {
    res.status(503).json({ ok: false, message: "WORKER_SECRET is not configured." });
    return false;
  }
  if (!secretMatches(req.headers[WORKER_SECRET_HEADER], secret)) {
    res.status(401).json({ ok: false, message: "Unauthorized." });
    return false;
  }

  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    res.status(200).json({ ok: true, skipped: "not production" });
    return false;
  }
  return true;
}

function bearerMatches(header: string | string[] | undefined, secret: string): boolean {
  return secretMatches(header, `Bearer ${secret}`);
}

function secretMatches(header: string | string[] | undefined, expectedValue: string): boolean {
  if (typeof header !== "string") return false;
  const expected = Buffer.from(expectedValue);
  const actual = Buffer.from(header);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
