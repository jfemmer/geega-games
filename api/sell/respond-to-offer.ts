import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { normalizeEmail } from "../_lib/tokens.js";
import { checkRateLimit, getClientIp } from "../_lib/rateLimit.js";
import {
  sendSellSubmissionOfferResponseAdminNotification,
  sendSellSubmissionOfferResponseConfirmation,
  sendSellSubmissionStatusUpdate,
} from "../_lib/sellSubmissionEmails.js";
import { LARGE_SELL_COLLECTION_SIZES, STORE_CREDIT_BONUS_PERCENT } from "../../src/store/lib/sellTypes.js";
import { createClient } from "@supabase/supabase-js";
import { ServerEnv } from "../_lib/env.js";
import type { Database } from "../../src/types/database.js";

type SellSubmissionUpdate = Database["public"]["Tables"]["sell_submissions"]["Update"];

// POST /api/sell/respond-to-offer
//
// PUBLIC — the write side of the seller-facing "respond to your offer" page
// (see sell_submission_offer_lookup, its read counterpart, for the anti-
// enumeration reasoning this mirrors). Uses the service_role key directly,
// same architecture as /api/sell/submit.ts: there is no anon UPDATE grant on
// sell_submissions at all, and sending the response-confirmation / staff-
// notification emails is a Node-only capability a SQL RPC cannot do.
//
// Trust boundaries — nothing here is taken from the client at face value:
//   - referenceNumber + email are independently re-matched against the DB in
//     this request, exactly like the lookup RPC. A client-supplied
//     submission id is never accepted or trusted on its own — that would let
//     anyone who guessed/enumerated an id set a response on someone else's
//     lead. The match must succeed fresh, every call.
//   - offer_sent_at must be set (nothing to respond to otherwise) and
//     offer_responded_at must still be null (one response per offer — see
//     send-offer.ts, which resets both when staff send a revised offer).
//   - "countered" is only accepted when THIS submission, as currently
//     stored, is both unsorted (total_cards === 0) and a large collection
//     (LARGE_SELL_COLLECTION_SIZES) — recomputed here from the freshly
//     fetched row, never from anything the client claims about its own
//     eligibility.
//   - counterOfferCents is bounds-checked server-side; a non-"countered"
//     response never stores one.
//   - payoutMethod (accepted only): "paypal" (default) or "store_credit".
//     Store credit needs an account to hold it, so it requires the seller's
//     Supabase access token; the submission is linked to that account (or
//     must already belong to it). The bonus percent is snapshotted now, and
//     the credit itself is issued by the DB when staff mark it completed
//     (sell_submission_issue_store_credit).

const RATE_LIMIT_PER_WINDOW = 10;
const RATE_WINDOW_MS = 10 * 60_000;
const RESPONSES = new Set(["accepted", "declined", "countered"]);
const MAX_COUNTER_OFFER_CENTS = 100_000_000; // $1,000,000 — a sane upper bound, not a real limit anyone should hit

interface RespondBody {
  referenceNumber?: unknown;
  email?: unknown;
  response?: unknown;
  counterOfferCents?: unknown;
  payoutMethod?: unknown;
}

function cleanString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLen);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit("sell-respond-to-offer", ip, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many attempts. Please wait a bit and try again.");
    }

    const body = (await readJsonBody(req)) as RespondBody;
    const referenceNumber = cleanString(body.referenceNumber, 40);
    const email = normalizeEmail(body.email);
    const responseRaw = typeof body.response === "string" ? body.response : "";
    if (!referenceNumber || !email || !RESPONSES.has(responseRaw)) {
      throw new HttpError(400, "A reference number, email, and response are required.");
    }
    const response = responseRaw as "accepted" | "declined" | "countered";

    const admin = getSupabaseAdmin();
    const { data: submission, error } = await admin
      .from("sell_submissions")
      .select(
        "id, email, user_id, reference_number, offer_value_cents, offer_sent_at, offer_responded_at, total_cards, collection_size",
      )
      // reference_number is always generated as GG-S-<seq> (uppercase, see
      // the sell_submissions migration) and email is normalized lowercase at
      // insert time (see normalizeEmail in submit.ts) — both sides are
      // pre-normalized the same way here, so a plain equality match is exact
      // AND safe. Deliberately not .ilike(): email's own validation
      // (EMAIL_RE) allows "%" and "_", which ilike treats as wildcards —
      // using it here would let a crafted email widen the match to other
      // sellers' rows instead of erroring like it should.
      .eq("reference_number", referenceNumber.toUpperCase())
      .eq("email", email)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!submission || !submission.offer_sent_at || submission.offer_value_cents == null) {
      // Identical response whether the ref/email don't match at all, or they
      // match a submission with no offer yet — never confirms which.
      throw new HttpError(404, "We couldn't find an offer matching that reference number and email.");
    }
    if (submission.offer_responded_at) {
      throw new HttpError(409, "You've already responded to this offer.");
    }

    let counterOfferCents: number | null = null;
    if (response === "countered") {
      const allowCounter =
        submission.total_cards === 0 &&
        submission.collection_size != null &&
        LARGE_SELL_COLLECTION_SIZES.has(submission.collection_size);
      if (!allowCounter) {
        throw new HttpError(400, "A counter-offer isn't available for this submission.");
      }
      const raw = Math.round(Number(body.counterOfferCents));
      if (!Number.isFinite(raw) || raw <= 0 || raw > MAX_COUNTER_OFFER_CENTS) {
        throw new HttpError(400, "Please enter a valid counter-offer amount.");
      }
      counterOfferCents = raw;
    }

    const now = new Date().toISOString();
    const update: SellSubmissionUpdate = {
      offer_response: response,
      offer_responded_at: now,
      counter_offer_cents: counterOfferCents,
    };
    // Accepting the offer also resolves our own workflow status — this is
    // the one status transition an outside actor (the seller) can trigger;
    // declining/countering deliberately leave status alone for staff to
    // decide the next step themselves (see the offer_response column
    // comment in its migration).
    if (response === "accepted") {
      update.status = "accepted";
      const payoutMethod = body.payoutMethod === "store_credit" ? "store_credit" : "paypal";
      update.payout_method = payoutMethod;
      if (payoutMethod === "store_credit") {
        const accessToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        const userId = accessToken ? await userIdFromToken(accessToken) : null;
        if (!userId) {
          throw new HttpError(401, "Please sign in (or create a free account) to take store credit.");
        }
        if (submission.user_id && submission.user_id !== userId) {
          throw new HttpError(403, "This submission is linked to a different account. Sign in to that account to take store credit.");
        }
        update.user_id = userId;
        update.store_credit_bonus_percent = STORE_CREDIT_BONUS_PERCENT;
      }
    }

    const { error: updateError } = await admin
      .from("sell_submissions")
      .update(update)
      .eq("id", submission.id);
    if (updateError) throw new HttpError(500, updateError.message);

    // Emails are best-effort: the response is already saved, and a mail
    // failure here must never undo it or fail the request.
    try {
      if (response === "accepted") {
        await sendSellSubmissionStatusUpdate(submission.id, "accepted");
      } else {
        await sendSellSubmissionOfferResponseConfirmation(
          submission.id,
          response,
          submission.offer_value_cents,
          counterOfferCents,
        );
      }
    } catch (mailErr) {
      console.error("[/api/sell/respond-to-offer] seller confirmation email failed:", mailErr);
    }
    try {
      await sendSellSubmissionOfferResponseAdminNotification(
        submission.id,
        response,
        submission.offer_value_cents,
        counterOfferCents,
      );
    } catch (mailErr) {
      console.error("[/api/sell/respond-to-offer] admin notification email failed:", mailErr);
    }

    return sendJson(res, 200, { ok: true, response });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/sell/respond-to-offer] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}

async function userIdFromToken(accessToken: string): Promise<string | null> {
  const client = createClient(
    ServerEnv.supabaseUrl(),
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : data.user.id;
}
