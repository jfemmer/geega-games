// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Order, OrderItem, OrderQuery } from "../src/admin/types";

// The Orders page's sorting, as staff use it to pull orders: the list sorts
// by date, total, cards, customer or envelopes first (the queue oldest first
// until they pick), and an order's packing checklist sorts by color (with a
// heading per color), set, name, price or rarity, and can hide packed cards.
// Choices are remembered on the device. The sort rules themselves:
// tests/orderSorts.test.ts.

const mocked = vi.hoisted(() => ({
  orders: [] as Order[],
  queries: [] as OrderQuery[],
  toggled: [] as string[],
}));

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));

vi.mock("../src/admin/repositories", () => ({
  orderRepository: {
    list: async (q: OrderQuery) => {
      mocked.queries.push(q);
      return mocked.orders;
    },
    get: async (id: string) => mocked.orders.find((o) => o.id === id) ?? null,
    counts: async () => ({}),
    shippingSetup: async () => ({ easypostConnected: true }),
    setStatus: async () => null,
    toggleItemPacked: async (_orderId: string, itemId: string) => {
      mocked.toggled.push(itemId);
      return null;
    },
    addNote: async () => null,
  },
  scryfallRepository: { resolveExact: async () => null },
}));

const { ToastProvider } = await import("../src/admin/components/ui/ToastProvider");
const { OrdersPage } = await import("../src/admin/pages/OrdersPage");

const item = (cardName: string, extra: Partial<OrderItem> = {}): OrderItem => ({
  id: cardName,
  cardName,
  setName: "Dominaria",
  setCode: "dom",
  collectorNumber: "1",
  imageUrl: null,
  condition: "NM",
  finish: "nonfoil",
  quantity: 1,
  unitPriceCents: 100,
  lineTotalCents: 100,
  packed: false,
  colors: ["W"],
  typeLine: "Creature",
  rarity: "rare",
  ...extra,
});

function makeOrder(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id,
    orderNumber: `#${id.toUpperCase()}`,
    channel: "online",
    customerId: null,
    customerName: "Jordan Vega",
    customerEmail: "jordan@example.com",
    shipRecipient: "Jordan Vega",
    shipLine1: "123 Main St",
    shipLine2: null,
    shipCity: "Ballwin",
    shipState: "MO",
    shipPostalCode: "63011",
    shipCountry: "US",
    paymentStatus: "paid",
    paymentProvider: "stripe",
    status: "paid",
    carrier: null,
    trackingNumber: null,
    shippingMethod: "tracked",
    labelUrl: null,
    postageCostCents: null,
    shippingService: null,
    items: [],
    subtotalCents: 1000,
    discountCents: 0,
    shippingCents: 0,
    taxCents: 0,
    totalCents: 1000,
    internalNotes: null,
    timeline: [],
    emails: [],
    createdAt: "2026-11-20T15:00:00Z",
    paidAt: "2026-11-20T15:00:00Z",
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    ...overrides,
  } as Order;
}

const renderPage = (query = "") =>
  render(
    <ToastProvider>
      <OrdersPage query={new URLSearchParams(query)} onNavigate={() => {}} />
    </ToastProvider>,
  );

const listedOrders = () =>
  Array.from(document.querySelectorAll(".gg-ordercell__num")).map((n) => n.textContent);
const checklist = (drawer: HTMLElement) =>
  Array.from(drawer.querySelectorAll(".gg-packitem__name")).map((n) => n.textContent?.replace(/^\d+× /, ""));
const headings = (drawer: HTMLElement) =>
  Array.from(drawer.querySelectorAll(".gg-packgroup__head")).map((n) => n.textContent);

beforeEach(() => {
  window.localStorage.clear();
  mocked.queries = [];
  mocked.toggled = [];
  mocked.orders = [
    makeOrder("newbig", { createdAt: "2026-11-23T20:54:00Z", totalCents: 149_444, customerName: "Alex", items: [item("x", { quantity: 140 })] }),
    makeOrder("oldsmall", { createdAt: "2026-11-21T10:00:00Z", totalCents: 650, customerName: "Mia", shippingMethod: "pwe", items: [item("y")] }),
  ];
});
afterEach(cleanup);

describe("the order list", () => {
  it("lists what needs packing oldest first until staff pick a sort", async () => {
    renderPage();
    await screen.findByText("#NEWBIG");
    expect(listedOrders()).toEqual(["#OLDSMALL", "#NEWBIG"]);
    expect(mocked.queries.at(-1)).toMatchObject({ status: "needs_packing", sortBy: "created", sortDir: "asc" });
    expect((screen.getByLabelText("Sort orders") as HTMLSelectElement).value).toBe("oldest");
    // Each order says how it ships, so "Envelopes first" shows its work.
    expect(screen.getByText("Envelope")).toBeTruthy();
  });

  it("sorts by total (on the server too) and remembers the choice", async () => {
    renderPage();
    await screen.findByText("#NEWBIG");
    fireEvent.change(screen.getByLabelText("Sort orders"), { target: { value: "totalHigh" } });
    await waitFor(() => expect(mocked.queries.at(-1)).toMatchObject({ sortBy: "total", sortDir: "desc" }));
    expect(listedOrders()).toEqual(["#NEWBIG", "#OLDSMALL"]);
    expect(window.localStorage.getItem("gg-orders-sort")).toBe("totalHigh");

    // Still the pick on another tab, and after a reload.
    fireEvent.click(screen.getByRole("tab", { name: /Shipped/ }));
    await waitFor(() => expect(mocked.queries.at(-1)).toMatchObject({ status: "shipped", sortBy: "total" }));
    cleanup();
    renderPage();
    await screen.findByText("#NEWBIG");
    expect((screen.getByLabelText("Sort orders") as HTMLSelectElement).value).toBe("totalHigh");
  });

  it("sorts by most cards, customer and envelopes first", async () => {
    renderPage();
    await screen.findByText("#NEWBIG");
    const sortBy = (value: string) => fireEvent.change(screen.getByLabelText("Sort orders"), { target: { value } });
    sortBy("envelopesFirst");
    await waitFor(() => expect(listedOrders()).toEqual(["#OLDSMALL", "#NEWBIG"]));
    sortBy("mostCards");
    await waitFor(() => expect(listedOrders()).toEqual(["#NEWBIG", "#OLDSMALL"]));
    sortBy("customer");
    await waitFor(() => expect(listedOrders()).toEqual(["#NEWBIG", "#OLDSMALL"]));
  });
});

describe("pulling one order", () => {
  const CARDS = [
    item("Llanowar Elves", { colors: ["G"], setName: "Dominaria", collectorNumber: "168", unitPriceCents: 25, lineTotalCents: 25 }),
    item("Counterspell", { colors: ["U"], setName: "Alpha", collectorNumber: "55", unitPriceCents: 6278, quantity: 2, lineTotalCents: 12_556 }),
    item("Swords to Plowshares", { colors: ["W"], setName: "Alpha", collectorNumber: "9", unitPriceCents: 4000, lineTotalCents: 4000, packed: true }),
    item("Command Tower", { colors: [], typeLine: "Land", setName: "Commander", collectorNumber: "281" }),
  ];

  async function openOrder(status: Order["status"] = "packing") {
    mocked.orders = [makeOrder("pull", { status, items: CARDS })];
    renderPage("order=pull");
    return screen.findByRole("dialog", { name: "#PULL" });
  }

  it("lists the cards by color with a heading for each, as binders are sorted", async () => {
    const drawer = await openOrder();
    expect(checklist(drawer)).toEqual(["Swords to Plowshares", "Counterspell", "Llanowar Elves", "Command Tower"]);
    expect(headings(drawer)).toEqual(["White1", "Blue2", "Green1", "Land1"]);
    // Two copies: the line total, and the price of each.
    expect(within(drawer).getByText("$62.78 each")).toBeTruthy();
  });

  it("sorts by set, price and name, and remembers it", async () => {
    const drawer = await openOrder();
    const sortBy = (value: string) => fireEvent.change(within(drawer).getByLabelText("Sort cards"), { target: { value } });

    sortBy("set");
    expect(headings(drawer)).toEqual(["Alpha3", "Commander1", "Dominaria1"]);
    expect(checklist(drawer)).toEqual(["Swords to Plowshares", "Counterspell", "Command Tower", "Llanowar Elves"]);

    sortBy("priceHigh");
    expect(headings(drawer)).toEqual([]);
    expect(checklist(drawer)).toEqual(["Counterspell", "Swords to Plowshares", "Command Tower", "Llanowar Elves"]);

    sortBy("name");
    expect(checklist(drawer)[0]).toBe("Command Tower");
    expect(window.localStorage.getItem("gg-orders-pull-sort")).toBe("name");
  });

  it("hides packed cards while packing, and says when everything is packed", async () => {
    const drawer = await openOrder();
    fireEvent.click(within(drawer).getByLabelText("Hide packed cards"));
    expect(checklist(drawer)).toEqual(["Counterspell", "Llanowar Elves", "Command Tower"]);
    expect(headings(drawer)).toEqual(["Blue2", "Green1", "Land1"]);
    expect(window.localStorage.getItem("gg-orders-hide-packed")).toBe("1");

    // Checking a card off still works from the sorted list.
    fireEvent.click(within(drawer).getByRole("checkbox", { name: /Counterspell/ }));
    expect(mocked.toggled).toEqual(["Counterspell"]);
  });

  it("offers hiding only once packing has started", async () => {
    const drawer = await openOrder("paid");
    expect(within(drawer).getByLabelText("Sort cards")).toBeTruthy();
    expect(within(drawer).queryByLabelText("Hide packed cards")).toBeNull();
    expect(checklist(drawer)).toHaveLength(4);
  });
});
