import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { render } from "@react-email/render";

// Automatic Google review requests: who gets asked, when, and the email
// itself. The database is a small in-memory stand-in that applies the same
// filters the real queries do, so these tests also prove the queries select
// the right rows (paid, shipped, completed…).

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.RESEND_API_KEY = "re_test";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
  // The owner's own inbox for order notifications is never asked for a review.
  process.env.ORDER_NOTIFICATION_EMAIL = "Owner@Gmail.com";
});

const NOW = Date.parse("2026-09-26T15:41:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

type Row = Record<string, unknown>;

const state: {
  tables: Record<string, Row[]>;
  failTable: string | null;
  sendResults: Record<string, { status: string; error?: string }>;
} = { tables: {}, failTable: null, sendResults: {} };

const sends: {
  emailType: string;
  idempotencyKey: string;
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  orderId?: string | null;
}[] = [];

// Columns that are citext in Postgres compare case-insensitively.
const CITEXT = new Set(["email_deliveries.to_email", "newsletter_subscribers.email", "customers.email"]);

class Query {
  private filters: ((row: Row) => boolean)[] = [];
  private max = Number.POSITIVE_INFINITY;
  constructor(private table: string) {}
  private norm(col: string, value: unknown) {
    return CITEXT.has(`${this.table}.${col}`) && typeof value === "string" ? value.toLowerCase() : value;
  }
  select() {
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((row) => this.norm(col, row[col]) === this.norm(col, value));
    return this;
  }
  in(col: string, values: readonly unknown[]) {
    const wanted = values.map((v) => this.norm(col, v));
    this.filters.push((row) => wanted.includes(this.norm(col, row[col])));
    return this;
  }
  not(col: string, op: string, value: unknown) {
    if (op === "is" && value === null) {
      this.filters.push((row) => row[col] !== null && row[col] !== undefined);
    } else if (op === "in") {
      const list = String(value).replace(/[()]/g, "").split(",");
      this.filters.push((row) => !list.includes(String(row[col])));
    } else {
      throw new Error(`unsupported not(${op})`);
    }
    return this;
  }
  gte(col: string, value: string) {
    this.filters.push((row) => typeof row[col] === "string" && (row[col] as string) >= value);
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  then<T>(onFulfilled: (value: { data: Row[] | null; error: { message: string } | null }) => T, onRejected?: (e: unknown) => T) {
    const result =
      state.failTable === this.table
        ? { data: null, error: { message: "database unavailable" } }
        : {
            data: (state.tables[this.table] ?? []).filter((row) => this.filters.every((f) => f(row))).slice(0, this.max),
            error: null,
          };
    return Promise.resolve(result).then(onFulfilled, onRejected);
  }
}

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => new Query(table) }),
}));

vi.mock("../api/_lib/emailService.js", () => ({
  sendTrackedEmail: vi.fn(async (args: (typeof sends)[number]) => {
    sends.push(args);
    return state.sendResults[args.idempotencyKey] ?? { status: "sent", resendEmailId: "re_1", deduped: false };
  }),
}));

const lib = await import("../api/_lib/reviewRequests.ts");
const { default: handler } = await import("../api/review-requests/process.ts");
const { ReviewRequest, reviewRequestSubject, reviewRequestText } = await import("../api/_lib/emails/ReviewRequest.ts");

// ---- Fixture ------------------------------------------------------------------

const id = (prefix: string) => `${prefix}-0000-4000-8000-000000000000`;
const ID = {
  A: id("a0000001"), // online, shipped 8 days ago, account holder → asked
  B: id("b0000002"), // online, delivered 4 days ago, guest → asked
  C: id("c0000003"), // online, shipped 3 days ago → still waiting
  D: id("d0000004"), // online, cancelled → never loaded
  E: id("e0000005"), // online, customer turned off order emails → opted out
  F: id("f0000006"), // online, the owner's own inbox → store address
  G: id("a1000007"), // register sale with a customer attached → asked
  G2: id("a2000008"), // register sale, customer's account opted out
  H: id("a3000009"), // register sale, refunded → never loaded
  I: id("a4000010"), // bounced before → blocked
  J: id("a5000011"), // unsubscribed from the newsletter → blocked
  K: id("a6000012"), // asked 30 days ago → recently asked
  L: id("a7000013"), // asked 200 days ago → asked again
  M: id("a8000014"), // shipped 50 days ago → never loaded
  POS1: id("a9000015"), // the register sale behind pickup P1 (no email on it)
  P1: id("b1000016"), // pickup → asked, keyed on its order
  P2: id("b2000017"), // pickup without an email → never loaded
  F2: id("b3000018"), // pickup by staff (@geega-games.com) → store address
  S1: id("b4000019"), // sold us cards → asked
  S2: id("b5000020"), // offer still open → never loaded
  S3: id("b6000021"), // same email as A, due later → duplicate
  S4: id("b7000022"), // seller turned off sell emails → opted out
};

function order(over: Row): Row {
  return {
    channel: "online",
    status: "shipped",
    payment_status: "paid",
    email: null,
    user_id: null,
    customer_id: null,
    shipped_at: null,
    delivered_at: null,
    paid_at: null,
    ...over,
  };
}

function fixture(): Record<string, Row[]> {
  return {
    orders: [
      order({ id: ID.A, email: "Buyer.One@Example.com", user_id: "u1", shipped_at: ago(8) }),
      order({ id: ID.B, email: "two@example.com", status: "delivered", shipped_at: ago(6), delivered_at: ago(4) }),
      order({ id: ID.C, email: "three@example.com", shipped_at: ago(3) }),
      order({ id: ID.D, email: "cancelled@example.com", status: "cancelled", payment_status: "unpaid" }),
      order({ id: ID.E, email: "quiet@example.com", user_id: "u2", shipped_at: ago(8) }),
      order({ id: ID.F, email: "owner@gmail.com", shipped_at: ago(8) }),
      order({ id: ID.G, channel: "pos", status: "paid", email: "walkin@example.com", customer_id: "c1", paid_at: ago(2.5) }),
      order({ id: ID.G2, channel: "pos", status: "paid", email: "regular-quiet@example.com", customer_id: "c2", paid_at: ago(2.5) }),
      order({ id: ID.H, channel: "pos", status: "refunded", payment_status: "refunded", email: "refund@example.com", paid_at: ago(3) }),
      order({ id: ID.I, email: "bounced@example.com", shipped_at: ago(8) }),
      order({ id: ID.J, email: "unsub@example.com", shipped_at: ago(8) }),
      order({ id: ID.K, email: "regular@example.com", shipped_at: ago(8) }),
      order({ id: ID.L, email: "old-ask@example.com", shipped_at: ago(10) }),
      order({ id: ID.M, email: "long-ago@example.com", shipped_at: ago(50) }),
      order({ id: ID.POS1, channel: "pos", status: "paid", email: null, paid_at: ago(3) }),
    ],
    pickup_requests: [
      { id: ID.P1, status: "completed", email: "pickup@example.com", customer_name: "alex rivera", completed_at: ago(3), order_id: ID.POS1 },
      { id: ID.P2, status: "completed", email: null, customer_name: "No Email", completed_at: ago(3), order_id: null },
      { id: ID.F2, status: "completed", email: "staff@geega-games.com", customer_name: "Staff", completed_at: ago(2), order_id: null },
    ],
    sell_submissions: [
      { id: ID.S1, status: "completed", email: "seller@example.com", first_name: "Pat", user_id: null, reference_number: "GG-S-1001", closed_at: ago(3) },
      { id: ID.S2, status: "offer_made", email: "pending@example.com", first_name: "Lee", user_id: null, reference_number: "GG-S-1002", closed_at: null },
      { id: ID.S3, status: "completed", email: "buyer.one@example.com", first_name: "Jamie", user_id: null, reference_number: "GG-S-1003", closed_at: ago(2.5) },
      { id: ID.S4, status: "completed", email: "seller-quiet@example.com", first_name: "Robin", user_id: "u4", reference_number: "GG-S-1004", closed_at: ago(3) },
    ],
    profiles: [
      { id: "u1", first_name: "jamie", shipping_notifications: { enabled: true }, sell_submission_notifications: { enabled: true } },
      { id: "u2", first_name: "Kim", shipping_notifications: { enabled: false }, sell_submission_notifications: { enabled: true } },
      { id: "u3", first_name: "Quinn", shipping_notifications: { enabled: false }, sell_submission_notifications: { enabled: true } },
      { id: "u4", first_name: "Robin", shipping_notifications: { enabled: true }, sell_submission_notifications: { enabled: false } },
    ],
    customers: [
      { id: "c1", first_name: "RILEY", auth_user_id: null },
      { id: "c2", first_name: "Quinn", auth_user_id: "u3" },
    ],
    email_deliveries: [
      { to_email: "Bounced@Example.com", email_type: "order_shipped", status: "bounced", created_at: ago(40) },
      { to_email: "regular@example.com", email_type: "review_request", status: "delivered", created_at: ago(30) },
      { to_email: "old-ask@example.com", email_type: "review_request", status: "delivered", created_at: ago(200) },
      // A send that failed outright never reached them, so it doesn't count.
      { to_email: "two@example.com", email_type: "review_request", status: "failed", created_at: ago(10) },
    ],
    newsletter_subscribers: [
      { email: "unsub@example.com", status: "unsubscribed" },
      { email: "two@example.com", status: "active" },
    ],
  };
}

beforeEach(() => {
  state.tables = fixture();
  state.failTable = null;
  state.sendResults = {};
  sends.length = 0;
});

// ---- Pure rules ---------------------------------------------------------------

describe("when to ask", () => {
  it("asks 2 days after delivery, or 7 days after shipping when never marked delivered", () => {
    expect(lib.shippedOrderDueAt({ shipped_at: ago(6), delivered_at: ago(4) })).toBe(NOW - 2 * DAY);
    expect(lib.shippedOrderDueAt({ shipped_at: ago(8), delivered_at: null })).toBe(NOW - 1 * DAY);
    expect(lib.shippedOrderDueAt({ shipped_at: null, delivered_at: null })).toBeNull();
  });

  it("counts from payment, pickup or the closed deal for everyone else", () => {
    expect(lib.dueAfter(ago(3), "in_person")).toBe(NOW - 2 * DAY);
    expect(lib.dueAfter(ago(3), "pickup")).toBe(NOW - 2 * DAY);
    expect(lib.dueAfter(ago(3), "sell")).toBe(NOW - 1 * DAY);
    expect(lib.dueAfter(null, "sell")).toBeNull();
    expect(lib.dueAfter("not a date", "sell")).toBeNull();
  });
});

describe("firstNameFrom", () => {
  it("greets by first name and tidies all-lowercase or all-caps names", () => {
    expect(lib.firstNameFrom("sam smith")).toBe("Sam");
    expect(lib.firstNameFrom("SAM")).toBe("Sam");
    expect(lib.firstNameFrom("McKenzie Lee")).toBe("McKenzie");
    expect(lib.firstNameFrom("Zoë")).toBe("Zoë");
    expect(lib.firstNameFrom("O'Neil")).toBe("O'Neil");
  });

  it("falls back to no name for anything that isn't one", () => {
    for (const value of ["http://spam.example", "123", "", "   ", "🔥🔥", null, undefined]) {
      expect(lib.firstNameFrom(value)).toBeNull();
    }
  });
});

describe("planReviewRequests", () => {
  const store = new Set(["support@geega-games.com", "owner@gmail.com"]);
  const none = { recentlyAsked: new Set<string>(), blocked: new Set<string>() };
  function cand(key: string, email: string, dueDaysAgo: number, over: Partial<import("../api/_lib/reviewRequests.ts").ReviewCandidate> = {}) {
    return {
      key,
      kind: "shipped_order" as const,
      email,
      firstName: null,
      reference: null,
      dueAt: NOW - dueDaysAgo * DAY,
      orderId: null,
      userId: null,
      customerId: null,
      optedOut: false,
      ...over,
    };
  }

  it("sends what's due, oldest first, and leaves the rest waiting or expired", () => {
    const plan = lib.planReviewRequests(
      [cand("k1", "a@x.com", 1), cand("k2", "b@x.com", 5), cand("k3", "c@x.com", -2), cand("k4", "d@x.com", 31)],
      none,
      { now: NOW, storeAddresses: store },
    );
    expect(plan.send.map((c) => c.key)).toEqual(["k2", "k1"]);
    expect(plan.waiting).toBe(1);
    expect(plan.expired).toBe(1);
  });

  it("skips our own addresses, opt-outs, blocked and recently asked addresses", () => {
    const plan = lib.planReviewRequests(
      [
        cand("k1", "jacob@geega-games.com", 1),
        cand("k2", "owner@gmail.com", 1),
        cand("k3", "quiet@x.com", 1, { optedOut: true }),
        cand("k4", "bounced@x.com", 1),
        cand("k5", "regular@x.com", 1),
        cand("k6", "ok@x.com", 1),
      ],
      { recentlyAsked: new Set(["regular@x.com"]), blocked: new Set(["bounced@x.com"]) },
      { now: NOW, storeAddresses: store },
    );
    expect(plan.send.map((c) => c.key)).toEqual(["k6"]);
    expect(plan.skipped).toEqual({ duplicate: 0, store_address: 2, opted_out: 1, blocked: 1, recently_asked: 1 });
  });

  it("asks each address once per run and each purchase once", () => {
    const plan = lib.planReviewRequests(
      [cand("k1", "a@x.com", 3), cand("k2", "a@x.com", 1), cand("k1", "b@x.com", 2)],
      none,
      { now: NOW, storeAddresses: store },
    );
    expect(plan.send.map((c) => c.key)).toEqual(["k1"]);
    expect(plan.skipped.duplicate).toBe(2);
  });

  it("still asks about another purchase when the first was skipped for its own reason", () => {
    const plan = lib.planReviewRequests(
      [cand("k1", "a@x.com", 3, { optedOut: true }), cand("k2", "a@x.com", 1, { kind: "sell" })],
      none,
      { now: NOW, storeAddresses: store },
    );
    expect(plan.send.map((c) => c.key)).toEqual(["k2"]);
  });

  it("caps a run and carries the overflow to the next one", () => {
    const plan = lib.planReviewRequests(
      [cand("k1", "a@x.com", 3), cand("k2", "b@x.com", 2), cand("k3", "c@x.com", 1)],
      none,
      { now: NOW, storeAddresses: store, limit: 2 },
    );
    expect(plan.send.map((c) => c.key)).toEqual(["k1", "k2"]);
    expect(plan.overflow).toBe(1);
  });
});

// ---- A full run ---------------------------------------------------------------

describe("runReviewRequests", () => {
  const now = new Date(NOW);

  it("emails exactly the customers who are due, once each", async () => {
    const summary = await lib.runReviewRequests({ now });
    const byKey = new Map(sends.map((s) => [s.idempotencyKey, s]));
    expect([...byKey.keys()].sort()).toEqual(
      [
        `review-request-order-${ID.A}`,
        `review-request-order-${ID.B}`,
        `review-request-order-${ID.G}`,
        `review-request-order-${ID.L}`,
        `review-request-order-${ID.POS1}`,
        `review-request-sell-${ID.S1}`,
      ].sort(),
    );
    expect(summary).toEqual({
      checked: 16,
      waiting: 1,
      expired: 0,
      skipped: { duplicate: 1, store_address: 2, opted_out: 3, blocked: 2, recently_asked: 1 },
      sent: 6,
      deduped: 0,
      failed: 0,
      deferred: 0,
    });

    const a = byKey.get(`review-request-order-${ID.A}`)!;
    expect(a).toMatchObject({
      emailType: "review_request",
      to: "buyer.one@example.com",
      from: "Geega Games <orders@geega-games.com>",
      replyTo: "support@geega-games.com",
      subject: "How did your cards arrive?",
      orderId: ID.A,
    });
    expect(a.text).toContain("Hi Jamie,");
    expect(a.text).toContain("(GG-A0000001)");
    expect(a.text).toContain("https://g.page/r/CRDJ_lJiARL8EBM/review");

    // Guest order: no account, so no name (the shipping name may be a gift recipient).
    expect(byKey.get(`review-request-order-${ID.B}`)!.text).toContain("Hi there,");

    const g = byKey.get(`review-request-order-${ID.G}`)!;
    expect(g.subject).toBe("Thanks for stopping by Geega Games");
    expect(g.text).toContain("Hi Riley,");

    const pickup = byKey.get(`review-request-order-${ID.POS1}`)!;
    expect(pickup.subject).toBe("Thanks for picking up your cards");
    expect(pickup.to).toBe("pickup@example.com");
    expect(pickup.orderId).toBe(ID.POS1);
    expect(pickup.text).toContain("Hi Alex,");

    const sell = byKey.get(`review-request-sell-${ID.S1}`)!;
    expect(sell.subject).toBe("How was selling your cards to Geega Games?");
    expect(sell.text).toContain("(GG-S-1001)");
    expect(sell.orderId).toBeNull();
  });

  it("never asks about anything long overdue", async () => {
    state.tables.orders = [order({ id: ID.G, channel: "pos", status: "paid", email: "late@example.com", paid_at: ago(36) })];
    state.tables.pickup_requests = [];
    state.tables.sell_submissions = [];
    const summary = await lib.runReviewRequests({ now });
    expect(summary.expired).toBe(1);
    expect(sends).toHaveLength(0);
  });

  it("keeps going when one email fails, and counts it", async () => {
    state.sendResults[`review-request-order-${ID.A}`] = { status: "failed", error: "Resend down" };
    state.sendResults[`review-request-order-${ID.B}`] = { status: "deduped" };
    const summary = await lib.runReviewRequests({ now });
    expect(summary).toMatchObject({ sent: 4, failed: 1, deduped: 1 });
  });

  it("caps each run and stops at its time budget", async () => {
    expect(await lib.runReviewRequests({ now, limit: 2 })).toMatchObject({ sent: 2, deferred: 4 });
    sends.length = 0;
    expect(await lib.runReviewRequests({ now, timeBudgetMs: -1 })).toMatchObject({ sent: 0, deferred: 6 });
    expect(sends).toHaveLength(0);
  });

  it("sends nothing if it can't read who was already asked", async () => {
    state.failTable = "email_deliveries";
    await expect(lib.runReviewRequests({ now })).rejects.toThrow("database unavailable");
    expect(sends).toHaveLength(0);
  });
});

// ---- The cron endpoint -----------------------------------------------------------

describe("GET /api/review-requests/process", () => {
  function call(headers: Record<string, string> = {}, method = "GET") {
    const res = {
      statusCode: 200,
      body: undefined as unknown as { ok: boolean; sent?: number; skipped?: unknown },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload as typeof this.body;
        return this;
      },
      setHeader() {},
    };
    return handler({ method, headers } as never, res as never).then(() => res);
  }

  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    delete process.env.VERCEL_ENV;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CRON_SECRET;
    delete process.env.VERCEL_ENV;
  });

  it("only answers GET", async () => {
    expect((await call({ authorization: "Bearer s3cret" }, "POST")).statusCode).toBe(405);
  });

  it("does nothing without CRON_SECRET configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call({ authorization: "Bearer anything" })).statusCode).toBe(503);
    expect(sends).toHaveLength(0);
  });

  it("refuses requests that aren't from the cron", async () => {
    expect((await call()).statusCode).toBe(401);
    expect((await call({ authorization: "Bearer s3crex" })).statusCode).toBe(401);
    expect((await call({ authorization: "Bearer wrong-length" })).statusCode).toBe(401);
    expect(sends).toHaveLength(0);
  });

  it("skips preview deployments", async () => {
    process.env.VERCEL_ENV = "preview";
    const res = await call({ authorization: "Bearer s3cret" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ skipped: "not production" });
    expect(sends).toHaveLength(0);
  });

  it("runs in production and reports counts", async () => {
    process.env.VERCEL_ENV = "production";
    const res = await call({ authorization: "Bearer s3cret" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, sent: 6 });
    expect(sends).toHaveLength(6);
  });

  it("reports a failure without sending", async () => {
    state.failTable = "orders";
    const res = await call({ authorization: "Bearer s3cret" });
    expect(res.statusCode).toBe(500);
    expect(sends).toHaveLength(0);
  });
});

// ---- The email ----------------------------------------------------------------------

describe("ReviewRequest email", () => {
  const base = {
    firstName: "Sam",
    reference: "GG-1A2B3C4D",
    reviewUrl: "https://g.page/r/CRDJ_lJiARL8EBM/review",
    siteUrl: "https://geega-games.com",
    logoUrl: "https://geega-games.com/logo.png",
    supportEmail: "support@geega-games.com",
  };
  const kinds = ["shipped_order", "in_person", "pickup", "sell"] as const;

  it("asks every customer the same honest question, with the review link", async () => {
    for (const kind of kinds) {
      const data = { ...base, kind };
      const html = await render(React.createElement(ReviewRequest, data));
      expect(html).toContain("https://g.page/r/CRDJ_lJiARL8EBM/review");
      expect(html).toContain("Leave a Google review");
      expect(html).toContain("honest review");
      expect(html).toContain("Hi Sam,");
      expect(html).toContain("(GG-1A2B3C4D)");
      // No incentives, ever (FTC rule; Google policy).
      expect(html).not.toMatch(/discount|coupon|giveaway|% off/i);
      const text = reviewRequestText(data);
      expect(text).toContain("Leave a Google review: https://g.page/r/CRDJ_lJiARL8EBM/review");
      expect(text).toContain("honest review");
    }
    expect(new Set(kinds.map((kind) => reviewRequestSubject({ ...base, kind }))).size).toBe(kinds.length);
  });

  it("reads naturally without a name or reference", () => {
    const text = reviewRequestText({ ...base, kind: "pickup", firstName: null, reference: null });
    expect(text).toContain("Hi there,");
    expect(text).toContain("Thanks for picking up your order. ");
    expect(text).not.toContain("()");
  });
});
