// Mock repository implementations. All state is held in-memory and seeded from
// the *.mock.ts files. Mutations update the in-memory arrays so the UI behaves
// like a real app within a session. NOTHING here touches Supabase, Resend, or
// any network resource.

import {
  CARD_PRINTINGS,
  INVENTORY_MOVEMENTS_SEED,
  INVENTORY_SEED,
} from "../data/inventory.mock";
import { ORDERS_SEED } from "../data/orders.mock";
import {
  ADMIN_ACTIVITY_SEED,
  CAMPAIGNS_SEED,
  CUSTOMERS_SEED,
  STAFF_SEED,
  overviewMetricsFor,
  overviewSeriesFor,
  trendMetricsFor,
} from "../data/misc.mock";
import type {
  Campaign,
  CardPrinting,
  Customer,
  CustomerQuery,
  DateRangeKey,
  InventoryItem,
  InventoryMovement,
  InventoryQuery,
  Order,
  OrderQuery,
  Page,
  ShippingCarrier,
  StaffMember,
} from "../types";
import { delay, mockId } from "../utils/format";
import type {
  AnalyticsRepository,
  CampaignRepository,
  InventoryRepository,
  OrderRepository,
  UserRepository,
} from "./types";

// Clone seeds so the module owns its own mutable state.
let inventory: InventoryItem[] = INVENTORY_SEED.map((i) => ({ ...i }));
let movements: InventoryMovement[] = INVENTORY_MOVEMENTS_SEED.map((m) => ({
  ...m,
}));
let orders: Order[] = ORDERS_SEED.map((o) => ({
  ...o,
  items: o.items.map((it) => ({ ...it })),
  timeline: [...o.timeline],
  emails: [...o.emails],
}));
let campaigns: Campaign[] = CAMPAIGNS_SEED.map((c) => ({ ...c }));
let customers: Customer[] = CUSTOMERS_SEED.map((c) => ({ ...c }));
let staff: StaffMember[] = STAFF_SEED.map((s) => ({
  ...s,
  recentActivity: [...s.recentActivity],
}));

const LOW_STOCK_THRESHOLD = 2;

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

export const mockInventoryRepository: InventoryRepository = {
  async list(query: InventoryQuery): Promise<Page<InventoryItem>> {
    const {
      search = "",
      status = "all",
      stock = "all",
      condition = "all",
      finish = "all",
      setCode = "all",
      sortBy = "updated",
      sortDir = "desc",
      page = 1,
      pageSize = 10,
    } = query;

    let rows = inventory.filter((item) => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.cardName.toLowerCase().includes(q) ||
        item.setName.toLowerCase().includes(q) ||
        item.setCode.toLowerCase().includes(q) ||
        (item.sku?.toLowerCase().includes(q) ?? false);
      const matchesStatus = status === "all" || item.status === status;
      const matchesStock =
        stock === "all" ||
        (stock === "low" &&
          item.quantity > 0 &&
          item.quantity <= LOW_STOCK_THRESHOLD) ||
        (stock === "out" && item.quantity === 0);
      const matchesCondition =
        condition === "all" || item.condition === condition;
      const matchesFinish = finish === "all" || item.finish === finish;
      const matchesSet = setCode === "all" || item.setCode === setCode;
      return (
        matchesSearch &&
        matchesStatus &&
        matchesStock &&
        matchesCondition &&
        matchesFinish &&
        matchesSet
      );
    });

    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "name":
          cmp = a.cardName.localeCompare(b.cardName);
          break;
        case "quantity":
          cmp = a.quantity - b.quantity;
          break;
        case "price":
          cmp = a.priceCents - b.priceCents;
          break;
        case "updated":
          cmp = a.updatedAt.localeCompare(b.updatedAt);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    const total = rows.length;
    const start = (page - 1) * pageSize;
    return delay({ rows: rows.slice(start, start + pageSize), total });
  },

  async get(id) {
    return delay(inventory.find((i) => i.id === id) ?? null, 150);
  },

  async setCodes() {
    return delay(
      Array.from(new Set(inventory.map((i) => i.setCode))).sort(),
      100,
    );
  },

  async create(input, adminName) {
    const item: InventoryItem = {
      ...input,
      id: mockId("inv"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    inventory = [item, ...inventory];
    if (item.quantity > 0) {
      movements = [
        {
          id: mockId("mv"),
          inventoryItemId: item.id,
          cardName: item.cardName,
          delta: item.quantity,
          previousQuantity: 0,
          resultingQuantity: item.quantity,
          reason: "manual_add",
          relatedOrderNumber: null,
          adminName,
          createdAt: new Date().toISOString(),
        },
        ...movements,
      ];
    }
    return delay(item, 250);
  },

  async update(id, patch) {
    inventory = inventory.map((i) =>
      i.id === id ? { ...i, ...patch, updatedAt: new Date().toISOString() } : i,
    );
    const updated = inventory.find((i) => i.id === id);
    if (!updated) throw new Error("Inventory item not found");
    return delay(updated, 200);
  },

  async adjustQuantity(id, delta, reason, adminName) {
    const item = inventory.find((i) => i.id === id);
    if (!item) throw new Error("Inventory item not found");
    const previousQuantity = item.quantity;
    const resultingQuantity = Math.max(0, previousQuantity + delta);
    inventory = inventory.map((i) =>
      i.id === id
        ? { ...i, quantity: resultingQuantity, updatedAt: new Date().toISOString() }
        : i,
    );
    movements = [
      {
        id: mockId("mv"),
        inventoryItemId: id,
        cardName: item.cardName,
        delta: resultingQuantity - previousQuantity,
        previousQuantity,
        resultingQuantity,
        reason,
        relatedOrderNumber: null,
        adminName,
        createdAt: new Date().toISOString(),
      },
      ...movements,
    ];
    return delay(inventory.find((i) => i.id === id)!, 200);
  },

  async archive(id) {
    return this.update(id, { status: "archived" });
  },

  async movements(itemId) {
    const rows = itemId
      ? movements.filter((m) => m.inventoryItemId === itemId)
      : movements;
    return delay([...rows], 150);
  },

  async findMatch(setCode, collectorNumber, condition, finish) {
    return delay(
      inventory.find(
        (i) =>
          i.setCode === setCode &&
          i.collectorNumber === collectorNumber &&
          i.condition === condition &&
          i.finish === finish &&
          i.status !== "archived",
      ) ?? null,
      150,
    );
  },

  async searchPrintings(term): Promise<CardPrinting[]> {
    const q = term.trim().toLowerCase();
    if (!q) return delay([], 120);
    return delay(
      CARD_PRINTINGS.filter(
        (p) =>
          p.cardName.toLowerCase().includes(q) ||
          p.setName.toLowerCase().includes(q) ||
          p.setCode.toLowerCase().includes(q),
      ),
      250,
    );
  },
};

/* ------------------------------------------------------------------ *
 * Orders
 * ------------------------------------------------------------------ */

function statusEvent(label: string, detail: string | null, actor: string) {
  return {
    id: mockId("tl"),
    label,
    detail,
    actor,
    at: new Date().toISOString(),
  };
}

export const mockOrderRepository: OrderRepository = {
  async list(query: OrderQuery): Promise<Order[]> {
    const { search = "", status = "all", sortBy = "created", sortDir = "desc" } =
      query;
    let rows = orders.filter((o) => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.customerEmail.toLowerCase().includes(q);
      let matchesStatus = true;
      if (status === "needs_packing") matchesStatus = o.status === "paid";
      else if (status !== "all") matchesStatus = o.status === status;
      return matchesSearch && matchesStatus;
    });

    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "created":
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
        case "total":
          cmp = a.totalCents - b.totalCents;
          break;
        case "waiting":
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return delay(rows, 300);
  },

  async get(id) {
    return delay(orders.find((o) => o.id === id) ?? null, 150);
  },

  async setStatus(id, status, adminName) {
    const labels: Record<string, string> = {
      packing: "Packing started",
      ready_to_ship: "Marked ready to ship",
      cancelled: "Cancelled",
      paid: "Reopened",
    };
    orders = orders.map((o) =>
      o.id === id
        ? {
            ...o,
            status,
            timeline: [
              ...o.timeline,
              statusEvent(labels[status] ?? `Status → ${status}`, null, adminName),
            ],
          }
        : o,
    );
    return delay(orders.find((o) => o.id === id)!, 200);
  },

  async toggleItemPacked(orderId, itemId) {
    orders = orders.map((o) =>
      o.id === orderId
        ? {
            ...o,
            items: o.items.map((it) =>
              it.id === itemId ? { ...it, packed: !it.packed } : it,
            ),
          }
        : o,
    );
    return delay(orders.find((o) => o.id === orderId)!, 120);
  },

  async addNote(orderId, note) {
    orders = orders.map((o) =>
      o.id === orderId ? { ...o, internalNotes: note } : o,
    );
    return delay(orders.find((o) => o.id === orderId)!, 150);
  },

  async ship(orderId, carrier, trackingNumber, adminName) {
    const at = new Date().toISOString();
    orders = orders.map((o) =>
      o.id === orderId
        ? {
            ...o,
            status: "shipped",
            carrier,
            trackingNumber,
            shippedAt: at,
            timeline: [
              ...o.timeline,
              statusEvent("Shipped", `${carrier} ${trackingNumber}`, adminName),
            ],
            emails: [
              ...o.emails,
              {
                id: mockId("em"),
                emailType: "shipping_confirmation",
                toEmail: o.customerEmail,
                status: "sent",
                at,
              },
            ],
          }
        : o,
    );
    return delay(orders.find((o) => o.id === orderId)!, 250);
  },

  async counts() {
    const by = (s: Order["status"]) =>
      orders.filter((o) => o.status === s).length;
    return delay(
      {
        needs_packing: by("paid"),
        packing: by("packing"),
        ready_to_ship: by("ready_to_ship"),
        shipped: by("shipped"),
        delivered: by("delivered"),
        cancelled: by("cancelled") + by("refunded"),
        all: orders.length,
      },
      100,
    );
  },
};

/* ------------------------------------------------------------------ *
 * Campaigns
 * ------------------------------------------------------------------ */

const AUDIENCE_COUNTS: Record<Campaign["audience"], number> = {
  active_subscribers: 851,
  confirmed_recent: 604,
  all_customers: 1230,
};

export const mockCampaignRepository: CampaignRepository = {
  async list() {
    return delay([...campaigns], 300);
  },
  async get(id) {
    return delay(campaigns.find((c) => c.id === id) ?? null, 150);
  },
  async save(input) {
    if (input.id) {
      campaigns = campaigns.map((c) =>
        c.id === input.id ? { ...c, ...input } : c,
      );
      return delay(campaigns.find((c) => c.id === input.id)!, 250);
    }
    const campaign: Campaign = {
      ...input,
      id: mockId("cmp"),
      createdAt: new Date().toISOString(),
      sentAt: null,
      deliveredCount: 0,
      bounceCount: 0,
      openCount: null,
      clickCount: null,
    };
    campaigns = [campaign, ...campaigns];
    return delay(campaign, 250);
  },
  async send(id) {
    // Simulated only — no real email is sent.
    campaigns = campaigns.map((c) =>
      c.id === id
        ? {
            ...c,
            status: "sent",
            sentAt: new Date().toISOString(),
            deliveredCount: Math.round(c.recipientCount * 0.98),
            bounceCount: Math.round(c.recipientCount * 0.01),
            openCount: Math.round(c.recipientCount * 0.42),
            clickCount: Math.round(c.recipientCount * 0.15),
          }
        : c,
    );
    return delay(campaigns.find((c) => c.id === id)!, 400);
  },
  async cancel(id) {
    campaigns = campaigns.map((c) =>
      c.id === id ? { ...c, status: "cancelled" } : c,
    );
    return delay(campaigns.find((c) => c.id === id)!, 200);
  },
  async recipientCount(audience) {
    return delay(AUDIENCE_COUNTS[audience], 120);
  },
};

/* ------------------------------------------------------------------ *
 * Users
 * ------------------------------------------------------------------ */

export const mockUserRepository: UserRepository = {
  async listCustomers(query: CustomerQuery) {
    const { search = "", accountStatus = "all", subscriber = "all" } = query;
    const rows = customers.filter((c) => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        c.email.toLowerCase().includes(q) ||
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q);
      const matchesStatus =
        accountStatus === "all" || c.accountStatus === accountStatus;
      const isSubscribed = c.subscriberStatus === "active";
      const matchesSub =
        subscriber === "all" ||
        (subscriber === "subscribed" && isSubscribed) ||
        (subscriber === "not_subscribed" && !isSubscribed);
      return matchesSearch && matchesStatus && matchesSub;
    });
    return delay(rows, 300);
  },
  async getCustomer(id) {
    return delay(customers.find((c) => c.id === id) ?? null, 150);
  },
  async setCustomerStatus(id, status) {
    customers = customers.map((c) =>
      c.id === id ? { ...c, accountStatus: status } : c,
    );
    return delay(customers.find((c) => c.id === id)!, 200);
  },
  async listStaff() {
    return delay([...staff], 250);
  },
  async inviteStaff(email, firstName, lastName, role) {
    const member: StaffMember = {
      id: mockId("stf"),
      firstName,
      lastName,
      email,
      role,
      status: "active",
      lastActiveAt: null,
      recentActivity: [],
    };
    staff = [...staff, member];
    return delay(member, 300);
  },
  async setStaffRole(id, role) {
    staff = staff.map((s) => (s.id === id ? { ...s, role } : s));
    return delay(staff.find((s) => s.id === id)!, 200);
  },
  async setStaffStatus(id, status) {
    staff = staff.map((s) => (s.id === id ? { ...s, status } : s));
    return delay(staff.find((s) => s.id === id)!, 200);
  },
};

/* ------------------------------------------------------------------ *
 * Analytics
 * ------------------------------------------------------------------ */

export const mockAnalyticsRepository: AnalyticsRepository = {
  async overview(range: DateRangeKey) {
    const { revenue, orders: orderSeries } = overviewSeriesFor(range);
    return delay(
      {
        metrics: overviewMetricsFor(range),
        revenue,
        orders: orderSeries,
        recentActivity: [...ADMIN_ACTIVITY_SEED],
      },
      350,
    );
  },
  async trends(range: DateRangeKey) {
    return delay(trendMetricsFor(range), 350);
  },
};

/** Reset all mock state — used by tests to isolate runs. */
export function __resetMockState() {
  inventory = INVENTORY_SEED.map((i) => ({ ...i }));
  movements = INVENTORY_MOVEMENTS_SEED.map((m) => ({ ...m }));
  orders = ORDERS_SEED.map((o) => ({
    ...o,
    items: o.items.map((it) => ({ ...it })),
    timeline: [...o.timeline],
    emails: [...o.emails],
  }));
  campaigns = CAMPAIGNS_SEED.map((c) => ({ ...c }));
  customers = CUSTOMERS_SEED.map((c) => ({ ...c }));
  staff = STAFF_SEED.map((s) => ({ ...s, recentActivity: [...s.recentActivity] }));
}

// Export the carrier type re-export for convenience in the ship() consumers.
export type { ShippingCarrier };
