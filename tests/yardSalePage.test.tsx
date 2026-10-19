// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CatalogCard, CatalogFilters } from "../src/store/lib/useCatalog";
import type { YardSaleListView } from "../src/store/lib/yardSale";

// /yard-sale on a shopper's phone: cards at or above the sale's minimum with
// the yard sale price, a list sent with just a name, the pickup number to
// show at the table, and adding more cards to the same list.

const catalog = vi.hoisted(() => ({
  cards: [] as CatalogCard[],
  lastFilters: null as CatalogFilters | null,
  refetch: vi.fn(),
}));
vi.mock("../src/store/lib/useCatalog", async () => {
  const actual = await vi.importActual<typeof import("../src/store/lib/useCatalog")>("../src/store/lib/useCatalog");
  return {
    ...actual,
    useCatalog: (filters: CatalogFilters) => {
      catalog.lastFilters = filters;
      return { cards: catalog.cards, total: catalog.cards.length, loading: false, error: null, refetch: catalog.refetch };
    },
    useFacets: () => null,
  };
});

const api = vi.hoisted(() => ({
  status: vi.fn(),
  send: vi.fn(),
  add: vi.fn(),
  get: vi.fn(),
  saved: null as null | { requestId: string; token: string; saleId: string },
  cleared: 0,
}));
vi.mock("../src/store/lib/yardSaleApi", async () => {
  const actual = await vi.importActual<typeof import("../src/store/lib/yardSaleApi")>("../src/store/lib/yardSaleApi");
  return {
    ...actual,
    loadYardSaleStatus: api.status,
    sendYardSaleList: api.send,
    addToYardSaleList: api.add,
    getYardSaleList: api.get,
    readSavedList: () => api.saved,
    saveList: (access: typeof api.saved) => {
      api.saved = access;
    },
    clearSavedList: () => {
      api.saved = null;
      api.cleared++;
    },
  };
});

const { default: YardSalePage } = await import("../src/store/pages/YardSalePage");
const { YardSaleApiError } = await import("../src/store/lib/yardSaleApi");

const SALE = { active: true, saleId: "sale-1", discountPercent: 20, minPriceCents: 300, endsAt: "2026-10-24T20:00:00Z", taxBps: 0 };

function card(id: string, name: string, priceCents: number, quantity = 1): CatalogCard {
  return {
    id, oracleId: null, name, set: "lea", setName: "Alpha", collectorNumber: "1", type: null, rarity: null, quantity,
    imageUrl: null, priceCents, condition: "NM", finish: "nonfoil", foil: false, scryfallId: null, isDeal: false,
    originalPriceCents: null, dealDiscountPercent: null, dealSource: null, dealNote: null, variantType: null,
  };
}

function listView(overrides: Partial<YardSaleListView> = {}): YardSaleListView {
  return {
    requestId: "req-1",
    pickupNumber: 7,
    customerName: "Ann",
    status: "open",
    canAdd: true,
    discountPercent: 20,
    taxBps: 0,
    lines: [
      {
        itemId: "i1", inventoryItemId: "bolt", cardName: "Lightning Bolt", setName: "Alpha", setCode: "lea", collectorNumber: "1",
        condition: "NM", finish: "nonfoil", imageUrl: null, quantity: 1, priceCents: 500, salePriceCents: 400,
      },
    ],
    totals: { subtotalCents: 500, discountCents: 100, cardsCents: 400, taxCents: 0, totalCents: 400 },
    ...overrides,
  };
}

beforeEach(() => {
  catalog.cards = [card("bolt", "Lightning Bolt", 500), card("goyf", "Tarmogoyf", 1234, 2)];
  catalog.lastFilters = null;
  catalog.refetch.mockReset();
  for (const fn of [api.status, api.send, api.add, api.get]) fn.mockReset();
  api.saved = null;
  api.cleared = 0;
  api.status.mockResolvedValue(SALE);
});
afterEach(cleanup);

describe("the yard sale page", () => {
  it("says when there's no yard sale", async () => {
    api.status.mockResolvedValue({ active: false, saleId: null, discountPercent: 0, minPriceCents: 0, endsAt: null, taxBps: 0 });
    render(<YardSalePage />);
    expect(await screen.findByRole("heading", { name: "No yard sale right now" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Shop our cards" })).toHaveAttribute("href", "/shop");
  });

  it("shows cards at or above the minimum with the yard sale price", async () => {
    render(<YardSalePage />);
    expect(await screen.findByText("Cards $3 and up · 20% off")).toBeInTheDocument();
    expect(catalog.lastFilters?.minPriceCents).toBe(300);
    const bolt = screen.getByText("Lightning Bolt").closest(".gg-card") as HTMLElement;
    expect(within(bolt).getByText("$4.00")).toBeInTheDocument();
    expect(within(bolt).getByText(/\$5\.00/)).toHaveClass("gg-price-original");
  });

  it("sends a list with a name and shows the pickup number", async () => {
    api.send.mockResolvedValue({ list: listView(), token: "tok" });
    const user = userEvent.setup();
    render(<YardSalePage />);
    const bolt = (await screen.findByText("Lightning Bolt")).closest(".gg-card") as HTMLElement;
    await user.click(within(bolt).getByRole("button", { name: "Add to list" }));
    expect(screen.getByText("1 card · $4.00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review & send" }));
    const sheet = screen.getByRole("dialog", { name: "Your list" });
    expect(within(sheet).getByText("You don’t pay here. Pay us in person when you’re done, together with anything from the tables.")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Send my list" }));
    expect(api.send).not.toHaveBeenCalled();

    await user.type(within(sheet).getByLabelText("Your name"), "  Ann ");
    await user.click(within(sheet).getByRole("button", { name: "Send my list" }));
    expect(api.send).toHaveBeenCalledWith("Ann", [{ inventoryItemId: "bolt", quantity: 1 }], "");
    expect(await screen.findByText("#7")).toBeInTheDocument();
    expect(screen.getByText(/Thanks, Ann! We’re grabbing your card now\./)).toBeInTheDocument();
    expect(api.saved).toEqual({ requestId: "req-1", token: "tok", saleId: "sale-1" });
    expect(catalog.refetch).toHaveBeenCalled();
  });

  it("adds more cards to the same list", async () => {
    api.saved = { requestId: "req-1", token: "tok", saleId: "sale-1" };
    api.get.mockResolvedValue(listView());
    api.add.mockResolvedValue(
      listView({
        lines: [
          ...listView().lines,
          { ...listView().lines[0], itemId: "i2", inventoryItemId: "goyf", cardName: "Tarmogoyf", priceCents: 1234, salePriceCents: 1000 },
        ],
      }),
    );
    const user = userEvent.setup();
    render(<YardSalePage />);
    // The phone remembers its list.
    expect(await screen.findByText("#7")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add more cards" }));
    expect(screen.getByText(/Adding to/)).toHaveTextContent("Adding to list #7");

    const goyf = screen.getByText("Tarmogoyf").closest(".gg-card") as HTMLElement;
    await user.click(within(goyf).getByRole("button", { name: "Add to list" }));
    await user.click(screen.getByRole("button", { name: "Review & add" }));
    const sheet = screen.getByRole("dialog", { name: "Add to list #7" });
    expect(within(sheet).queryByLabelText("Your name")).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Add to my list" }));
    expect(api.add).toHaveBeenCalledWith(api.saved, [{ inventoryItemId: "goyf", quantity: 1 }]);
    expect(await screen.findByRole("heading", { name: /Your list · 2 cards/ })).toBeInTheDocument();
  });

  it("starts fresh when the remembered list was already paid for", async () => {
    api.saved = { requestId: "req-1", token: "tok", saleId: "sale-1" };
    api.get.mockResolvedValue(listView({ status: "completed", canAdd: false }));
    render(<YardSalePage />);
    expect(await screen.findByText("Cards $3 and up · 20% off")).toBeInTheDocument();
    expect(api.cleared).toBe(1);
    expect(screen.queryByText("#7")).not.toBeInTheDocument();
  });

  it("offers a new list when the old one was closed at the table", async () => {
    api.saved = { requestId: "req-1", token: "tok", saleId: "sale-1" };
    api.get.mockResolvedValue(listView());
    api.add.mockRejectedValue(new YardSaleApiError("This list has already been paid for.", 409, "list_closed"));
    const user = userEvent.setup();
    render(<YardSalePage />);
    await user.click(await screen.findByRole("button", { name: "Add more cards" }));
    const goyf = screen.getByText("Tarmogoyf").closest(".gg-card") as HTMLElement;
    await user.click(within(goyf).getByRole("button", { name: "Add to list" }));
    await user.click(screen.getByRole("button", { name: "Review & add" }));
    await user.click(screen.getByRole("button", { name: "Add to my list" }));
    const sheet = await screen.findByRole("dialog", { name: "Your list" });
    expect(within(sheet).getByRole("alert")).toHaveTextContent("List #7 is already closed, so send these as a new list.");
    expect(within(sheet).getByLabelText("Your name")).toHaveValue("Ann");
    expect(api.saved).toBeNull();
  });

  it("says which card someone else just took", async () => {
    api.send.mockRejectedValue(new YardSaleApiError("Someone just took the last Lightning Bolt.", 409, "unavailable"));
    const user = userEvent.setup();
    render(<YardSalePage />);
    const bolt = (await screen.findByText("Lightning Bolt")).closest(".gg-card") as HTMLElement;
    await user.click(within(bolt).getByRole("button", { name: "Add to list" }));
    await user.click(screen.getByRole("button", { name: "Review & send" }));
    await user.type(screen.getByLabelText("Your name"), "Bo");
    await user.click(screen.getByRole("button", { name: "Send my list" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone just took the last Lightning Bolt.");
    expect(catalog.refetch).toHaveBeenCalled();
  });

  it("closes when the sale ends", async () => {
    api.send.mockRejectedValue(new YardSaleApiError("The yard sale has ended.", 410, "sale_ended"));
    const user = userEvent.setup();
    render(<YardSalePage />);
    const bolt = (await screen.findByText("Lightning Bolt")).closest(".gg-card") as HTMLElement;
    await user.click(within(bolt).getByRole("button", { name: "Add to list" }));
    await user.click(screen.getByRole("button", { name: "Review & send" }));
    await user.type(screen.getByLabelText("Your name"), "Bo");
    api.status.mockResolvedValue({ active: false, saleId: null, discountPercent: 0, minPriceCents: 0, endsAt: null, taxBps: 0 });
    await user.click(screen.getByRole("button", { name: "Send my list" }));
    expect(await screen.findByRole("heading", { name: "No yard sale right now" })).toBeInTheDocument();
    expect(screen.getByText("The yard sale has ended, so we can't take new cards.")).toBeInTheDocument();
  });

  it("asks to try again when it can't load", async () => {
    api.status.mockRejectedValueOnce(new Error("We couldn't load the yard sale. Check your connection and try again."));
    const user = userEvent.setup();
    render(<YardSalePage />);
    expect(await screen.findByRole("heading", { name: "We couldn’t load the yard sale" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Cards $3 and up · 20% off")).toBeInTheDocument();
  });
});
