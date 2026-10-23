import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScryfallCard } from "../src/admin/services/scryfall.types";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// PATCH /api/admin/inventory/:id — "Save changes" in the Edit drawer. The
// drawer always sends the condition and finish, so every save goes through
// the identity checks. inventory_items.foil is a generated column (the
// database works it out from the finish) and Postgres refuses any value for
// it, so writing it made every save fail with "Could not save the inventory
// changes."

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
let printing: ScryfallCard | null = null;
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));
vi.mock("../api/_lib/scryfall.js", () => ({ scryfallResolveExact: async () => printing }));

const { default: handler } = await import("../api/admin/inventory/[id].ts");

const TOKEN = "staff-token";
const BOLT = "33333333-3333-4333-8333-333333333333";
const ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";

function line(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    scryfall_id: BOLT,
    oracle_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    card_name: "Lightning Bolt",
    set_code: "M10",
    set_name: "Magic 2010",
    collector_number: "146",
    rarity: "common",
    type_line: "Instant",
    image_url: "https://img/bolt.jpg",
    condition: "NM",
    finish: "nonfoil",
    foil: false,
    variant_type: "",
    language: "en",
    quantity: 2,
    status: "active",
    price_cents: 300,
    cost_cents: null,
    scryfall_price_cents: 150,
    storage_location: null,
    sku: null,
    notes: null,
    is_deal: false,
    original_price_cents: null,
    deal_source: null,
    deal_note: null,
    deal_discount_percent: null,
    deal_started_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  state = createFakeState();
  state.sessions[TOKEN] = { id: "staff-1", email: "jacob@example.com", app_metadata: { role: "staff" } };
  // As in the database: foil follows the finish, and uq_inventory_sku keeps
  // one line per printing, condition, finish, variant and language
  // (archived lines included).
  state.generated.inventory_items = { foil: (row) => row.finish !== "nonfoil" };
  state.unique.inventory_items = [{ columns: ["scryfall_id", "condition", "finish", "variant_type", "language"] }];
  state.tables.inventory_items = [line(ITEM)];
  state.tables.card_printings = [];
  state.tables.admin_audit_log = [];
  printing = {
    object: "card",
    id: BOLT,
    name: "Lightning Bolt",
    lang: "en",
    layout: "normal",
    set: "m10",
    set_name: "Magic 2010",
    collector_number: "146",
    rarity: "common",
    type_line: "Instant",
    finishes: ["nonfoil", "foil"],
    prices: { usd: "1.50", usd_foil: "4.00" },
  } as ScryfallCard;
});

/** What the Edit drawer sends: everything on the form, condition and finish included. */
function drawer(overrides: Record<string, unknown> = {}) {
  return {
    condition: "NM",
    finish: "nonfoil",
    variantType: "",
    priceCents: 300,
    costCents: null,
    storageLocation: null,
    sku: null,
    notes: null,
    actor: "Jacob",
    ...overrides,
  };
}

async function save(id: string, body: Record<string, unknown>) {
  const res = fakeResponse();
  await handler(
    { method: "PATCH", headers: { authorization: `Bearer ${TOKEN}` }, query: { id }, body } as never,
    res as never,
  );
  return res as typeof res & { body: Record<string, unknown> };
}

const row = (id: string) => state.tables.inventory_items.find((r) => r.id === id) as Record<string, unknown>;

describe("PATCH /api/admin/inventory/:id (the Edit drawer)", () => {
  it("saves a price and storage change", async () => {
    const res = await save(ITEM, drawer({ priceCents: 450, storageLocation: "Binder 2" }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ price_cents: 450, storage_location: "Binder 2" });
    expect(row(ITEM)).toMatchObject({ price_cents: 450, storage_location: "Binder 2", condition: "NM", finish: "nonfoil", foil: false });
    // Recorded with what changed.
    expect(state.tables.admin_audit_log.at(-1)).toMatchObject({
      action: "inventory.update",
      before: expect.objectContaining({ price_cents: 300 }),
      after: expect.objectContaining({ price_cents: 450 }),
    });
  });

  it("changes the condition and finish, leaving foil to the database", async () => {
    const res = await save(ITEM, drawer({ condition: "MP", finish: "foil" }));
    expect(res.statusCode).toBe(200);
    expect(row(ITEM)).toMatchObject({ condition: "MP", finish: "foil", foil: true });
    const updates = state.writes.filter((w) => w.table === "inventory_items" && w.op === "update");
    expect(updates.map((w) => w.payload)).not.toContainEqual(expect.objectContaining({ foil: expect.anything() }));
  });

  it("edits an artist proof kept next to a regular copy of the same printing", async () => {
    state.tables.inventory_items = [line(ITEM), line(OTHER, { variant_type: "Artist Proof", price_cents: 2500 })];
    const res = await save(OTHER, drawer({ variantType: "Artist Proof", priceCents: 3000 }));
    expect(res.statusCode).toBe(200);
    expect(row(OTHER)).toMatchObject({ price_cents: 3000, variant_type: "Artist Proof" });
  });

  it("still refuses a change that would duplicate another line", async () => {
    state.tables.inventory_items = [line(ITEM), line(OTHER, { condition: "MP" })];
    const res = await save(ITEM, drawer({ condition: "MP" }));
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe(
      "This exact printing, condition, and finish already exists in inventory. Adjust the existing inventory line instead.",
    );
    expect(row(ITEM)).toMatchObject({ condition: "NM" });
  });

  it("points at an archived line that already has that printing, condition and finish", async () => {
    state.tables.inventory_items = [line(ITEM), line(OTHER, { condition: "MP", status: "archived" })];
    const res = await save(ITEM, drawer({ condition: "MP" }));
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe(
      "An archived inventory line already has this exact printing, condition, and finish. Restore that line instead.",
    );
    expect(row(ITEM)).toMatchObject({ condition: "NM" });
  });
});
