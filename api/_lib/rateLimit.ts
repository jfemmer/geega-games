import type { VercelRequest } from "@vercel/node";

// Best-effort in-memory rate limiting for public (unauthenticated) endpoints.
//
// This is per-lambda-instance state — it resets on cold start and is not
// shared across concurrent instances, so it is NOT a hard guarantee. It is
// still a real, useful deterrent against a single abusive client hammering a
// public endpoint from one warm instance, and costs nothing to run (no Redis/
// Upstash dependency to provision). Endpoints that need a stronger guarantee
// (e.g. the submission endpoint) pair this with a persisted, DB-backed check.
//
// A sliding window of request timestamps per key. Old buckets are swept
// periodically so this can't grow unbounded over a long-lived instance.

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 5000;
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 5 * 60_000;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.hits.length === 0 || now - bucket.hits[bucket.hits.length - 1] > SWEEP_INTERVAL_MS) {
      buckets.delete(key);
    }
  }
  // Hard safety valve: if something is generating far more distinct keys
  // than expected, drop the oldest half rather than growing unbounded.
  if (buckets.size > MAX_TRACKED_KEYS) {
    const keys = Array.from(buckets.keys()).slice(0, buckets.size - MAX_TRACKED_KEYS / 2);
    for (const k of keys) buckets.delete(k);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the caller can retry, only set when not allowed. */
  retryAfterMs?: number;
}

/**
 * Sliding-window rate limit. `scope` namespaces independent limits (e.g. one
 * endpoint's limit never interferes with another's); `key` identifies the
 * caller within that scope (typically an IP address).
 */
export function checkRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const bucketKey = `${scope}:${key}`;
  const bucket = buckets.get(bucketKey) ?? { hits: [] };
  const windowStart = now - windowMs;
  bucket.hits = bucket.hits.filter((t) => t > windowStart);

  if (bucket.hits.length >= limit) {
    buckets.set(bucketKey, bucket);
    const retryAfterMs = bucket.hits[0] + windowMs - now;
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
  }

  bucket.hits.push(now);
  buckets.set(bucketKey, bucket);
  return { allowed: true };
}

/** Best-effort client IP from Vercel's forwarding headers. */
export function getClientIp(req: VercelRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  const first = raw?.split(",")[0]?.trim();
  return first || req.socket?.remoteAddress || "unknown";
}
