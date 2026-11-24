// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultOrderSort,
  groupPullItems,
  loadHidePacked,
  loadOrderSort,
  loadPullSort,
  saveHidePacked,
  saveOrderSort,
  savePullSort,
  serverOrderFor,
  sortOrders,
  sortPullItems,
} from "../src/admin/components/orders/orderSorts";
import type { Order, OrderItem } from "../src/admin/types";

// Sorting on the admin Orders page, for pulling orders quickly: the order
// list, and the cards inside one order (its packing checklist).

const order = (id: string, extra: Partial<Order>) =>
  ({
    id,
    customerName: "Sam",
    shippingMethod: "tracked",
    totalCents: 1000,
    createdAt: "2026-11-20T00:00:00Z",
    items: [],
    ...extra,
  }) as Order;

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

const ids = (orders: Order[]) => orders.map((o) => o.id);
const names = (items: OrderItem[]) => items.map((i) => i.cardName);

describe("the order list", () => {
  const ORDERS = [
    order("a", { createdAt: "2026-11-21T00:00:00Z", totalCents: 500, customerName: "zoe", shippingMethod: "pwe", items: [item("x", { quantity: 2 })] }),
    order("b", { createdAt: "2026-11-19T00:00:00Z", totalCents: 149_444, customerName: "Alex", items: [item("y", { quantity: 140 })] }),
    order("c", { createdAt: "2026-11-20T00:00:00Z", totalCents: 2000, customerName: "Mia", items: [item("z", { quantity: 3 })] }),
    order("d", { createdAt: "2026-11-22T00:00:00Z", totalCents: 2000, customerName: "alex", shippingMethod: "pwe", items: [] }),
  ];

  it("sorts by date, total, how many cards, customer, and envelopes first", () => {
    expect(ids(sortOrders(ORDERS, "oldest"))).toEqual(["b", "c", "a", "d"]);
    expect(ids(sortOrders(ORDERS, "newest"))).toEqual(["d", "a", "c", "b"]);
    // Ties go to the order placed first.
    expect(ids(sortOrders(ORDERS, "totalHigh"))).toEqual(["b", "c", "d", "a"]);
    expect(ids(sortOrders(ORDERS, "totalLow"))).toEqual(["a", "c", "d", "b"]);
    expect(ids(sortOrders(ORDERS, "mostCards"))).toEqual(["b", "c", "a", "d"]);
    // Case doesn't matter.
    expect(ids(sortOrders(ORDERS, "customer"))).toEqual(["b", "d", "c", "a"]);
    expect(ids(sortOrders(ORDERS, "envelopesFirst"))).toEqual(["a", "d", "b", "c"]);
  });

  it("never changes the list it's given", () => {
    const copy = [...ORDERS];
    sortOrders(ORDERS, "totalHigh");
    expect(ORDERS).toEqual(copy);
  });

  it("lists the queue oldest first and history newest first until staff pick", () => {
    expect(["needs_packing", "packing", "ready_to_ship"].map(defaultOrderSort)).toEqual(["oldest", "oldest", "oldest"]);
    expect(["shipped", "delivered", "cancelled", "all"].map(defaultOrderSort)).toEqual(["newest", "newest", "newest", "newest"]);
  });

  it("asks the server for the right 500 when sorting by date or total", () => {
    expect(serverOrderFor("oldest")).toEqual({ sortBy: "created", sortDir: "asc" });
    expect(serverOrderFor("newest")).toEqual({ sortBy: "created", sortDir: "desc" });
    expect(serverOrderFor("totalHigh")).toEqual({ sortBy: "total", sortDir: "desc" });
    expect(serverOrderFor("totalLow")).toEqual({ sortBy: "total", sortDir: "asc" });
    expect(serverOrderFor("customer")).toEqual({ sortBy: "created", sortDir: "desc" });
  });
});

describe("the cards in one order", () => {
  const CARDS = [
    item("Llanowar Elves", { colors: ["G"], setName: "Dominaria", collectorNumber: "168", rarity: "common", unitPriceCents: 25 }),
    item("Counterspell", { colors: ["U"], setName: "Alpha", collectorNumber: "55", rarity: "uncommon", unitPriceCents: 6278 }),
    item("Swords to Plowshares", { colors: ["W"], setName: "Alpha", collectorNumber: "9", rarity: "uncommon", unitPriceCents: 4000 }),
    item("Lightning Helix", { colors: ["R", "W"], setName: "Ravnica", collectorNumber: "213", rarity: "uncommon", unitPriceCents: 150 }),
    item("Sol Ring", { colors: [], typeLine: "Artifact", setName: "Commander", collectorNumber: "10", rarity: "uncommon", unitPriceCents: 199 }),
    item("Command Tower", { colors: [], typeLine: "Land", setName: "Commander", collectorNumber: "281", rarity: "common", unitPriceCents: 100 }),
    item("Mystery Card", { colors: null, typeLine: null, setName: null, setCode: null, rarity: null, unitPriceCents: 100 }),
    item("Ajani's Pridemate", { colors: ["W"], setName: "Dominaria", collectorNumber: "4", rarity: "mythic", unitPriceCents: 100 }),
  ];

  it("sorts by color the way binders are: WUBRG, multicolor, colorless, lands, then unknown", () => {
    expect(names(sortPullItems(CARDS, "color"))).toEqual([
      "Ajani's Pridemate",
      "Swords to Plowshares",
      "Counterspell",
      "Llanowar Elves",
      "Lightning Helix",
      "Sol Ring",
      "Command Tower",
      "Mystery Card",
    ]);
  });

  it("heads each color, set and rarity, once each", () => {
    const heads = (sort: "color" | "set" | "rarity") => groupPullItems(CARDS, sort).map((g) => [g.label, g.items.length]);
    expect(heads("color")).toEqual([
      ["White", 2],
      ["Blue", 1],
      ["Green", 1],
      ["Multicolor", 1],
      ["Colorless", 1],
      ["Land", 1],
      ["Unknown color", 1],
    ]);
    expect(heads("set")).toEqual([
      ["Alpha", 2],
      ["Commander", 2],
      ["Dominaria", 2],
      ["Ravnica", 1],
      ["Unknown set", 1],
    ]);
    expect(heads("rarity")).toEqual([
      ["Mythic", 1],
      ["Uncommon", 4],
      ["Common", 2],
      ["Unknown rarity", 1],
    ]);
    // Sorts without headings make one untitled group.
    expect(groupPullItems(CARDS, "name").map((g) => g.label)).toEqual([null]);
  });

  it("orders a set by collector number, 9 before 55", () => {
    const alpha = groupPullItems(CARDS, "set")[0];
    expect(names(alpha.items)).toEqual(["Swords to Plowshares", "Counterspell"]);
  });

  it("sorts by price per card either way, and by name", () => {
    expect(names(sortPullItems(CARDS, "priceHigh")).slice(0, 3)).toEqual(["Counterspell", "Swords to Plowshares", "Sol Ring"]);
    expect(names(sortPullItems(CARDS, "priceLow"))[0]).toBe("Llanowar Elves");
    expect(names(sortPullItems(CARDS, "name"))[0]).toBe("Ajani's Pridemate");
  });
});

describe("remembering choices on this device", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps the list sort, the card sort and hide-packed", () => {
    expect(loadOrderSort()).toBeNull();
    expect(loadPullSort()).toBe("color");
    expect(loadHidePacked()).toBe(false);
    saveOrderSort("totalHigh");
    savePullSort("set");
    saveHidePacked(true);
    expect([loadOrderSort(), loadPullSort(), loadHidePacked()]).toEqual(["totalHigh", "set", true]);
  });

  it("ignores anything it doesn't recognize", () => {
    window.localStorage.setItem("gg-orders-sort", "bogus");
    window.localStorage.setItem("gg-orders-pull-sort", "bogus");
    expect([loadOrderSort(), loadPullSort()]).toEqual([null, "color"]);
  });
});
