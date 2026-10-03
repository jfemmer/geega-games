import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@react-email/render";
import {
  StaffDigest,
  siteVisitorsText,
  staffDigestText,
  type StaffDigestEmailData,
} from "../api/_lib/emails/StaffDigest.js";

// The daily staff digest: what it says about site visitors, and how the
// worker (api/staff-digest/process.ts) counts them. Supabase and the email
// sender are faked at the _lib boundary; the worker's own logic runs for real.

const base: StaffDigestEmailData = {
  dateLabel: "Saturday, October 3, 2026",
  siteVisitors: 14,
  sitePageViews: 52,
  newOrders: 3,
  newOrdersRevenueCents: 4500,
  newLeads: 1,
  newSignups: 2,
  newSubscribers: 0,
  ordersNeedingPacking: 1,
  pendingPickups: 0,
  lowStockCount: 4,
  adminUrl: "https://geega-games.com/admin_dashboard",
  siteUrl: "https://geega-games.com",
  logoUrl: "https://geega-games.com/logo.png",
  supportEmail: "support@geega-games.com",
};

describe("site visitors in the digest email", () => {
  it("shows visitors with their page views", () => {
    expect(siteVisitorsText({ siteVisitors: 14, sitePageViews: 52 })).toBe("14 (52 page views)");
    expect(siteVisitorsText({ siteVisitors: 1, sitePageViews: 1 })).toBe("1 (1 page view)");
    expect(siteVisitorsText({ siteVisitors: 1234, sitePageViews: 5678 })).toBe("1,234 (5,678 page views)");
  });

  it("shows a quiet day as zero", () => {
    expect(siteVisitorsText({ siteVisitors: 0, sitePageViews: 0 })).toBe("0 (0 page views)");
  });

  it("says when the count couldn't be read, rather than showing a false zero", () => {
    expect(siteVisitorsText({ siteVisitors: null, sitePageViews: null })).toBe("not available");
  });

  it("leads the Since yesterday list, in both the text and the HTML email", async () => {
    const lines = staffDigestText(base).split("\n");
    expect(lines[lines.indexOf("Since yesterday:") + 1]).toBe("  Site visitors: 14 (52 page views)");
    expect(lines).toContain("  New orders: 3 ($45.00)");

    const html = await render(StaffDigest(base));
    expect(html).toContain("Site visitors");
    expect(html).toContain("14 (52 page views)");
    expect(html.indexOf("Site visitors")).toBeLessThan(html.indexOf("New orders"));
  });
});

// ── The worker ─────────────────────────────────────────────────────────────

const NOW = new Date("2026-10-03T13:00:00.000Z");

const state: {
  visitors: { data: { visitors: number; page_views: number }[] | null; error: { message: string } | null };
  rpcCalls: { name: string; args: Record<string, unknown> }[];
} = { visitors: { data: [{ visitors: 14, page_views: 52 }], error: null }, rpcCalls: [] };

function tableQuery(table: string) {
  const result =
    table === "orders"
      ? { count: 3, data: [{ total_cents: 1500 }, { total_cents: 1500 }, { total_cents: 1500 }], error: null }
      : { count: 2, data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "gt", "lte", "in"]) chain[method] = () => chain;
  chain.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled);
  return chain;
}

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => tableQuery(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return state.visitors;
    },
  }),
}));

const sendTrackedEmail = vi.fn(async (_args: { text: string; idempotencyKey: string }) => ({ status: "sent" }));
vi.mock("../api/_lib/emailService.js", () => ({
  sendTrackedEmail: (args: { text: string; idempotencyKey: string }) => sendTrackedEmail(args),
}));

async function runWorker() {
  const { default: handler } = await import("../api/staff-digest/process.ts");
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    setHeader() {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  await handler({ method: "POST", headers: {} } as never, res as never);
  return res;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("PUBLIC_SITE_URL", "https://geega-games.com");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.visitors = { data: [{ visitors: 14, page_views: 52 }], error: null };
  state.rpcCalls = [];
  sendTrackedEmail.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the digest worker", () => {
  it("counts visitors over the same 24 hours as the rest of the digest", async () => {
    const res = await runWorker();

    expect(state.rpcCalls).toEqual([
      { name: "site_visitor_counts", args: { p_start: "2026-10-02T13:00:00.000Z", p_end: "2026-10-03T13:00:00.000Z" } },
    ]);
    expect(sendTrackedEmail).toHaveBeenCalledTimes(1);
    const sent = sendTrackedEmail.mock.calls[0][0];
    expect(sent.text).toContain("  Site visitors: 14 (52 page views)");
    expect(sent.text).toContain("  New orders: 3 ($45.00)");
    expect(sent.idempotencyKey).toBe("staff-digest-2026-10-03");
    expect(res.statusCode).toBe(200);
  });

  it("keeps visitor numbers out of its public response", async () => {
    const res = await runWorker();
    expect(res.body).toEqual({ ok: true, status: "sent" });
  });

  it("still sends the digest when the visitor count fails, and says it's not available", async () => {
    state.visitors = { data: null, error: { message: "function not found" } };

    const res = await runWorker();

    expect(res.statusCode).toBe(200);
    expect(sendTrackedEmail.mock.calls[0][0].text).toContain("  Site visitors: not available");
    expect(sendTrackedEmail.mock.calls[0][0].text).toContain("  New orders: 3 ($45.00)");
  });

  it("reports a day with no visits as zero", async () => {
    state.visitors = { data: [{ visitors: 0, page_views: 0 }], error: null };
    await runWorker();
    expect(sendTrackedEmail.mock.calls[0][0].text).toContain("  Site visitors: 0 (0 page views)");
  });
});
