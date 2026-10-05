import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScryfallCard } from "../src/admin/services/scryfall.types";

// A "reversible" card is one card printed on both sides. Scryfall gives it no
// top-level oracle id or type line and names it twice ("Steam Vents // Steam
// Vents"). Stored that way it has no oracle id, so its card page says "Card
// not found" and wishlist, deck and stock matching can't see it — which is
// what happened to three cards in the shop.
//
// These check every path that writes a card into inventory: adding it by
// hand, committing a scan, and re-pointing a line at another printing.

const STEAM_VENTS_ORACLE = "17039058-822d-409f-938c-b727a366ba63";

function reversible(): ScryfallCard {
  const face = (side: string) => ({
    name: "Steam Vents",
    oracle_id: STEAM_VENTS_ORACLE,
    type_line: "Land — Island Mountain",
    image_uris: {
      normal: `https://cards.scryfall.io/normal/${side}/e/b/eb96c335.jpg`,
      large: `https://cards.scryfall.io/large/${side}/e/b/eb96c335.jpg`,
    },
  });
  return {
    object: "card",
    id: "eb96c335-9ed3-4f7d-b07a-185ff4044976",
    name: "Steam Vents // Steam Vents",
    lang: "en",
    layout: "reversible_card",
    set: "ecl",
    set_name: "Lorwyn Eclipsed",
    collector_number: "348",
    rarity: "rare",
    finishes: ["nonfoil", "foil"],
    card_faces: [face("front"), face("back")],
    prices: { usd: "13.00" },
  } as ScryfallCard;
}

function transform(): ScryfallCard {
  return {
    object: "card",
    id: "f150d6e9-3da6-4655-9c63-dd34525d08a1",
    oracle_id: "70113003-be5e-406a-9aec-cb480468c36d",
    name: "Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel",
    lang: "en",
    layout: "transform",
    set: "fin",
    set_name: "Final Fantasy",
    collector_number: "382",
    rarity: "mythic",
    type_line: "Legendary Creature — Human Avatar Soldier // Legendary Creature — Angel Nightmare Avatar",
    finishes: ["nonfoil"],
    card_faces: [
      { name: "Sephiroth, Fabled SOLDIER", image_uris: { normal: "https://img/front.jpg" } },
      { name: "Sephiroth, One-Winged Angel", image_uris: { normal: "https://img/back.jpg" } },
    ],
    prices: { usd: "55.00" },
  } as ScryfallCard;
}

const state: {
  card: ScryfallCard | null;
  rpc: { name: string; args: Record<string, unknown> }[];
  cached: Record<string, unknown>[];
} = { card: null, rpc: [], cached: [] };

/** Enough of the service-role client for these code paths. */
function fakeAdmin() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self,
    eq: self,
    limit: self,
    maybeSingle: async () => ({ data: null, error: null }),
    update: () => ({ eq: async () => ({ error: null }) }),
    upsert: async (row: Record<string, unknown>) => {
      state.cached.push(row);
      return { error: null };
    },
  });
  return {
    from: () => chain,
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpc.push({ name, args });
      return { data: { id: "inv-1", ...args }, error: null };
    },
  };
}

vi.mock("../api/_lib/scryfall.js", () => ({
  scryfallResolveExact: async () => state.card,
}));
vi.mock("../api/_lib/adminAuth.js", () => ({
  requireStaff: async () => ({ userId: "staff-1", email: "owner@example.com", role: "admin" }),
}));
vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => fakeAdmin(),
}));

const { printingColumnsFromCard } = await import("../api/_lib/inventory.ts");
const { commitScanToInventory } = await import("../api/_lib/scan.ts");
const { default: addInventory } = await import("../api/admin/inventory/index.ts");

beforeEach(() => {
  state.card = reversible();
  state.rpc = [];
  state.cached = [];
});

const upsertArgs = () => state.rpc.find((call) => call.name === "admin_upsert_inventory")?.args;

async function postAddInventory(body: Record<string, unknown>) {
  const reply = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      reply.status = code;
      return res;
    },
    json(payload: unknown) {
      reply.body = payload;
      return res;
    },
    setHeader() {},
  };
  await addInventory({ method: "POST", headers: { authorization: "Bearer x" }, body } as never, res as never);
  return reply;
}

describe("adding a reversible card by hand (POST /api/admin/inventory)", () => {
  it("stores its oracle id, one name and one type line", async () => {
    const reply = await postAddInventory({
      scryfallId: "eb96c335-9ed3-4f7d-b07a-185ff4044976",
      // What the Add Inventory drawer sent for this printing before the fix.
      cardName: "Steam Vents // Steam Vents",
      cardType: "Land — Island Mountain // Land — Island Mountain",
      condition: "NM",
      finish: "nonfoil",
      quantity: 1,
      priceCents: 1300,
    });

    expect(reply.status).toBe(200);
    expect(upsertArgs()).toMatchObject({
      p_scryfall_id: "eb96c335-9ed3-4f7d-b07a-185ff4044976",
      p_oracle_id: STEAM_VENTS_ORACLE,
      p_card_name: "Steam Vents",
      p_type_line: "Land — Island Mountain",
      p_set_code: "ECL",
      p_collector_number: "348",
      p_image_url: "https://cards.scryfall.io/large/front/e/b/eb96c335.jpg",
    });
  });

  it("caches the printing the same way", async () => {
    await postAddInventory({ scryfallId: "eb96c335-9ed3-4f7d-b07a-185ff4044976", condition: "NM", quantity: 1, priceCents: 1300 });
    expect(state.cached).toHaveLength(1);
    expect(state.cached[0]).toMatchObject({
      oracle_id: STEAM_VENTS_ORACLE,
      card_name: "Steam Vents",
      card_type: "Land — Island Mountain",
      layout: "reversible_card",
    });
  });

  it("leaves a real two-named card exactly as Scryfall names it", async () => {
    state.card = transform();
    await postAddInventory({ scryfallId: "f150d6e9-3da6-4655-9c63-dd34525d08a1", condition: "NM", quantity: 1, priceCents: 5500 });
    expect(upsertArgs()).toMatchObject({
      p_oracle_id: "70113003-be5e-406a-9aec-cb480468c36d",
      p_card_name: "Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel",
      p_type_line: "Legendary Creature — Human Avatar Soldier // Legendary Creature — Angel Nightmare Avatar",
    });
  });

  it("still takes a card that isn't on Scryfall, by the name typed in", async () => {
    state.card = null;
    const reply = await postAddInventory({
      cardName: "Geega Games Playmat",
      cardType: "Accessory",
      setCode: "misc",
      collectorNumber: "1",
      condition: "NM",
      quantity: 2,
      priceCents: 2000,
    });
    expect(reply.status).toBe(200);
    expect(upsertArgs()).toMatchObject({
      p_scryfall_id: null,
      p_oracle_id: null,
      p_card_name: "Geega Games Playmat",
      p_type_line: "Accessory",
    });
  });
});

describe("committing a scanned reversible card", () => {
  const scan = {
    id: "scan-1",
    inventory_item_id: null,
    selected_scryfall_id: "eb96c335-9ed3-4f7d-b07a-185ff4044976",
    selected_finish: "nonfoil",
    confirmed_condition: "NM",
    quantity: 1,
    price_cents: 1300,
    cost_cents: null,
    storage_location: null,
    notes: null,
    review_status: "ready",
  };

  it("stores its oracle id, one name and one type line", async () => {
    const outcome = await commitScanToInventory(fakeAdmin() as never, scan as never, "owner@example.com", "scan_add");

    expect(outcome).toEqual({ outcome: "created", inventoryItemId: "inv-1" });
    expect(upsertArgs()).toMatchObject({
      p_scryfall_id: "eb96c335-9ed3-4f7d-b07a-185ff4044976",
      p_oracle_id: STEAM_VENTS_ORACLE,
      p_card_name: "Steam Vents",
      p_type_line: "Land — Island Mountain",
      p_reason: "scan_add",
    });
  });

  it("leaves a real two-named card exactly as Scryfall names it", async () => {
    state.card = transform();
    await commitScanToInventory(fakeAdmin() as never, scan as never, "owner@example.com", "batch_scan_add");
    expect(upsertArgs()).toMatchObject({
      p_oracle_id: "70113003-be5e-406a-9aec-cb480468c36d",
      p_card_name: "Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel",
    });
  });
});

describe("re-pointing an inventory line at a reversible printing (PATCH)", () => {
  it("writes the same identity columns", () => {
    expect(printingColumnsFromCard(reversible())).toMatchObject({
      scryfall_id: "eb96c335-9ed3-4f7d-b07a-185ff4044976",
      oracle_id: STEAM_VENTS_ORACLE,
      card_name: "Steam Vents",
      type_line: "Land — Island Mountain",
      set_code: "ECL",
      collector_number: "348",
    });
  });
});
