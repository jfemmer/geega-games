import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";
import { render } from "@react-email/render";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// Trades from Admin → Trade Evaluator.
//
// /api/admin/trades (staff): confirming works every number out again from
// inventory: the shop's cards at their regular website price, never the deal
// price; only cards for sale and in stock; and never at a price other than
// the one staff showed the customer. Then emailing the link, noting a text,
// and the recent trades list.
//
// /api/trade (public): the customer's link page reads the trade by its
// token, without their phone, email or anything about staff.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

type SentEmail = { emailType: string; idempotencyKey: string; to: string; from: string; subject: string; react: React.ReactElement; text: string };
const sent: SentEmail[] = [];
let emailStatus: "sent" | "failed" = "sent";
vi.mock("../api/_lib/emailService.js", () => ({
  sendTrackedEmail: vi.fn(async (args: SentEmail) => {
    sent.push(args);
    return emailStatus === "sent" ? { status: "sent", resendEmailId: "re_1", deduped: false } : { status: "failed", error: "boom", deduped: false };
  }),
}));

const { default: adminTrades } = await import("../api/admin/trades.ts");
const { default: publicTrade } = await import("../api/trade.ts");
const { TRADE_PRICING_NOTE } = await import("../src/store/lib/trades.ts");

const TOKEN = "staff-token";
const SOL = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const SIGNET = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const MISSING = "aaaaaaaa-aaaa-4aaa-8aaa-000000000009";

function inventoryRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    card_name: "Arcane Signet",
    set_name: "Commander Legends",
    set_code: "cmr",
    collector_number: "297",
    condition: "NM",
    finish: "nonfoil",
    variant_type: "",
    quantity: 3,
    status: "active",
    price_cents: 1000,
    original_price_cents: null,
    is_deal: false,
    ...overrides,
  };
}

async function call(handler: typeof adminTrades, req: Record<string, unknown>) {
  const res = fakeResponse();
  await handler({ headers: {}, query: {}, ...req } as never, res as never);
  return res as typeof res & { body: Record<string, unknown> & { message?: string } };
}

const asStaff = (method: string, body?: Record<string, unknown>) =>
  call(adminTrades, { method, headers: { authorization: `Bearer ${TOKEN}` }, body });

/** Their Rhystic Study at $40 at 70%, for the Sol Ring (on deal; regular $10) and two Signets. */
function confirmBody(overrides: Record<string, unknown> = {}) {
  return {
    action: "confirm",
    customer: { name: " Sam Rivera ", phone: "314-555-0100", email: "Sam@Example.com" },
    creditPercent: 70,
    theirs: [{ name: "Rhystic Study", quantity: 1, tcgLowCents: 4000 }],
    yours: [
      { inventoryItemId: SOL, quantity: 1, priceCents: 1000 },
      { inventoryItemId: SIGNET, quantity: 2, priceCents: 1000 },
    ],
    ...overrides,
  };
}

async function confirmed() {
  const res = await asStaff("POST", confirmBody());
  expect(res.statusCode).toBe(200);
  return res.body.trade as Record<string, unknown> & { id: string; link: string };
}

const tradeRow = () => state.tables.trades[0] as Record<string, unknown>;

beforeEach(() => {
  state = createFakeState();
  state.sessions[TOKEN] = { id: "staff-1", email: "jacob@example.com", app_metadata: { role: "staff" } };
  let next = 1001;
  state.defaults.trades = () => ({
    trade_number: next++,
    confirmed_by: null,
    confirmed_by_email: null,
    emailed_to: null,
    emailed_at: null,
    texted_to: null,
    texted_at: null,
  });
  state.unique.trades = [{ columns: ["share_token"] }];
  state.tables.trades = [];
  state.tables.admin_audit_log = [];
  state.tables.inventory_items = [
    inventoryRow(SOL, { card_name: "Sol Ring", collector_number: "263", quantity: 1, price_cents: 800, original_price_cents: 1000, is_deal: true }),
    inventoryRow(SIGNET),
  ];
  sent.length = 0;
  emailStatus = "sent";
});

describe("POST /api/admin/trades confirm", () => {
  it("saves the trade with the shop's cards at their regular website price, not the deal price", async () => {
    const trade = await confirmed();
    expect(trade).toMatchObject({
      tradeNumber: 1001,
      customerName: "Sam Rivera",
      customerPhone: "314-555-0100",
      customerEmail: "sam@example.com",
      creditPercent: 70,
      theirCards: [{ name: "Rhystic Study", quantity: 1, tcgLowCents: 4000 }],
      yourCards: [
        { cardName: "Sol Ring", setCode: "cmr", collectorNumber: "263", condition: "NM", finish: "nonfoil", variantType: null, quantity: 1, priceCents: 1000 },
        { cardName: "Arcane Signet", quantity: 2, priceCents: 1000 },
      ],
      theirTcgLowCents: 4000,
      creditCents: 2800,
      yourCardsCents: 3000,
      balanceCents: -200,
      confirmedByEmail: "jacob@example.com",
    });
    expect(trade.link).toMatch(/^https:\/\/geega-games\.com\/trade\?t=[A-Za-z0-9_-]{32,64}$/);
    expect(tradeRow()).toMatchObject({ confirmed_by: "staff-1", balance_cents: -200 });
    expect(String(tradeRow().share_token)).toHaveLength(32);
    // Confirming changes nothing in inventory.
    expect(state.tables.inventory_items.map((r) => r.quantity)).toEqual([1, 3]);
    expect(state.writes.filter((w) => w.table === "inventory_items")).toEqual([]);
    expect(state.tables.admin_audit_log.at(-1)).toMatchObject({ action: "trade.confirm", resource_id: trade.id });
  });

  it("keeps the printing of a card found with the card search, and checks it", async () => {
    const printing = {
      scryfallId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
      setName: "Commander Legends",
      setCode: "cmr",
      collectorNumber: "263",
      condition: "LP",
      finish: "foil",
    };
    const res = await asStaff(
      "POST",
      confirmBody({ theirs: [{ name: "Sol Ring", quantity: 2, tcgLowCents: 325, printing }, { name: null, quantity: 1, tcgLowCents: 100 }] }),
    );
    expect(res.statusCode).toBe(200);
    const stored = { ...printing, scryfallId: printing.scryfallId.toLowerCase() };
    expect((res.body.trade as { theirCards: unknown }).theirCards).toEqual([
      { name: "Sol Ring", quantity: 2, tcgLowCents: 325, printing: stored },
      { name: null, quantity: 1, tcgLowCents: 100, printing: null },
    ]);
    expect(tradeRow().their_cards).toEqual([
      { name: "Sol Ring", quantity: 2, tcgLowCents: 325, printing: stored },
      { name: null, quantity: 1, tcgLowCents: 100, printing: null },
    ]);

    for (const bad of [{ ...printing, condition: "Mint" }, { ...printing, scryfallId: "nope" }, { ...printing, finish: "<b>" }, "Sol Ring"]) {
      const refused = await asStaff("POST", confirmBody({ theirs: [{ name: "Sol Ring", quantity: 1, tcgLowCents: 325, printing: bad }] }));
      expect(refused.statusCode).toBe(400);
      expect(refused.body.message).toBe("One of their cards didn't come through. Try again.");
    }
    expect(state.tables.trades).toHaveLength(1);
  });

  it("needs the customer's name", async () => {
    const res = await asStaff("POST", confirmBody({ customer: { name: "   ", phone: null, email: null } }));
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Enter the customer's name.");
    expect(state.tables.trades).toEqual([]);
  });

  it("refuses a card that isn't for sale, isn't in stock, or is gone from inventory", async () => {
    state.tables.inventory_items[1].status = "archived";
    let res = await asStaff("POST", confirmBody());
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe("Arcane Signet (cmr NM) isn't for sale on the website right now. Take it off the trade.");

    state.tables.inventory_items[1].status = "active";
    res = await asStaff("POST", confirmBody({ yours: [{ inventoryItemId: SOL, quantity: 2, priceCents: 1000 }] }));
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe("Only 1 of Sol Ring (cmr NM) is in stock.");

    res = await asStaff("POST", confirmBody({ yours: [{ inventoryItemId: MISSING, quantity: 1, priceCents: 1000 }] }));
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe("One of your cards isn't in inventory any more. Take it off the trade.");
    expect(state.tables.trades).toEqual([]);
  });

  it("refuses a consigned copy: consigned cards are for sale only, never traded", async () => {
    state.tables.inventory_items = [
      inventoryRow(SOL, { card_name: "Sol Ring", collector_number: "263", price_cents: 1000, ownership: "consigned" }),
      inventoryRow(SIGNET, { ownership: "business" }),
    ];
    const res = await asStaff("POST", confirmBody());
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe("Sol Ring (cmr NM) is a consigned card. Consigned cards are for sale only, not for trade. Take it off the trade.");
    expect(state.tables.trades).toHaveLength(0);
  });

  it("won't confirm at a price other than the one staff showed the customer", async () => {
    // The page showed the Sol Ring at its deal price, or a price from before it changed.
    const res = await asStaff(
      "POST",
      confirmBody({
        yours: [
          { inventoryItemId: SOL, quantity: 1, priceCents: 800 },
          { inventoryItemId: SIGNET, quantity: 1, priceCents: 900 },
        ],
      }),
    );
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe(
      "The website price changed since you added these cards: Sol Ring (cmr NM) is now $10.00, not $8.00; Arcane Signet (cmr NM) is now $10.00, not $9.00. Check the new total with them, then confirm again.",
    );
    expect(state.tables.trades).toEqual([]);
  });

  it("works the price out itself when none is sent", async () => {
    const res = await asStaff("POST", confirmBody({ yours: [{ inventoryItemId: SOL, quantity: 1 }] }));
    expect(res.statusCode).toBe(200);
    expect(res.body.trade).toMatchObject({ yourCardsCents: 1000, balanceCents: 1800 });
  });

  it("refuses what doesn't add up", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ creditPercent: 0 }, "Choose a trade credit from 1 to 150%."],
      [{ creditPercent: 70.5 }, "Choose a trade credit from 1 to 150%."],
      [{ theirs: [{ name: "x", quantity: 1, tcgLowCents: -1 }] }, "One of their cards has a price or quantity that isn't a number."],
      [{ theirs: [{ name: "x", quantity: 0, tcgLowCents: 100 }] }, "One of their cards has a price or quantity that isn't a number."],
      [{ yours: [{ inventoryItemId: "nope", quantity: 1 }] }, "One of your cards didn't come through. Try again."],
      [{ yours: [{ inventoryItemId: SOL, quantity: 1, priceCents: -5 }] }, "One of your cards didn't come through. Try again."],
      [{ theirs: [], yours: [] }, "Add the cards on at least one side of the trade."],
      [{ customer: { name: "Sam", phone: "123" } }, "That phone number doesn't look right."],
      [{ customer: { name: "Sam", email: "sam@" } }, "That email address doesn't look right."],
      [
        { theirs: Array.from({ length: 3 }, () => ({ name: null, quantity: 999, tcgLowCents: 9_999_999 })) },
        "That trade adds up to more than we can save. Check the prices and quantities.",
      ],
    ];
    for (const [overrides, message] of cases) {
      const res = await asStaff("POST", confirmBody(overrides));
      expect(res.statusCode, message).toBe(400);
      expect(res.body.message).toBe(message);
    }
    expect(state.tables.trades).toEqual([]);
  });

  it("is for staff only", async () => {
    const res = await call(adminTrades, { method: "POST", body: confirmBody() });
    expect(res.statusCode).toBe(401);
    state.sessions.shopper = { id: "u2", email: "shopper@example.com", app_metadata: {} };
    const shopper = await call(adminTrades, { method: "GET", headers: { authorization: "Bearer shopper" } });
    expect(shopper.statusCode).toBe(403);
    expect(state.tables.trades).toEqual([]);
  });
});

describe("sending the link", () => {
  it("emails the trade's totals and link, and notes it on the trade", async () => {
    const trade = await confirmed();
    const res = await asStaff("POST", { action: "email", tradeId: trade.id, email: " Sam.R@Example.com " });
    expect(res.statusCode).toBe(200);
    expect(res.body.trade).toMatchObject({ emailedTo: "sam.r@example.com", customerEmail: "sam.r@example.com" });
    expect(tradeRow()).toMatchObject({ emailed_to: "sam.r@example.com", customer_email: "sam.r@example.com" });
    expect(tradeRow().emailed_at).toEqual(expect.any(String));

    expect(sent).toHaveLength(1);
    const email = sent[0];
    expect(email).toMatchObject({ emailType: "trade_summary", to: "sam.r@example.com", subject: "Your trade with Geega Games (#1001)" });
    expect(email.idempotencyKey).toMatch(new RegExp(`^trade-summary-${trade.id}-sam.r@example.com-\\d+$`));
    expect(email.text).toContain("Hi Sam,");
    expect(email.text).toContain("Your cards at TCG low: $40.00");
    expect(email.text).toContain("Trade credit at 70%: $28.00");
    expect(email.text).toContain("Our cards at our regular price: $30.00");
    expect(email.text).toContain("You pay: $2.00");
    expect(email.text).toContain(`Every card and price: ${trade.link}`);
    expect(email.text).toContain(TRADE_PRICING_NOTE);
    const html = await render(email.react);
    expect(html).toContain("See every card and price");
    expect(html).toContain(trade.link.replace(/&/g, "&amp;"));
  });

  it("says so when the email doesn't go out, and doesn't note it", async () => {
    const trade = await confirmed();
    emailStatus = "failed";
    const res = await asStaff("POST", { action: "email", tradeId: trade.id, email: "sam@example.com" });
    expect(res.statusCode).toBe(502);
    expect(res.body.message).toBe("The email didn't send. Try again, or text them the link.");
    expect(tradeRow().emailed_at).toBeNull();
  });

  it("notes a text sent from staff's phone", async () => {
    const trade = await confirmed();
    const res = await asStaff("POST", { action: "texted", tradeId: trade.id, phone: "(314) 555-0199" });
    expect(res.statusCode).toBe(200);
    expect(res.body.trade).toMatchObject({ textedTo: "(314) 555-0199", customerPhone: "(314) 555-0199" });
    expect(tradeRow().texted_at).toEqual(expect.any(String));

    const bad = await asStaff("POST", { action: "texted", tradeId: trade.id, phone: "12" });
    expect(bad.statusCode).toBe(400);
    const unknown = await asStaff("POST", { action: "email", tradeId: "aaaaaaaa-aaaa-4aaa-8aaa-00000000ffff", email: "sam@example.com" });
    expect(unknown.statusCode).toBe(404);
  });
});

describe("GET /api/admin/trades", () => {
  it("lists the newest trades first, with how to reach each customer", async () => {
    await confirmed();
    await asStaff("POST", confirmBody({ customer: { name: "Alex" }, yours: [] }));
    state.tables.trades[1].created_at = new Date(Date.now() + 60_000).toISOString();
    const res = await asStaff("GET");
    expect(res.statusCode).toBe(200);
    const list = res.body.trades as Record<string, unknown>[];
    expect(list.map((t) => t.customerName)).toEqual(["Alex", "Sam Rivera"]);
    expect(list[1]).toMatchObject({ customerPhone: "314-555-0100", customerEmail: "sam@example.com" });
  });
});

describe("GET /api/trade (the customer's link)", () => {
  it("shows the trade as saved, without the customer's contact details or anything about staff", async () => {
    const trade = await confirmed();
    const token = new URL(trade.link).searchParams.get("t")!;
    const res = await call(publicTrade, { method: "GET", query: { t: token } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const view = res.body.trade as Record<string, unknown>;
    expect(view).toMatchObject({
      tradeNumber: 1001,
      customerName: "Sam Rivera",
      creditPercent: 70,
      theirTcgLowCents: 4000,
      creditCents: 2800,
      yourCardsCents: 3000,
      balanceCents: -200,
    });
    expect(Object.keys(view).sort()).toEqual(
      [
        "balanceCents",
        "createdAt",
        "creditCents",
        "creditPercent",
        "customerName",
        "theirCards",
        "theirTcgLowCents",
        "tradeNumber",
        "yourCards",
        "yourCardsCents",
      ].sort(),
    );
    expect(JSON.stringify(view)).not.toMatch(/314-555-0100|sam@example\.com|jacob@example\.com|inventoryItemId/);
  });

  it("can't be found with a wrong or malformed token", async () => {
    await confirmed();
    for (const t of ["b".repeat(32), "short", undefined]) {
      const res = await call(publicTrade, { method: "GET", query: t === undefined ? {} : { t } });
      expect(res.statusCode, String(t)).toBe(404);
      expect(res.body.message).toBe("We couldn't find that trade. Check the link, or ask us to send it again.");
    }
    const post = await call(publicTrade, { method: "POST", query: {} });
    expect(post.statusCode).toBe(405);
  });
});
