import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// "Notify me if it's released" (api/stock-alerts/hold-watch.ts) and the
// worker that sends it and the restock alerts (api/stock-alerts/process.ts).

let state: FakeState;
const sent: { emailType: string; idempotencyKey: string; to: string; subject: string; text: string }[] = [];
let failSend = false;

vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));
vi.mock("../api/_lib/rateLimit.js", () => ({
  checkRateLimit: () => ({ allowed: true }),
  getClientIp: () => "203.0.113.9",
}));
vi.mock("../api/_lib/emailService.js", () => ({
  sendTrackedEmail: async (args: { emailType: string; idempotencyKey: string; to: string; subject: string; text: string }) => {
    if (failSend) return { status: "failed", error: "down", deduped: false };
    sent.push(args);
    return { status: "sent", resendEmailId: "re_1", deduped: false };
  },
}));
process.env.PUBLIC_SITE_URL = "https://geega-games.com";

const { default: watchHandler } = await import("../api/stock-alerts/hold-watch.ts");
const { default: processHandler, heldCopyLabel, restockKey } = await import("../api/stock-alerts/process.ts");

const ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function watch(body: Record<string, unknown>, token?: string) {
  const res = fakeResponse();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  await watchHandler({ method: "POST", headers, body } as never, res as never);
  return res as typeof res & { body: { ok: boolean; status?: string; message?: string } };
}
async function runWorker() {
  const res = fakeResponse();
  await processHandler({ method: "POST", headers: {} } as never, res as never);
  return res as typeof res & { body: Record<string, unknown> };
}

let heldRows: Record<string, unknown>[];
beforeEach(() => {
  state = createFakeState();
  sent.length = 0;
  failSend = false;
  heldRows = [{ id: ITEM, card_name: "Mox Diamond", held_quantity: 1, sellable_quantity: 0 }];
  state.unique.trade_hold_watchers = [{ columns: ["inventory_item_id", "email"] }];
  state.tables.trade_hold_watchers = [];
  state.tables.inventory_items = [
    { id: ITEM, status: "active", quantity: 1 },
    { id: OTHER, status: "active", quantity: 2 },
  ];
  state.rpc.trade_held_copies = (args) => ({
    data: heldRows.filter((r) => (args.p_ids as string[]).includes(r.id as string)),
    error: null,
  });
});

describe("POST /api/stock-alerts/hold-watch", () => {
  it("saves a guest's email for a held copy", async () => {
    const res = await watch({ inventoryItemId: ITEM, email: " Shopper@Example.com " });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, status: "watching" });
    expect(state.tables.trade_hold_watchers).toHaveLength(1);
    expect(state.tables.trade_hold_watchers[0]).toMatchObject({
      inventory_item_id: ITEM, card_name: "Mox Diamond", email: "shopper@example.com", user_id: null, notified_at: null, closed_at: null,
    });
  });

  it("uses a signed-in shopper's account email, not what the page sent", async () => {
    state.sessions.tok = { id: "11111111-1111-4111-8111-111111111111", email: "member@example.com", app_metadata: {} };
    const res = await watch({ inventoryItemId: ITEM, email: "someone-else@example.com" }, "tok");
    expect(res.body.status).toBe("watching");
    expect(state.tables.trade_hold_watchers[0]).toMatchObject({ email: "member@example.com", user_id: "11111111-1111-4111-8111-111111111111" });
  });

  it("asking again re-arms the same row instead of adding one", async () => {
    await watch({ inventoryItemId: ITEM, email: "a@example.com" });
    state.tables.trade_hold_watchers[0].notified_at = "2026-10-01T00:00:00Z";
    await watch({ inventoryItemId: ITEM, email: "a@example.com" });
    expect(state.tables.trade_hold_watchers).toHaveLength(1);
    expect(state.tables.trade_hold_watchers[0].notified_at).toBeNull();
  });

  it("says when nothing is holding it any more, and saves nothing", async () => {
    heldRows = [];
    const res = await watch({ inventoryItemId: OTHER, email: "a@example.com" });
    expect(res.body).toEqual({ ok: true, status: "available" });
    heldRows = [{ id: ITEM, card_name: "Mox Diamond", held_quantity: 1, sellable_quantity: 1 }];
    expect((await watch({ inventoryItemId: ITEM, email: "a@example.com" })).body.status).toBe("available");
    expect(state.tables.trade_hold_watchers).toHaveLength(0);
  });

  it("refuses a copy that's gone, a bad id or email; the honeypot saves nothing", async () => {
    heldRows = [];
    state.tables.inventory_items[0].quantity = 0;
    expect((await watch({ inventoryItemId: ITEM, email: "a@example.com" })).statusCode).toBe(404);
    expect((await watch({ inventoryItemId: "nope", email: "a@example.com" })).statusCode).toBe(400);
    heldRows = [{ id: ITEM, card_name: "Mox Diamond", held_quantity: 1, sellable_quantity: 0 }];
    expect((await watch({ inventoryItemId: ITEM, email: "not-an-email" })).statusCode).toBe(400);
    const bot = await watch({ inventoryItemId: ITEM, email: "a@example.com", website: "spam" });
    expect(bot.body.ok).toBe(true);
    expect(state.tables.trade_hold_watchers).toHaveLength(0);
  });
});

describe("the stock-alert worker", () => {
  beforeEach(() => {
    state.tables.card_stock_subscriptions = [];
    state.rpc.wishlist_card_state = () => ({ data: [{ in_stock: false, min_price_cents: null, on_deal: false }], error: null });
    state.rpc.trade_hold_watchers_due = () => ({ data: [], error: null });
  });

  it("emails a watcher once when the held copy is released, linking to that copy", async () => {
    state.tables.trade_hold_watchers = [{ id: "w1", inventory_item_id: ITEM, email: "a@example.com", notified_at: null, closed_at: null }];
    state.rpc.trade_hold_watchers_due = () => ({
      data: [{ id: "w1", inventory_item_id: ITEM, email: "a@example.com", card_name: "Mox Diamond", set_name: "Tempest",
               condition: "LP", finish: "foil", state: "released", armed_at: "2026-10-30T12:00:00Z" }],
      error: null,
    });
    const res = await runWorker();
    expect(res.statusCode).toBe(200);
    expect(res.body.held).toEqual({ sent: 1, closed: 0, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ emailType: "trade_hold_released", to: "a@example.com", subject: "Mox Diamond is available again — Geega Games" });
    expect(sent[0].idempotencyKey).toBe(`trade-hold-released-w1-${Date.parse("2026-10-30T12:00:00Z")}`);
    expect(sent[0].text).toContain(`https://geega-games.com/shop/card/mox-diamond?listing=${ITEM}`);
    expect(sent[0].text).toContain("Tempest · Lightly Played · Foil");
    expect(state.tables.trade_hold_watchers[0].notified_at).toBeTruthy();
  });

  it("closes a watcher quietly when the copy is gone or it expired; a failed send stays pending", async () => {
    state.tables.trade_hold_watchers = [
      { id: "g", notified_at: null, closed_at: null },
      { id: "r", notified_at: null, closed_at: null },
    ];
    state.rpc.trade_hold_watchers_due = () => ({
      data: [
        { id: "g", inventory_item_id: ITEM, email: "g@example.com", card_name: "X", set_name: null, condition: null, finish: null, state: "gone", armed_at: "2026-10-01T00:00:00Z" },
        { id: "r", inventory_item_id: ITEM, email: "r@example.com", card_name: "X", set_name: null, condition: null, finish: null, state: "released", armed_at: "2026-10-01T00:00:00Z" },
      ],
      error: null,
    });
    failSend = true;
    const res = await runWorker();
    expect(res.body.held).toEqual({ sent: 0, closed: 1, failed: 1 });
    const by = Object.fromEntries(state.tables.trade_hold_watchers.map((w) => [w.id, w]));
    expect(by.g).toMatchObject({ closed_reason: "gone", notified_at: null });
    expect(by.g.closed_at).toBeTruthy();
    expect(by.r).toMatchObject({ closed_at: null, notified_at: null });
  });

  it("a restock alert waits while every copy is held (for a trade or anything else)", async () => {
    state.tables.card_stock_subscriptions = [
      { id: "s1", oracle_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", card_name: "Sol Ring", email: "s@example.com", notified_at: null, created_at: "2026-10-30T00:00:00Z" },
    ];
    let res = await runWorker();
    expect(res.body).toMatchObject({ processed: 1, sent: 0, stillOut: 1 });
    expect(sent).toHaveLength(0);
    state.rpc.wishlist_card_state = () => ({ data: [{ in_stock: true, min_price_cents: 150, on_deal: false }], error: null });
    res = await runWorker();
    expect(res.body).toMatchObject({ sent: 1, stillOut: 0 });
    expect(sent[0].idempotencyKey).toBe(restockKey("s1", "2026-10-30T00:00:00Z"));
    expect(state.tables.card_stock_subscriptions[0].notified_at).toBeTruthy();
  });

  it("a restock request made again after an email gets its own email", () => {
    expect(restockKey("s1", "2026-10-30T00:00:00Z")).not.toBe(restockKey("s1", "2026-11-02T00:00:00Z"));
  });

  it("keeps sending restock alerts if the held-copy queue isn't there yet", async () => {
    delete state.rpc.trade_hold_watchers_due;
    const res = await runWorker();
    expect(res.statusCode).toBe(200);
    expect(res.body.held).toBeNull();
  });

  it("labels a copy for the email", () => {
    expect(heldCopyLabel({ set_name: "Tempest", condition: "NM", finish: "nonfoil" })).toBe("Tempest · Near Mint");
    expect(heldCopyLabel({ set_name: null, condition: null, finish: "etched" })).toBe("Etched foil");
  });
});
