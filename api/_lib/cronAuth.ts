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

function bearerMatches(header: string | string[] | undefined, secret: string): boolean {
  if (typeof header !== "string") return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
