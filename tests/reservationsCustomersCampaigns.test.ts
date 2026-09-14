import { beforeEach, describe, expect, it } from "vitest";
import {
  groupByCustomer,
  mapReservationRow,
} from "../src/admin/repositories/reservation.supabase";
import { mapCampaignRow } from "../src/admin/repositories/campaign.supabase";
import { mapCustomerRow } from "../src/admin/repositories/user.supabase";
import { sellableQuantity } from "../src/cards";
import {
  mockUserRepository as users,
  __resetMockState,
} from "../src/admin/repositories/mock";
import type { Reservation } from "../src/admin/types";
import type { Database } from "../src/types/database";

beforeEach(() => {
  __resetMockState();
});

/* ------------------------------------------------------------------ *
 * Storefront sellable-quantity invariant (mirrors inventory_public)
 * ------------------------------------------------------------------ */

describe("sellableQuantity (reserved copies never sellable)", () => {
  it("subtracts active reservations from on-hand", () => {
    // Physical 3, reserve 1 -> storefront 2.
    expect(sellableQuantity(3, 1)).toBe(2);
  });

  it("hides the line when everything is reserved (floors at 0)", () => {
    // Physical 3, reserve 3 -> storefront 0 (row absent in the view).
    expect(sellableQuantity(3, 3)).toBe(0);
    // Over-reserved never goes negative.
    expect(sellableQuantity(3, 5)).toBe(0);
  });

  it("restores availability as reservations are released", () => {
    // Release 1 of 3 held -> 2 active -> storefront 1.
    expect(sellableQuantity(3, 2)).toBe(1);
  });

  it("equals on-hand when nothing is reserved", () => {
    expect(sellableQuantity(4, 0)).toBe(4);
  });
});

/* ------------------------------------------------------------------ *
 * Reservation grouping (Reserved tab = user-centric)
 * ------------------------------------------------------------------ */

type ResRow =
  Database["public"]["Functions"]["admin_list_reservations"]["Returns"][number];

function resRow(over: Partial<ResRow> = {}): ResRow {
  return {
    reservation_id: "r1",
    inventory_item_id: "i1",
    customer_id: "c1",
    customer_email: "john@example.com",
    customer_first: "John",
    customer_last: "Smith",
    quantity: 1,
    note: null,
    reserved_by: "admin@geega-games.com",
    reserved_at: "2026-09-14T00:00:00Z",
    card_name: "Lightning Bolt",
    set_code: "MH2",
    set_name: "Modern Horizons 2",
    collector_number: "123",
    condition: "NM",
    finish: "nonfoil",
    image_url: null,
    on_hand: 5,
    ...over,
  };
}

describe("reservation grouping", () => {
  it("groups multiple cards for the same customer under one group", () => {
    const rows: Reservation[] = [
      mapReservationRow(resRow({ reservation_id: "r1", card_name: "Bolt", quantity: 2 })),
      mapReservationRow(
        resRow({ reservation_id: "r2", card_name: "Sol Ring", quantity: 2 }),
      ),
    ];
    const groups = groupByCustomer(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].reservations).toHaveLength(2);
    expect(groups[0].totalQuantity).toBe(4);
    expect(groups[0].customerEmail).toBe("john@example.com");
  });

  it("keeps different customers in separate groups", () => {
    const rows: Reservation[] = [
      mapReservationRow(resRow({ reservation_id: "r1", customer_id: "c1" })),
      mapReservationRow(
        resRow({
          reservation_id: "r2",
          customer_id: "c2",
          customer_email: "amy@example.com",
          customer_first: "Amy",
          customer_last: "Zed",
        }),
      ),
    ];
    const groups = groupByCustomer(rows);
    expect(groups).toHaveLength(2);
    // Sorted by display name: Amy Zed before John Smith.
    expect(groups[0].customerEmail).toBe("amy@example.com");
    expect(groups[1].customerEmail).toBe("john@example.com");
  });

  it("maps enriched card + customer fields onto the reservation", () => {
    const r = mapReservationRow(resRow({ quantity: 3, on_hand: 5 }));
    expect(r.cardName).toBe("Lightning Bolt");
    expect(r.setCode).toBe("MH2");
    expect(r.collectorNumber).toBe("123");
    expect(r.condition).toBe("NM");
    expect(r.finish).toBe("nonfoil");
    expect(r.quantity).toBe(3);
    expect(r.onHand).toBe(5);
    expect(r.customerFirstName).toBe("John");
  });
});

/* ------------------------------------------------------------------ *
 * Customer mapping (real values only; no fabrication)
 * ------------------------------------------------------------------ */

type CustRow =
  Database["public"]["Functions"]["admin_customer_list"]["Returns"][number];

function custRow(over: Partial<CustRow> = {}): CustRow {
  return {
    id: "c1",
    auth_user_id: null,
    email: "lead@example.com",
    first_name: null,
    last_name: null,
    status: "active",
    source: "newsletter",
    created_at: "2026-09-01T00:00:00Z",
    last_sign_in_at: null,
    order_count: 0,
    lifetime_spend_cents: 0,
    last_order_at: null,
    subscriber_status: "active",
    ...over,
  };
}

describe("customer mapping", () => {
  it("shows a dash-worthy null last sign-in for accountless customers", () => {
    const c = mapCustomerRow(custRow());
    expect(c.lastSignInAt).toBeNull();
    expect(c.orderCount).toBe(0);
    expect(c.lifetimeSpendCents).toBe(0);
    expect(c.subscriberStatus).toBe("active");
  });

  it("carries real order/spend/sign-in when present", () => {
    const c = mapCustomerRow(
      custRow({
        auth_user_id: "u1",
        last_sign_in_at: "2026-09-10T00:00:00Z",
        order_count: 3,
        lifetime_spend_cents: 12345,
        last_order_at: "2026-09-09T00:00:00Z",
        first_name: "Real",
        last_name: "Person",
      }),
    );
    expect(c.lastSignInAt).toBe("2026-09-10T00:00:00Z");
    expect(c.orderCount).toBe(3);
    expect(c.lifetimeSpendCents).toBe(12345);
    expect(c.firstName).toBe("Real");
  });
});

describe("manual customer add (dedup by email)", () => {
  it("creates a new customer once", async () => {
    const { customer, created } = await users.addCustomer({
      email: "new@example.com",
      firstName: "New",
      lastName: "Buyer",
    });
    expect(created).toBe(true);
    expect(customer.email).toBe("new@example.com");
  });

  it("does not duplicate an existing email (case-insensitive)", async () => {
    await users.addCustomer({
      email: "dup@example.com",
      firstName: "First",
      lastName: "Add",
    });
    const second = await users.addCustomer({
      email: "DUP@example.com",
      firstName: "Second",
      lastName: "Add",
    });
    expect(second.created).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Campaign mapping (no fabricated statistics)
 * ------------------------------------------------------------------ */

type CampaignRow = Database["public"]["Tables"]["campaigns"]["Row"];

function campaignRow(over: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: "cmp1",
    name: "Restock",
    subject: "New arrivals",
    preview_text: "Fresh cards",
    body: "Body",
    button_text: null,
    button_url: null,
    audience: "active_subscribers",
    status: "draft",
    recipient_count: 42,
    delivered_count: 0,
    bounce_count: 0,
    open_count: null,
    click_count: null,
    created_by: "admin@geega-games.com",
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
    scheduled_at: null,
    sent_at: null,
    ...over,
  };
}

describe("campaign mapping", () => {
  it("uses the real recipient count and honest zero/null stats for a draft", () => {
    const c = mapCampaignRow(campaignRow());
    expect(c.recipientCount).toBe(42);
    expect(c.deliveredCount).toBe(0);
    expect(c.bounceCount).toBe(0);
    expect(c.openCount).toBeNull();
    expect(c.clickCount).toBeNull();
    expect(c.status).toBe("draft");
    expect(c.sentAt).toBeNull();
  });
});