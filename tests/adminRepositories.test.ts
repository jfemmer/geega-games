import { beforeEach, describe, expect, it } from "vitest";
import {
  mockInventoryRepository as inventory,
  mockOrderRepository as orders,
  mockCampaignRepository as campaigns,
  mockUserRepository as users,
  mockAnalyticsRepository as analytics,
  mockInsightsRepository as insights,
  __resetMockState,
} from "../src/admin/repositories/mock";
import { mockScryfallRepository as scryfall } from "../src/admin/repositories/scryfall.mock";

beforeEach(() => {
  __resetMockState();
});

describe("inventory repository", () => {
  it("adjusts quantity through the movement ledger", async () => {
    const page = await inventory.list({ pageSize: 1 });
    const item = page.rows[0];
    const before = item.quantity;

    const updated = await inventory.adjustQuantity(
      item.id,
      3,
      "manual_add",
      "Test Admin",
    );
    expect(updated.quantity).toBe(before + 3);

    const movements = await inventory.movements(item.id);
    expect(movements.length).toBeGreaterThanOrEqual(1);
    const latest = movements[0];
    expect(latest.delta).toBe(3);
    expect(latest.resultingQuantity).toBe(before + 3);
    expect(latest.previousQuantity).toBe(before);
    expect(latest.actor).toBe("Test Admin");
  });

  it("never lets quantity go negative", async () => {
    const page = await inventory.list({ pageSize: 50 });
    const item = page.rows[0];
    const updated = await inventory.adjustQuantity(
      item.id,
      -99999,
      "manual_remove",
      "Test Admin",
    );
    expect(updated.quantity).toBeGreaterThanOrEqual(0);
  });

  it("detects an existing printing/condition/finish match", async () => {
    const page = await inventory.list({ pageSize: 50 });
    const item = page.rows[0];
    const match = await inventory.findMatch(
      item.setCode,
      item.collectorNumber,
      item.condition,
      item.finish,
    );
    expect(match?.id).toBe(item.id);
  });

  it("filters low stock to quantities at or below threshold", async () => {
    const low = await inventory.list({ stock: "low", pageSize: 50 });
    expect(low.rows.every((r) => r.quantity <= 2)).toBe(true);
  });

  it("archives an item without deleting it", async () => {
    const page = await inventory.list({ pageSize: 1 });
    const item = page.rows[0];
    const archived = await inventory.archive(item.id);
    expect(archived.status).toBe("archived");
    const still = await inventory.get(item.id);
    expect(still).not.toBeNull();
  });

  it("restores an archived item back to active", async () => {
    const page = await inventory.list({ pageSize: 1 });
    const item = page.rows[0];
    await inventory.archive(item.id);
    const restored = await inventory.restore(item.id);
    expect(restored.status).toBe("active");
  });
});

describe("inventory state tabs (stock filtering)", () => {
  it("In Stock returns only active rows with quantity > 0", async () => {
    const page = await inventory.list({
      status: "active",
      stock: "in",
      pageSize: 100,
    });
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.every((r) => r.quantity > 0 && r.status === "active")).toBe(
      true,
    );
  });

  it("Out of Stock returns only active rows with quantity exactly 0", async () => {
    const page = await inventory.list({
      status: "active",
      stock: "out",
      pageSize: 100,
    });
    expect(page.rows.every((r) => r.quantity === 0 && r.status === "active")).toBe(
      true,
    );
  });

  it("a card at quantity 0 leaves In Stock and appears in Out of Stock", async () => {
    // Find an in-stock active row and drain it to zero.
    const inStock = await inventory.list({
      status: "active",
      stock: "in",
      pageSize: 100,
    });
    const target = inStock.rows.find((r) => r.status === "active");
    expect(target).toBeTruthy();
    await inventory.adjustQuantity(
      target!.id,
      -target!.quantity,
      "manual_remove",
      "Test Admin",
    );

    const nowIn = await inventory.list({
      status: "active",
      stock: "in",
      pageSize: 100,
    });
    expect(nowIn.rows.some((r) => r.id === target!.id)).toBe(false);

    const nowOut = await inventory.list({
      status: "active",
      stock: "out",
      pageSize: 100,
    });
    expect(nowOut.rows.some((r) => r.id === target!.id)).toBe(true);
  });

  it("restocking an out-of-stock card returns it to In Stock", async () => {
    const out = await inventory.list({
      status: "active",
      stock: "out",
      pageSize: 100,
    });
    // Seed guarantees at least one active, zero-qty row (see inventory.mock).
    const target = out.rows[0];
    expect(target).toBeTruthy();
    await inventory.adjustQuantity(target.id, 3, "manual_add", "Test Admin");

    const nowIn = await inventory.list({
      status: "active",
      stock: "in",
      pageSize: 100,
    });
    expect(nowIn.rows.some((r) => r.id === target.id)).toBe(true);
  });
});

describe("inventory delete", () => {
  it("permanently deletes a deletable line and it can't be fetched after", async () => {
    // Create a fresh, unreferenced line (not one of the protected seed ids).
    const created = await inventory.create(
      {
        scryfallId: null,
        cardName: "Test Delete Card",
        setName: "Test Set",
        setCode: "TST",
        collectorNumber: "999",
        rarity: "common",
        cardType: "Instant",
        imageUrl: null,
        condition: "NM",
        finish: "nonfoil",
        quantity: 1,
        priceCents: 100,
        costCents: null,
        storageLocation: null,
        sku: null,
        notes: null,
        status: "active",
        scryfallPriceCents: null,
      },
      "Test Admin",
    );
    await inventory.delete(created.id);
    const after = await inventory.get(created.id);
    expect(after).toBeNull();
  });

  it("blocks deletion of a historically-referenced line with a clear error", async () => {
    // inv_1 is treated as referenced by an order in the mock.
    await expect(inventory.delete("inv_1")).rejects.toThrow(/archive it instead/i);
    // …and it's still present (not deleted).
    const still = await inventory.get("inv_1");
    expect(still).not.toBeNull();
  });

  it("cascades the movement ledger when a line is deleted", async () => {
    const created = await inventory.create(
      {
        scryfallId: null,
        cardName: "Ledger Cascade Card",
        setName: "Test Set",
        setCode: "TST",
        collectorNumber: "998",
        rarity: "common",
        cardType: "Instant",
        imageUrl: null,
        condition: "NM",
        finish: "nonfoil",
        quantity: 2,
        priceCents: 100,
        costCents: null,
        storageLocation: null,
        sku: null,
        notes: null,
        status: "active",
        scryfallPriceCents: null,
      },
      "Test Admin",
    );
    const before = await inventory.movements(created.id);
    expect(before.length).toBeGreaterThan(0);
    await inventory.delete(created.id);
    const after = await inventory.movements(created.id);
    expect(after.length).toBe(0);
  });
});

describe("inventory edit (printing / condition / finish)", () => {
  it("changes condition without touching quantity", async () => {
    const page = await inventory.list({ status: "active", stock: "in", pageSize: 100 });
    const item = page.rows.find((r) => r.condition !== "LP");
    expect(item).toBeTruthy();
    const qtyBefore = item!.quantity;
    const updated = await inventory.updatePrinting(
      item!.id,
      { condition: "LP" },
      "Test Admin",
    );
    expect(updated.condition).toBe("LP");
    expect(updated.quantity).toBe(qtyBefore);
  });

  it("changes finish without touching quantity", async () => {
    const page = await inventory.list({ status: "active", stock: "in", pageSize: 100 });
    // Pick a nonfoil row and switch to foil.
    const item = page.rows.find((r) => r.finish === "nonfoil");
    expect(item).toBeTruthy();
    const qtyBefore = item!.quantity;
    const updated = await inventory.updatePrinting(
      item!.id,
      { finish: "foil" },
      "Test Admin",
    );
    expect(updated.finish).toBe("foil");
    expect(updated.quantity).toBe(qtyBefore);
  });

  it("changes the exact printing and refreshes denormalized metadata", async () => {
    const page = await inventory.list({ status: "active", stock: "in", pageSize: 100 });
    const item = page.rows[0];
    // Switch to the MH2 extended-art Ragavan printing (cn 492) via set+collector.
    const updated = await inventory.updatePrinting(
      item.id,
      { setCode: "MH2", collectorNumber: "492", cardName: "Ragavan, Nimble Pilferer" },
      "Test Admin",
    );
    expect(updated.collectorNumber).toBe("492");
    expect(updated.cardName).toBe("Ragavan, Nimble Pilferer");
    expect(updated.setCode).toBe("MH2");
  });

  it("rejects a duplicate printing + condition + finish cleanly", async () => {
    // Create two distinct lines, then try to edit one INTO the other's identity.
    const a = await inventory.create(
      {
        scryfallId: "dupe-scryfall-a",
        cardName: "Dupe Card",
        setName: "Test",
        setCode: "TST",
        collectorNumber: "111",
        rarity: "rare",
        cardType: "Instant",
        imageUrl: null,
        condition: "NM",
        finish: "nonfoil",
        quantity: 1,
        priceCents: 100,
        costCents: null,
        storageLocation: null,
        sku: null,
        notes: null,
        status: "active",
        scryfallPriceCents: null,
      },
      "Test Admin",
    );
    await inventory.create(
      {
        scryfallId: "dupe-scryfall-a",
        cardName: "Dupe Card",
        setName: "Test",
        setCode: "TST",
        collectorNumber: "111",
        rarity: "rare",
        cardType: "Instant",
        imageUrl: null,
        condition: "LP",
        finish: "nonfoil",
        quantity: 1,
        priceCents: 100,
        costCents: null,
        storageLocation: null,
        sku: null,
        notes: null,
        status: "active",
        scryfallPriceCents: null,
      },
      "Test Admin",
    );
    // Editing A's condition NM -> LP now collides with the second line.
    await expect(
      inventory.updatePrinting(a.id, { condition: "LP" }, "Test Admin"),
    ).rejects.toThrow(/already exists in inventory/i);
  });
});

describe("order repository", () => {
  async function findPaid() {
    const list = await orders.list({ status: "needs_packing" });
    return list[0];
  }

  it("counts needs_packing as paid orders", async () => {
    const counts = await orders.counts();
    const paid = await orders.list({ status: "needs_packing" });
    expect(counts.needs_packing).toBe(paid.length);
  });

  it("walks an order through the fulfillment workflow", async () => {
    const order = await findPaid();
    expect(order.status).toBe("paid");

    let updated = await orders.setStatus(order.id, "packing", "Test Admin");
    expect(updated.status).toBe("packing");

    for (const item of updated.items) {
      updated = await orders.toggleItemPacked(order.id, item.id);
    }
    expect(updated.items.every((i) => i.packed)).toBe(true);

    updated = await orders.setStatus(order.id, "ready_to_ship", "Test Admin");
    expect(updated.status).toBe("ready_to_ship");

    updated = await orders.ship(order.id, "USPS", "TRACK123", "Test Admin");
    expect(updated.status).toBe("shipped");
    expect(updated.trackingNumber).toBe("TRACK123");
    expect(updated.carrier).toBe("USPS");
    expect(updated.shippedAt).not.toBeNull();
  });

  it("records a shipping email event without real sending", async () => {
    const order = await findPaid();
    const shipped = await orders.ship(order.id, "UPS", "1Z999", "Test Admin");
    const shipEmail = shipped.emails.find((e) =>
      e.emailType.toLowerCase().includes("ship"),
    );
    expect(shipEmail).toBeTruthy();
  });

  it("adds an internal note", async () => {
    const order = await findPaid();
    const updated = await orders.addNote(order.id, "Fragile — double sleeve");
    expect(updated.internalNotes).toContain("double sleeve");
  });
});

describe("campaign repository", () => {
  it("simulates a send without real email", async () => {
    const recipientCount = await campaigns.recipientCount("active_subscribers");
    const draft = await campaigns.save({
      name: "Test blast",
      subject: "Hello",
      previewText: "",
      body: "Body copy",
      buttonText: null,
      buttonUrl: null,
      audience: "active_subscribers",
      status: "draft",
      recipientCount,
      scheduledAt: null,
    });
    const sent = await campaigns.send(draft.id);
    expect(["queued", "sending", "sent"]).toContain(sent.status);
    expect(sent.recipientCount).toBeGreaterThan(0);
    expect(sent.deliveredCount).toBeGreaterThan(0);
  });

  it("returns a recipient count per audience", async () => {
    const count = await campaigns.recipientCount("all_customers");
    expect(count).toBeGreaterThan(0);
  });
});

describe("user repository — staff safeguards", () => {
  it("changes a staff role", async () => {
    const staff = await users.listStaff();
    const nonOwner = staff.find((s) => s.role !== "owner");
    expect(nonOwner).toBeTruthy();
    const updated = await users.setStaffRole(nonOwner!.id, "administrator");
    expect(updated.role).toBe("administrator");
  });

  it("toggles a customer account status", async () => {
    const list = await users.listCustomers({});
    const customer = list[0];
    const disabled = await users.setCustomerStatus(customer.id, "disabled");
    expect(disabled.accountStatus).toBe("disabled");
    const active = await users.setCustomerStatus(customer.id, "active");
    expect(active.accountStatus).toBe("active");
  });

  it("invites staff (mock, not emailed)", async () => {
    const before = (await users.listStaff()).length;
    const invited = await users.inviteStaff(
      "new@geega-games.com",
      "New",
      "Hire",
      "fulfillment",
    );
    expect(invited.email).toBe("new@geega-games.com");
    const after = (await users.listStaff()).length;
    expect(after).toBe(before + 1);
  });
});

describe("analytics repository", () => {
  it("returns overview metrics and series for a range", async () => {
    const res = await analytics.overview("30d");
    expect(res.metrics.orderCount).toBeGreaterThanOrEqual(0);
    expect(res.revenue.length).toBeGreaterThan(0);
    expect(res.orders.length).toBeGreaterThan(0);
  });

  it("returns trend metrics", async () => {
    const t = await analytics.trends("30d");
    expect(t.topCards.length).toBeGreaterThan(0);
    expect(t.salesByCondition.length).toBeGreaterThan(0);
    expect(t.revenueSeries.length).toBeGreaterThan(0);
  });
});

describe("scryfall repository — search & pagination", () => {
  it("returns distinct printings keyed by exact scryfall id", async () => {
    const page = await scryfall.searchPrintingsPage("Lightning Bolt", 1);
    const ids = page.printings.map((p) => p.scryfallId);
    // Every printing has a canonical id and ids are unique within a page.
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("page 1 and searchPrintings agree on the first page of results", async () => {
    const flat = await scryfall.searchPrintings("Lightning Bolt");
    const page = await scryfall.searchPrintingsPage("Lightning Bolt", 1);
    // page 1 is a prefix of (or equal to) the complete walk.
    expect(page.printings.map((p) => p.scryfallId)).toEqual(
      flat.slice(0, page.printings.length).map((p) => p.scryfallId),
    );
  });

  it("reports hasMore=false and a totalCards count for a small result set", async () => {
    const page = await scryfall.searchPrintingsPage("Lightning Bolt", 1);
    expect(typeof page.totalCards).toBe("number");
    expect(page.hasMore).toBe(false);
    expect(page.page).toBe(1);
  });

  it("returns an empty page for a too-short query", async () => {
    const page = await scryfall.searchPrintingsPage("a", 1);
    expect(page.printings).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it("resolves an exact printing by scryfall id, preserving identity", async () => {
    const page = await scryfall.searchPrintingsPage("Lightning Bolt", 1);
    const target = page.printings[0];
    const byId = await scryfall.getByScryfallId(target.scryfallId);
    expect(byId?.scryfallId).toBe(target.scryfallId);
    expect(byId?.setCode).toBe(target.setCode);
    expect(byId?.collectorNumber).toBe(target.collectorNumber);
  });
});

describe("insights repository", () => {
  it("returns seeded sourcing signals and order geography", async () => {
    const signals = await insights.sourcingSignals();
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0]).toHaveProperty("totalDemand");

    const geography = await insights.orderGeography();
    expect(geography.length).toBeGreaterThan(0);
    expect(geography[0]).toHaveProperty("shipState");
  });

  it("creates, updates, and deletes a market research note", async () => {
    const before = await insights.listMarketResearchNotes();

    const created = await insights.saveMarketResearchNote(null, {
      regionLabel: "Kansas City, MO",
      state: "Missouri",
      competitorCount: 3,
      population: 500000,
      notes: "Two LGS downtown, one closing soon.",
    });
    expect(created.id).toBeTruthy();
    expect(created.regionLabel).toBe("Kansas City, MO");

    const afterCreate = await insights.listMarketResearchNotes();
    expect(afterCreate.length).toBe(before.length + 1);

    const updated = await insights.saveMarketResearchNote(created.id, {
      ...created,
      competitorCount: 2,
    });
    expect(updated.id).toBe(created.id);
    expect(updated.competitorCount).toBe(2);
    // Updating must not silently create a second row.
    expect((await insights.listMarketResearchNotes()).length).toBe(before.length + 1);

    await insights.deleteMarketResearchNote(created.id);
    const afterDelete = await insights.listMarketResearchNotes();
    expect(afterDelete.find((n) => n.id === created.id)).toBeUndefined();
    expect(afterDelete.length).toBe(before.length);
  });

  it("resets market research notes back to the seed between tests", async () => {
    const notes = await insights.listMarketResearchNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].regionLabel).toBe("St. Louis, MO");
  });
});