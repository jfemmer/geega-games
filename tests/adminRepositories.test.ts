import { beforeEach, describe, expect, it } from "vitest";
import {
  mockInventoryRepository as inventory,
  mockOrderRepository as orders,
  mockCampaignRepository as campaigns,
  mockUserRepository as users,
  mockAnalyticsRepository as analytics,
  __resetMockState,
} from "../src/admin/repositories/mock";

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
    expect(latest.adminName).toBe("Test Admin");
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
