import * as React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { sendTrackedEmail } from "./emailService.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";
import { normalizeEmail } from "./tokens.js";
import { GOOGLE_REVIEW_URL, PRODUCTION_ORIGIN } from "../../src/seo/site.js";
import {
  ReviewRequest,
  reviewRequestSubject,
  reviewRequestText,
  type ReviewRequestEmailData,
  type ReviewRequestKind,
} from "./emails/ReviewRequest.js";

// Automatic Google review requests.
//
// Once a day, api/review-requests/process.ts (a Vercel cron) runs this. It
// finds customers who now have their cards, or their money, and sends each
// one a single email asking for an honest Google review:
//
//   customer                       asked                          measured from
//   online order that shipped      2 days after delivery, or 7    delivered_at, else
//                                  days after shipping when it's   shipped_at
//                                  never marked delivered
//   in-person sale at the register 1 day after paying (only when  orders.paid_at
//                                  a customer with an email was
//                                  attached to the sale)
//   local pickup                   1 day after pickup             pickup_requests.completed_at
//   sold us their cards            2 days after the deal closed   sell_submissions.closed_at
//
// Guard rails:
//   * one ask per purchase or sale, ever (the email_deliveries idempotency
//     key), and one per email address per REVIEW_COOLDOWN_DAYS;
//   * nothing more than REVIEW_WINDOW_DAYS past due, so old customers are
//     never mailed out of the blue;
//   * never to an address that bounced, complained, was suppressed or
//     unsubscribed from our emails; never to anyone who turned off order (or
//     sell) emails in their account; never to the store's own addresses;
//   * at most REVIEW_MAX_PER_RUN per run, oldest first. The rest go out on the
//     next run.
//
// Everyone who qualifies gets the same email: nobody is screened first by how
// happy they are, and there's no incentive (Google's review policy; FTC rule
// on consumer reviews, 16 CFR Part 465). TCGplayer orders live on TCGplayer,
// not in this database, so they never get one.

const DAY_MS = 24 * 60 * 60 * 1000;

export const REVIEW_EMAIL_TYPE = "review_request";

/** Days after the customer has their cards (or money) before we ask. */
export const REVIEW_DELAY_DAYS: Record<ReviewRequestKind, number> = {
  shipped_order: 2,
  in_person: 1,
  pickup: 1,
  sell: 2,
};

/**
 * An online order that's never marked delivered (plain-envelope orders have
 * no tracking) is asked about this many days after it shipped. USPS
 * First-Class usually takes 2–5 days.
 */
export const SHIPPED_ASK_AFTER_DAYS = 7;

/** Don't ask at all once an ask is this many days overdue. */
export const REVIEW_WINDOW_DAYS = 30;

/**
 * Ask any one email address at most once in this many days. A Google account
 * can only leave one review per business, so asking regulars more often is
 * just noise.
 */
export const REVIEW_COOLDOWN_DAYS = 180;

/** Most emails sent in one run. */
export const REVIEW_MAX_PER_RUN = 40;

const ROW_LIMIT = 1000;
/** Keep `in (...)` lists short enough for a URL. */
const IN_CHUNK = 100;

const SHIPPED_STATUSES = ["shipped", "delivered"] as const;
/** Deliveries that mean "don't email this address". */
const UNDELIVERABLE = ["bounced", "complained", "suppressed"] as const;
/** Subscriber states that mean "don't email this address". */
const NO_MAIL_SUBSCRIBER = ["unsubscribed", "bounced", "complained", "suppressed"] as const;

export interface ReviewCandidate {
  /** Idempotency key: one ask per purchase or sale, ever. */
  key: string;
  kind: ReviewRequestKind;
  /** Lowercased. */
  email: string;
  firstName: string | null;
  /** Order number or sell reference shown in the email. */
  reference: string | null;
  /** When the ask became due, in ms since the epoch. */
  dueAt: number;
  orderId: string | null;
  /** Account whose email preferences apply, when the customer has one. */
  userId: string | null;
  /** Register customer (in-person sales), for a name and linked account. */
  customerId: string | null;
  /** They turned these emails off in their account. */
  optedOut: boolean;
}

export type ReviewSkipReason = "duplicate" | "store_address" | "opted_out" | "blocked" | "recently_asked";

export interface ReviewPlan {
  /** Oldest due first. */
  send: ReviewCandidate[];
  /** Not due yet (still in the mail, or inside the delay). */
  waiting: number;
  /** More than REVIEW_WINDOW_DAYS overdue; never sent. */
  expired: number;
  skipped: Record<ReviewSkipReason, number>;
  /** Due and allowed but over the per-run cap; they go next run. */
  overflow: number;
}

export interface ReviewHistory {
  /** Asked for a review within the cooldown. Lowercased. */
  recentlyAsked: ReadonlySet<string>;
  /** Bounced, complained, suppressed or unsubscribed. Lowercased. */
  blocked: ReadonlySet<string>;
}

export interface ReviewRunSummary {
  checked: number;
  waiting: number;
  expired: number;
  skipped: Record<ReviewSkipReason, number>;
  sent: number;
  /** Already asked about that purchase or sale (idempotency key existed). */
  deduped: number;
  failed: number;
  /** Over the cap or out of time; they go next run. */
  deferred: number;
}

// ---- Pure helpers ------------------------------------------------------------

/** Same order number the order emails and receipts use. */
export function orderNumber(orderId: string): string {
  return `GG-${orderId.slice(0, 8).toUpperCase()}`;
}

/**
 * A first name that's safe to greet someone with: the first word, letters
 * only (plus ' and -). "sam" and "SAM" become "Sam". Anything else (numbers,
 * links, emoji) gives null, and the email says "Hi there".
 */
export function firstNameFrom(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^\p{L}[\p{L}'’-]{0,29}$/u.test(first)) return null;
  const lower = first.toLocaleLowerCase("en-US");
  const upper = first.toLocaleUpperCase("en-US");
  if (first === lower || first === upper) return upper.charAt(0) + lower.slice(1);
  return first;
}

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** When to ask about a shipped online order, or null without a ship or delivery date. */
export function shippedOrderDueAt(order: { shipped_at: string | null; delivered_at: string | null }): number | null {
  const delivered = parseTime(order.delivered_at);
  if (delivered !== null) return delivered + REVIEW_DELAY_DAYS.shipped_order * DAY_MS;
  const shipped = parseTime(order.shipped_at);
  return shipped === null ? null : shipped + SHIPPED_ASK_AFTER_DAYS * DAY_MS;
}

/** When to ask, counting from the moment the customer had their cards or money. */
export function dueAfter(anchor: string | null | undefined, kind: ReviewRequestKind): number | null {
  const t = parseTime(anchor);
  return t === null ? null : t + REVIEW_DELAY_DAYS[kind] * DAY_MS;
}

const STORE_DOMAIN = new URL(PRODUCTION_ORIGIN).hostname.replace(/^www\./, "");

/** "Geega Games <orders@geega-games.com>" → "orders@geega-games.com". */
function addressOf(value: string): string | null {
  const bracketed = /<([^>]+)>/.exec(value);
  return normalizeEmail(bracketed ? bracketed[1] : value);
}

/** The store's own inboxes and senders; they never get asked. */
export function storeAddresses(): Set<string> {
  const addresses = new Set<string>();
  for (const value of [
    ServerEnv.replyTo(),
    ServerEnv.orderNotificationEmail(),
    ServerEnv.sellLeadsNotificationEmail(),
    ServerEnv.fromOrders(),
    ServerEnv.fromMarketing(),
  ]) {
    const address = addressOf(value);
    if (address) addresses.add(address);
  }
  return addresses;
}

export function isStoreAddress(email: string, store: ReadonlySet<string>): boolean {
  return email.endsWith(`@${STORE_DOMAIN}`) || store.has(email);
}

function emptySkips(): Record<ReviewSkipReason, number> {
  return { duplicate: 0, store_address: 0, opted_out: 0, blocked: 0, recently_asked: 0 };
}

/** Decide who to email this run. Pure: no database, no clock. */
export function planReviewRequests(
  candidates: readonly ReviewCandidate[],
  history: ReviewHistory,
  opts: { now: number; storeAddresses: ReadonlySet<string>; limit?: number },
): ReviewPlan {
  const limit = opts.limit ?? REVIEW_MAX_PER_RUN;
  const plan: ReviewPlan = { send: [], waiting: 0, expired: 0, skipped: emptySkips(), overflow: 0 };

  const due = candidates
    .filter((c) => {
      if (c.dueAt > opts.now) {
        plan.waiting += 1;
        return false;
      }
      if (opts.now - c.dueAt > REVIEW_WINDOW_DAYS * DAY_MS) {
        plan.expired += 1;
        return false;
      }
      return true;
    })
    // Oldest first, so nothing ages out while newer ones go ahead of it.
    .sort((a, b) => a.dueAt - b.dueAt || a.key.localeCompare(b.key));

  const seenKeys = new Set<string>();
  const askedThisRun = new Set<string>();
  for (const c of due) {
    let reason: ReviewSkipReason | null = null;
    if (seenKeys.has(c.key) || askedThisRun.has(c.email)) reason = "duplicate";
    else if (isStoreAddress(c.email, opts.storeAddresses)) reason = "store_address";
    else if (c.optedOut) reason = "opted_out";
    else if (history.blocked.has(c.email)) reason = "blocked";
    else if (history.recentlyAsked.has(c.email)) reason = "recently_asked";
    seenKeys.add(c.key);
    if (reason) {
      plan.skipped[reason] += 1;
      continue;
    }
    askedThisRun.add(c.email);
    if (plan.send.length >= limit) plan.overflow += 1;
    else plan.send.push(c);
  }
  return plan;
}

// ---- Database -----------------------------------------------------------------

type Db = SupabaseClient<Database>;

type Rows<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Runs a `where x in (...)` query in chunks and concatenates the rows. */
async function inChunks<T>(values: string[], query: (chunk: string[]) => Rows<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const { data, error } = await query(values.slice(i, i + IN_CHUNK));
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

function candidate(
  fields: Omit<ReviewCandidate, "email" | "dueAt" | "optedOut"> & { email: string | null; dueAt: number | null },
): ReviewCandidate | null {
  const email = normalizeEmail(fields.email);
  if (!email || fields.dueAt === null) return null;
  return { ...fields, email, dueAt: fields.dueAt, optedOut: false };
}

/** Everyone who could be due now (the planner decides who actually is). */
export async function loadReviewCandidates(db: Db, now: number): Promise<ReviewCandidate[]> {
  // Anything anchored before this is past the window whatever its delay.
  const since = new Date(now - (REVIEW_WINDOW_DAYS + SHIPPED_ASK_AFTER_DAYS) * DAY_MS).toISOString();

  const [shipped, register, pickups, sells] = await Promise.all([
    db
      .from("orders")
      .select("id, email, user_id, shipped_at, delivered_at")
      .eq("channel", "online")
      .eq("payment_status", "paid")
      .in("status", SHIPPED_STATUSES)
      .not("email", "is", null)
      .gte("shipped_at", since)
      .limit(ROW_LIMIT),
    db
      .from("orders")
      .select("id, email, customer_id, paid_at")
      .eq("channel", "pos")
      .eq("payment_status", "paid")
      .not("status", "in", "(cancelled,refunded)")
      .not("email", "is", null)
      .gte("paid_at", since)
      .limit(ROW_LIMIT),
    db
      .from("pickup_requests")
      .select("id, email, customer_name, completed_at, order_id")
      .eq("status", "completed")
      .not("email", "is", null)
      .gte("completed_at", since)
      .limit(ROW_LIMIT),
    db
      .from("sell_submissions")
      .select("id, email, first_name, user_id, reference_number, closed_at")
      .eq("status", "completed")
      .gte("closed_at", since)
      .limit(ROW_LIMIT),
  ]);
  for (const result of [shipped, register, pickups, sells]) {
    if (result.error) throw new Error(result.error.message);
  }

  const out: (ReviewCandidate | null)[] = [];
  for (const o of shipped.data ?? []) {
    out.push(
      candidate({
        key: `review-request-order-${o.id}`,
        kind: "shipped_order",
        email: o.email,
        // Named from the account only. The shipping name may be a gift
        // recipient, not the buyer.
        firstName: null,
        reference: orderNumber(o.id),
        dueAt: shippedOrderDueAt(o),
        orderId: o.id,
        userId: o.user_id,
        customerId: null,
      }),
    );
  }
  for (const o of register.data ?? []) {
    out.push(
      candidate({
        key: `review-request-order-${o.id}`,
        kind: "in_person",
        email: o.email,
        firstName: null,
        reference: orderNumber(o.id),
        dueAt: dueAfter(o.paid_at, "in_person"),
        orderId: o.id,
        userId: null,
        customerId: o.customer_id,
      }),
    );
  }
  for (const p of pickups.data ?? []) {
    out.push(
      candidate({
        // A pickup rung up at the register has an order; keying on it means
        // the same purchase can never be asked about twice.
        key: p.order_id ? `review-request-order-${p.order_id}` : `review-request-pickup-${p.id}`,
        kind: "pickup",
        email: p.email,
        firstName: firstNameFrom(p.customer_name),
        reference: p.order_id ? orderNumber(p.order_id) : null,
        dueAt: dueAfter(p.completed_at, "pickup"),
        orderId: p.order_id,
        userId: null,
        customerId: null,
      }),
    );
  }
  for (const s of sells.data ?? []) {
    out.push(
      candidate({
        key: `review-request-sell-${s.id}`,
        kind: "sell",
        email: s.email,
        firstName: firstNameFrom(s.first_name),
        reference: s.reference_number,
        dueAt: dueAfter(s.closed_at, "sell"),
        orderId: null,
        userId: s.user_id,
        customerId: null,
      }),
    );
  }
  return out.filter((c): c is ReviewCandidate => c !== null);
}

function prefsOff(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { enabled?: unknown }).enabled === false;
}

/**
 * Fills in names from register customers and accounts, and marks anyone who
 * turned off order emails (buyers) or sell-request emails (sellers) in their
 * account. Mutates the candidates.
 */
export async function applyAccountDetails(db: Db, candidates: ReviewCandidate[]): Promise<void> {
  const customerIds = unique(candidates.map((c) => c.customerId));
  if (customerIds.length > 0) {
    const customers = await inChunks(customerIds, (chunk) =>
      db.from("customers").select("id, first_name, auth_user_id").in("id", chunk),
    );
    const byId = new Map(customers.map((row) => [row.id, row]));
    for (const c of candidates) {
      const customer = c.customerId ? byId.get(c.customerId) : undefined;
      if (!customer) continue;
      c.firstName ??= firstNameFrom(customer.first_name);
      c.userId ??= customer.auth_user_id;
    }
  }

  const userIds = unique(candidates.map((c) => c.userId));
  if (userIds.length === 0) return;
  const profiles = await inChunks(userIds, (chunk) =>
    db
      .from("profiles")
      .select("id, first_name, shipping_notifications, sell_submission_notifications")
      .in("id", chunk),
  );
  const byId = new Map(profiles.map((row) => [row.id, row]));
  for (const c of candidates) {
    const profile = c.userId ? byId.get(c.userId) : undefined;
    if (!profile) continue;
    c.firstName ??= firstNameFrom(profile.first_name);
    c.optedOut = prefsOff(
      c.kind === "sell" ? profile.sell_submission_notifications : profile.shipping_notifications,
    );
  }
}

/** Who was asked recently, and who we must not email at all. */
export async function loadReviewHistory(db: Db, emails: string[], now: number): Promise<ReviewHistory> {
  const cooldownStart = new Date(now - REVIEW_COOLDOWN_DAYS * DAY_MS).toISOString();
  const [asked, undeliverable, noMail] = await Promise.all([
    inChunks(emails, (chunk) =>
      db
        .from("email_deliveries")
        .select("to_email")
        .eq("email_type", REVIEW_EMAIL_TYPE)
        .in("to_email", chunk)
        // A send that failed outright never reached them.
        .not("status", "in", "(failed,canceled)")
        .gte("created_at", cooldownStart)
        .limit(ROW_LIMIT),
    ),
    inChunks(emails, (chunk) =>
      db.from("email_deliveries").select("to_email").in("to_email", chunk).in("status", UNDELIVERABLE).limit(ROW_LIMIT),
    ),
    inChunks(emails, (chunk) =>
      db
        .from("newsletter_subscribers")
        .select("email")
        .in("email", chunk)
        .in("status", NO_MAIL_SUBSCRIBER)
        .limit(ROW_LIMIT),
    ),
  ]);
  return {
    recentlyAsked: new Set(asked.map((row) => row.to_email.toLowerCase())),
    blocked: new Set([
      ...undeliverable.map((row) => row.to_email.toLowerCase()),
      ...noMail.map((row) => row.email.toLowerCase()),
    ]),
  };
}

// ---- The run --------------------------------------------------------------------

/**
 * Find who's due and send their emails. Throws if the database can't be
 * read (so nothing is sent on partial information); individual send
 * failures are counted, logged and don't stop the run.
 */
export async function runReviewRequests(
  opts: { now?: Date; timeBudgetMs?: number; limit?: number } = {},
): Promise<ReviewRunSummary> {
  const startedAt = Date.now();
  const now = (opts.now ?? new Date()).getTime();
  const timeBudgetMs = opts.timeBudgetMs ?? 40_000;
  const db = getSupabaseAdmin();

  const candidates = await loadReviewCandidates(db, now);
  await applyAccountDetails(db, candidates);
  const history = await loadReviewHistory(db, unique(candidates.map((c) => c.email)), now);
  const plan = planReviewRequests(candidates, history, {
    now,
    storeAddresses: storeAddresses(),
    limit: opts.limit,
  });

  const summary: ReviewRunSummary = {
    checked: candidates.length,
    waiting: plan.waiting,
    expired: plan.expired,
    skipped: plan.skipped,
    sent: 0,
    deduped: 0,
    failed: 0,
    deferred: plan.overflow,
  };
  if (plan.send.length === 0) return summary;

  const shared = {
    reviewUrl: GOOGLE_REVIEW_URL,
    siteUrl: siteUrl(),
    logoUrl: logoUrl(),
    supportEmail: ServerEnv.replyTo(),
  };

  for (let i = 0; i < plan.send.length; i += 1) {
    if (Date.now() - startedAt > timeBudgetMs) {
      summary.deferred += plan.send.length - i;
      break;
    }
    const c = plan.send[i];
    const data: ReviewRequestEmailData = {
      kind: c.kind,
      firstName: c.firstName,
      reference: c.reference,
      ...shared,
    };
    try {
      const result = await sendTrackedEmail({
        emailType: REVIEW_EMAIL_TYPE,
        idempotencyKey: c.key,
        to: c.email,
        from: ServerEnv.fromOrders(),
        replyTo: ServerEnv.replyTo(),
        subject: reviewRequestSubject(data),
        react: React.createElement(ReviewRequest, data),
        text: reviewRequestText(data),
        orderId: c.orderId,
      });
      if (result.status === "sent") summary.sent += 1;
      else if (result.status === "deduped") summary.deduped += 1;
      else {
        summary.failed += 1;
        console.error("[review-requests] send failed", c.key, result.error);
      }
    } catch (err) {
      summary.failed += 1;
      console.error("[review-requests] send threw", c.key, err);
    }
  }
  return summary;
}
