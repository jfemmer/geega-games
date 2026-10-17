import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// POST /api/admin/scan-sessions/:id/approve — Quick approve: confirm many
// cards' printings, fill finish / price / condition / location the way
// approving one card does, and add them to inventory, in one request.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const { default: handler } = await import("../api/admin/scan-sessions/[id]/approve.ts");

const TOKEN = "staff-token";
const SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION = "22222222-2222-4222-8222-222222222222";
const JAVELIN = "33333333-3333-4333-8333-333333333333";
const JAVELIN_LIST = "44444444-4444-4444-8444-444444444444";
const NO_PRICE = "55555555-5555-4555-8555-555555555555";
const scanId = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;

function card(id: string, overrides: Record<string, unknown> = {}) {
  return {
    object: "card",
    id,
    oracle_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    name: "Lightning Javelin",
    set: "ori",
    set_name: "Magic Origins",
    collector_number: "153",
    rarity: "common",
    layout: "normal",
    lang: "en",
    type_line: "Instant",
    released_at: "2015-07-17",
    image_uris: { small: `https://img/${id}-s.jpg`, normal: `https://img/${id}.jpg` },
    finishes: ["nonfoil", "foil"],
    prices: { usd: "0.12", usd_foil: "0.60", usd_etched: null },
    ...overrides,
  };
}

const CARDS: Record<string, ReturnType<typeof card>> = {
  [JAVELIN]: card(JAVELIN),
  [JAVELIN_LIST]: card(JAVELIN_LIST, { set: "plst", set_name: "The List", collector_number: "ORI-153", prices: { usd: "0.45", usd_foil: null, usd_etched: null }, finishes: ["nonfoil"] }),
  [NO_PRICE]: card(NO_PRICE, { name: "Promo Thing", set: "pxyz", collector_number: "1", prices: { usd: null, usd_foil: null, usd_etched: null }, finishes: ["nonfoil"] }),
};

let collectionCalls: string[][] = [];

function scanRow(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: scanId(n),
    scan_session_id: SESSION,
    sequence_number: n,
    selected_scryfall_id: null,
    selected_finish: null,
    confirmed_condition: null,
    price_cents: null,
    cost_cents: null,
    quantity: 1,
    storage_location: null,
    notes: null,
    review_status: "needs_manual_match",
    recognition_status: "low_confidence",
    recognition_data: { finishGuess: "nonfoil" },
    inventory_item_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  state = createFakeState();
  collectionCalls = [];
  state.sessions[TOKEN] = { id: "staff-1", email: "jacob@example.com", app_metadata: { role: "staff" } };
  state.tables.scan_sessions = [{ id: SESSION }, { id: OTHER_SESSION }];
  state.tables.inventory_price_floors = [{ rarity: "common", min_price_cents: 25, updated_at: "2026-10-01T00:00:00Z", updated_by: null }];
  state.tables.inventory_items = [];
  state.tables.card_printings = [];
  state.rpc.recompute_scan_session = () => ({ data: {}, error: null });
  let inventoryId = 0;
  state.rpc.admin_upsert_inventory = (args) => {
    inventoryId++;
    state.tables.inventory_items.push({ id: `inv-${inventoryId}`, status: "active", ...args });
    return { data: { id: `inv-${inventoryId}` }, error: null };
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://api.scryfall.com/cards/collection") {
        const ids = (JSON.parse(String(init?.body)) as { identifiers: { id: string }[] }).identifiers.map((i) => i.id);
        collectionCalls.push(ids);
        return new Response(JSON.stringify({ object: "list", not_found: [], data: ids.filter((id) => CARDS[id]).map((id) => CARDS[id]) }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});

async function post(body: unknown, session = SESSION) {
  const res = fakeResponse();
  await handler(
    { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, query: { id: session }, body } as never,
    res as never,
  );
  return res as typeof res & { body: Record<string, unknown> };
}

const scan = (n: number) => state.tables.card_scans.find((s) => s.id === scanId(n)) as Record<string, unknown>;
const upserts = () => state.tables.inventory_items as Record<string, unknown>[];

describe("POST /api/admin/scan-sessions/:id/approve", () => {
  it("approves and adds a batch in one go, with one Scryfall lookup for the lot", async () => {
    state.tables.card_scans = [
      scanRow(1, { selected_scryfall_id: JAVELIN, review_status: "matched", recognition_status: "recognized" }),
      scanRow(2, { recognition_data: { finishGuess: "foil" } }),
    ];
    const res = await post({
      items: [
        { scanId: scanId(1), scryfallId: JAVELIN },
        { scanId: scanId(2), scryfallId: JAVELIN },
      ],
      condition: "LP",
      storageLocation: "  Box 3 ",
      addToInventory: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ approvedCount: 2, addedCount: 2, createdCount: 2, incrementedCount: 0, failures: [] });
    expect(collectionCalls).toEqual([[JAVELIN]]);
    // Non-foil $0.12 raised to the 25¢ common floor; the foil batch's card at $0.60.
    expect(scan(1)).toMatchObject({ review_status: "added", inventory_item_id: "inv-1", confirmed_condition: "LP", selected_finish: "nonfoil", price_cents: 25, storage_location: "Box 3" });
    expect(scan(2)).toMatchObject({ review_status: "added", selected_scryfall_id: JAVELIN, selected_finish: "foil", price_cents: 60 });
    expect(upserts().map((u) => [u.p_condition, u.p_finish, u.p_price_cents, u.p_reason])).toEqual([
      ["LP", "nonfoil", 25, "batch_scan_add"],
      ["LP", "foil", 60, "batch_scan_add"],
    ]);
    expect(state.tables.card_printings).toHaveLength(1);
  });

  it("never overwrites what staff already set", async () => {
    state.tables.card_scans = [
      scanRow(1, { selected_scryfall_id: JAVELIN, review_status: "matched", confirmed_condition: "NM", price_cents: 999, storage_location: "Binder" }),
    ];
    await post({ items: [{ scanId: scanId(1), scryfallId: JAVELIN }], condition: "HP", storageLocation: "Box 3", addToInventory: true });
    expect(scan(1)).toMatchObject({ confirmed_condition: "NM", price_cents: 999, storage_location: "Binder", review_status: "added" });
  });

  it("re-prices a card switched to another printing", async () => {
    // Matched to The List's copy (priced for that), confirmed as the original.
    state.tables.card_scans = [scanRow(1, { selected_scryfall_id: JAVELIN_LIST, review_status: "matched", price_cents: 45 })];
    await post({ items: [{ scanId: scanId(1), scryfallId: JAVELIN }], condition: "NM", addToInventory: false });
    expect(scan(1)).toMatchObject({ selected_scryfall_id: JAVELIN, price_cents: 25, review_status: "ready" });
    expect(upserts()).toHaveLength(0);
  });

  it("uses a price typed in Quick approve", async () => {
    state.tables.card_scans = [scanRow(1)];
    const res = await post({ items: [{ scanId: scanId(1), scryfallId: NO_PRICE, priceCents: 150 }], condition: "NM", addToInventory: true });
    expect(res.body).toMatchObject({ addedCount: 1, failures: [] });
    expect(scan(1)).toMatchObject({ price_cents: 150, review_status: "added" });
  });

  it("reports cards it can't approve and leaves them as they were, approving the rest", async () => {
    state.tables.card_scans = [
      scanRow(1),
      scanRow(2, { review_status: "rejected" }),
      scanRow(3, { scan_session_id: OTHER_SESSION }),
      scanRow(4),
      scanRow(5, { review_status: "added", inventory_item_id: "inv-0" }),
    ];
    const res = await post({
      items: [1, 2, 3, 4, 5].map((n) => ({ scanId: scanId(n), scryfallId: n === 1 ? NO_PRICE : JAVELIN })),
      condition: "NM",
      addToInventory: true,
    });
    expect(res.statusCode).toBe(200);
    const failures = res.body.failures as { scanId: string; sequenceNumber: number; reason: string }[];
    expect(failures.map((f) => [f.sequenceNumber, f.reason])).toEqual([
      [1, "No Scryfall price for this printing — enter a selling price before approving."],
      [2, "This card was rejected — open it in review to change that."],
      [0, "This card isn't in this session any more."],
    ]);
    expect(res.body).toMatchObject({ approvedCount: 1, addedCount: 1 });
    expect(scan(1)).toMatchObject({ review_status: "needs_manual_match", selected_scryfall_id: null, price_cents: null });
    expect(scan(4)).toMatchObject({ review_status: "added" });
    // The card that was already in inventory isn't added again.
    expect(upserts()).toHaveLength(1);
  });

  it("keeps a card ready when adding it fails, saying why", async () => {
    state.tables.card_scans = [scanRow(1)];
    state.rpc.admin_upsert_inventory = () => ({ data: null, error: { message: "inventory is locked" } });
    const res = await post({ items: [{ scanId: scanId(1), scryfallId: JAVELIN }], condition: "NM", addToInventory: true });
    expect(res.body).toMatchObject({ approvedCount: 1, addedCount: 0, failures: [{ sequenceNumber: 1, reason: "inventory is locked" }] });
    expect(scan(1)).toMatchObject({ review_status: "ready" });
  });

  it("checks what it's sent", async () => {
    state.tables.card_scans = [scanRow(1)];
    const many = Array.from({ length: 26 }, (_, i) => ({ scanId: scanId(i + 1), scryfallId: JAVELIN }));
    expect((await post({ items: many, condition: "NM", addToInventory: true })).statusCode).toBe(400);
    expect((await post({ items: [{ scanId: scanId(1), scryfallId: JAVELIN }], condition: "Mint", addToInventory: true })).statusCode).toBe(400);
    const twice = [{ scanId: scanId(1), scryfallId: JAVELIN }, { scanId: scanId(1), scryfallId: JAVELIN }];
    expect((await post({ items: twice, condition: "NM", addToInventory: true })).statusCode).toBe(400);
    expect((await post({ items: [{ scanId: "nope", scryfallId: JAVELIN }], condition: "NM", addToInventory: true })).statusCode).toBe(400);
    expect((await post({ items: [{ scanId: scanId(1), scryfallId: JAVELIN, priceCents: -5 }], condition: "NM", addToInventory: true })).statusCode).toBe(400);
    expect(scan(1)).toMatchObject({ review_status: "needs_manual_match" });
  });

  it("is staff only", async () => {
    const res = fakeResponse();
    await handler({ method: "POST", headers: {}, query: { id: SESSION }, body: {} } as never, res as never);
    expect(res.statusCode).toBe(401);
  });
});
