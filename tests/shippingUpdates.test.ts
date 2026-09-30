import { beforeEach, describe, expect, it, vi } from "vitest";

// The hourly shipping follow-up (api/_lib/shippingUpdates.ts): delivered
// emails for tracked orders, and the "should have arrived" check-in for Plain
// White Envelope orders. Supabase, EasyPost and the email sender are faked at
// the _lib boundary; the worker's own logic runs for real.

type Row = Record<string, unknown>;
type Op = {
  table: string;
  kind: "select" | "update";
  payload: Row | null;
  filters: unknown[][];
  returnsRows: boolean;
};

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-09T18:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const state = {
  connected: true,
  tracked: [] as Row[],
  pwe: [] as Row[],
  sentKeys: [] as string[],
  /** Orders another run already claimed. */
  claimedElsewhere: new Set<string>(),
  updates: [] as { id: unknown; payload: Row; filters: unknown[][] }[],
};

function filterValue(op: Op, column: string): unknown {
  return op.filters.find((f) => f[0] === "eq" && f[1] === column)?.[2];
}

function resolve(op: Op): { data: unknown; error: null } {
  if (op.table === "email_deliveries") {
    return { data: state.sentKeys.map((k) => ({ idempotency_key: k })), error: null };
  }
  if (op.kind === "select") {
    const method = filterValue(op, "shipping_method");
    return { data: method === "tracked" ? state.tracked : method === "pwe" ? state.pwe : [], error: null };
  }
  const id = filterValue(op, "id");
  state.updates.push({ id, payload: op.payload ?? {}, filters: op.filters });
  if (!op.returnsRows) return { data: null, error: null };
  const isClaim = op.payload && Object.keys(op.payload).length === 1 && "tracking_checked_at" in op.payload;
  if (isClaim && state.claimedElsewhere.has(String(id))) return { data: [], error: null };
  return { data: [{ id }], error: null };
}

function builder(table: string) {
  const op: Op = { table, kind: "select", payload: null, filters: [], returnsRows: false };
  const chain: Record<string, unknown> = {};
  const self = (name: string) => (...args: unknown[]) => {
    op.filters.push([name, ...args]);
    return chain;
  };
  Object.assign(chain, {
    select: () => {
      if (op.kind === "update") op.returnsRows = true;
      return chain;
    },
    update: (payload: Row) => {
      op.kind = "update";
      op.payload = payload;
      return chain;
    },
    eq: self("eq"),
    not: self("not"),
    gte: self("gte"),
    lte: self("lte"),
    or: self("or"),
    in: self("in"),
    order: self("order"),
    limit: self("limit"),
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve(op)).then(onFulfilled, onRejected),
  });
  return chain;
}

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => builder(table) }),
}));

const sendOrderStatusEmail = vi.fn(async (_id: string, _kind: string) => ({ status: "sent" as const }));
vi.mock("../api/_lib/orderStatusEmail.js", () => ({
  sendOrderStatusEmail: (id: string, kind: string) => sendOrderStatusEmail(id, kind),
}));

const loadTracker = vi.fn();
vi.mock("../api/_lib/easypost.js", async (importActual) => {
  const actual = await importActual<typeof import("../api/_lib/easypost.js")>();
  return {
    deliveredAtOf: actual.deliveredAtOf,
    isEasyPostConnected: () => state.connected,
    loadTracker: (...args: unknown[]) => loadTracker(...args),
  };
});

const { runShippingUpdates, dueForTrackingCheckFilter } = await import("../api/_lib/shippingUpdates.js");

function trackedOrder(overrides: Row = {}): Row {
  return {
    id: "order-1",
    tracking_number: "9400111899223344556677",
    tracking_carrier: "USPS",
    easypost_tracker_id: "trk_1",
    easypost_shipment_id: "shp_1",
    tracking_status: "in_transit",
    tracking_checked_at: iso(NOW - 2 * 60 * 60 * 1000),
    ...overrides,
  };
}

async function run() {
  return runShippingUpdates({ timeBudgetMs: 30_000, now: NOW });
}

beforeEach(() => {
  state.connected = true;
  state.tracked = [];
  state.pwe = [];
  state.sentKeys = [];
  state.claimedElsewhere = new Set();
  state.updates = [];
  sendOrderStatusEmail.mockClear();
  loadTracker.mockReset();
});

describe("tracked orders", () => {
  it("marks a delivered order delivered and emails the customer", async () => {
    state.tracked = [trackedOrder()];
    loadTracker.mockResolvedValue({
      created: false,
      tracker: {
        id: "trk_1",
        status: "delivered",
        tracking_details: [
          { status: "in_transit", datetime: "2026-10-07T10:00:00Z" },
          { status: "delivered", datetime: "2026-10-09T15:12:00Z" },
        ],
      },
    });

    const summary = await run();

    expect(summary).toMatchObject({ checked: 1, delivered: 1, emailFailures: 0 });
    const delivered = state.updates.find((u) => u.payload.status === "delivered");
    expect(delivered?.payload).toMatchObject({
      tracking_status: "delivered",
      delivered_at: "2026-10-09T15:12:00.000Z",
    });
    // Only a still-shipped order moves on (no double emails on a retry).
    expect(delivered?.filters).toContainEqual(["eq", "status", "shipped"]);
    expect(sendOrderStatusEmail).toHaveBeenCalledWith("order-1", "delivered");
  });

  it("only records the status while it's still on the way", async () => {
    state.tracked = [trackedOrder()];
    loadTracker.mockResolvedValue({ created: false, tracker: { id: "trk_1", status: "out_for_delivery" } });

    const summary = await run();

    expect(summary).toMatchObject({ checked: 1, delivered: 0 });
    expect(state.updates.at(-1)?.payload).toEqual({ easypost_tracker_id: "trk_1", tracking_status: "out_for_delivery" });
    expect(sendOrderStatusEmail).not.toHaveBeenCalled();
  });

  it("creates a tracker once for a tracking number typed in by hand", async () => {
    state.tracked = [
      trackedOrder({ easypost_tracker_id: null, easypost_shipment_id: null, tracking_status: null, tracking_checked_at: null }),
    ];
    loadTracker.mockResolvedValue({ created: true, tracker: { id: "trk_new", status: "pre_transit" } });

    const summary = await run();

    expect(loadTracker).toHaveBeenCalledWith({
      trackerId: null,
      shipmentId: null,
      trackingNumber: "9400111899223344556677",
      carrier: "USPS",
    });
    expect(summary.trackersCreated).toBe(1);
    expect(state.updates.at(-1)?.payload).toMatchObject({ easypost_tracker_id: "trk_new" });
  });

  it("leaves an order alone when another run already claimed it", async () => {
    state.tracked = [trackedOrder()];
    state.claimedElsewhere.add("order-1");

    const summary = await run();

    expect(loadTracker).not.toHaveBeenCalled();
    expect(summary.checked).toBe(0);
  });

  it("marks a number EasyPost can't track as an error and moves on", async () => {
    state.tracked = [trackedOrder({ id: "bad" }), trackedOrder({ id: "good" })];
    loadTracker
      .mockRejectedValueOnce(new Error("Invalid tracking number"))
      .mockResolvedValueOnce({ created: false, tracker: { id: "trk_1", status: "in_transit" } });

    const summary = await run();

    expect(summary).toMatchObject({ trackingErrors: 1, checked: 1 });
    expect(state.updates.find((u) => u.id === "bad" && u.payload.tracking_status === "error")).toBeTruthy();
  });

  it("retries an untrackable number once a day, not every hour", async () => {
    state.tracked = [trackedOrder({ tracking_status: "error", tracking_checked_at: iso(NOW - 3 * 60 * 60 * 1000) })];

    await run();

    expect(loadTracker).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });

  it("leaves untrackable numbers out of the query itself, so they can't crowd out a batch", () => {
    // Checked 50+ minutes ago (or never), except errors: a day.
    expect(dueForTrackingCheckFilter(NOW)).toBe(
      "tracking_checked_at.is.null," +
        'tracking_checked_at.lt."2026-10-08T18:00:00.000Z",' +
        'and(tracking_checked_at.lt."2026-10-09T17:10:00.000Z",or(tracking_status.is.null,tracking_status.neq.error))',
    );
  });

  it("claims an order by the same rule it was picked by", async () => {
    state.tracked = [trackedOrder()];
    loadTracker.mockResolvedValue({ created: false, tracker: { id: "trk_1", status: "in_transit" } });

    await run();

    const claim = state.updates.find((u) => Object.keys(u.payload).join() === "tracking_checked_at");
    expect(claim?.filters).toContainEqual(["or", dueForTrackingCheckFilter(NOW)]);
    expect(claim?.filters).toContainEqual(["eq", "status", "shipped"]);
  });

  it("skips tracking entirely until EasyPost is connected, but still checks in on PWE orders", async () => {
    state.connected = false;
    state.tracked = [trackedOrder()];
    state.pwe = [{ id: "pwe-1", shipped_at: iso(NOW - 8 * DAY) }];

    const summary = await run();

    expect(summary.trackingConnected).toBe(false);
    expect(loadTracker).not.toHaveBeenCalled();
    expect(sendOrderStatusEmail).toHaveBeenCalledWith("pwe-1", "arrival_check");
  });
});

describe("Plain White Envelope check-ins", () => {
  it("emails once the envelope should have arrived, and not before", async () => {
    state.pwe = [
      { id: "due", shipped_at: iso(NOW - 8 * DAY) },
      { id: "too-soon", shipped_at: iso(NOW - 3 * DAY) },
    ];

    const summary = await run();

    expect(sendOrderStatusEmail).toHaveBeenCalledTimes(1);
    expect(sendOrderStatusEmail).toHaveBeenCalledWith("due", "arrival_check");
    expect(summary.arrivalChecksSent).toBe(1);
  });

  it("doesn't retry one that was already sent", async () => {
    state.pwe = [{ id: "done", shipped_at: iso(NOW - 8 * DAY) }];
    state.sentKeys = ["order-arrival_check-done"];

    await run();

    expect(sendOrderStatusEmail).not.toHaveBeenCalled();
  });

  it("skips a check-in that's more than a week overdue", async () => {
    state.pwe = [{ id: "old", shipped_at: iso(NOW - 20 * DAY) }];

    await run();

    expect(sendOrderStatusEmail).not.toHaveBeenCalled();
  });
});
