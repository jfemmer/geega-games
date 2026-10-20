// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import type { PickupQueue, PickupRequest, YardSaleSnapshot } from "../src/admin/types";

// Admin: yard sale lists in Pickup Requests (pickup number, where each card
// is kept, yard sale prices, taking a card off, Complete with cash or Venmo,
// and the reminder about lists left open after a sale), and the Yard Sale
// Mode switch.

const pickup = vi.hoisted(() => ({
  list: vi.fn(),
  toggleItem: vi.fn(),
  markReady: vi.fn(),
  cancel: vi.fn(),
  completeSale: vi.fn(),
  removeItem: vi.fn(),
  completeYardSaleList: vi.fn(),
}));
vi.mock("../src/admin/repositories", () => ({
  pickupRequestRepository: pickup,
  orderRepository: { get: vi.fn() },
  posRepository: { markCashPaid: vi.fn(), terminalCreateIntent: vi.fn(), voidSale: vi.fn() },
}));

const yard = vi.hoisted(() => ({ snapshot: vi.fn(), start: vi.fn(), update: vi.fn(), end: vi.fn(), showcase: vi.fn() }));
vi.mock("../src/admin/repositories/yardSale.supabase", () => ({ yardSaleRepository: yard }));

const { PickupRequestsPage } = await import("../src/admin/pages/PickupRequestsPage");
const { YardSaleModePage } = await import("../src/admin/pages/YardSaleModePage");

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

function yardList(overrides: Partial<PickupRequest> = {}): PickupRequest {
  return {
    id: "list-1",
    customerName: "Ann",
    phone: null,
    status: "waiting",
    notes: null,
    createdAt: inHours(-1),
    yardSaleId: "sale-1",
    pickupNumber: 3,
    items: [
      {
        id: "item-1", inventoryItemId: "bolt", cardName: "Lightning Bolt", setName: "Alpha", setCode: "lea", collectorNumber: "161",
        condition: "NM", finish: "nonfoil", imageUrl: null, quantity: 2, unitPriceCents: 500, pulled: false,
        storageLocation: "Box A3", currentPriceCents: 600, available: true,
      },
    ],
    ...overrides,
  };
}

function queue(overrides: Partial<PickupQueue> = {}): PickupQueue {
  return {
    requests: [yardList()],
    yardSales: [
      { id: "sale-1", startedAt: inHours(-2), endsAt: inHours(3), endedAt: null, active: true, discountPercent: 20, minPriceCents: 300 },
    ],
    taxBps: 0,
    ...overrides,
  };
}

function wrap(node: React.ReactNode) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

beforeEach(() => {
  for (const fn of Object.values(pickup)) fn.mockReset();
  for (const fn of Object.values(yard)) fn.mockReset();
  pickup.list.mockResolvedValue(queue());
  pickup.removeItem.mockResolvedValue({ cardName: "Lightning Bolt", removed: 1, itemsLeft: 1, listClosed: false });
  pickup.completeYardSaleList.mockResolvedValue({ orderId: "o1", subtotalCents: 1200, discountCents: 200, taxCents: 0, totalCents: 1000 });
});
afterEach(cleanup);

describe("yard sale lists in Pickup Requests", () => {
  it("shows the number, where each card is, and the yard sale total", async () => {
    wrap(<PickupRequestsPage />);
    expect(await screen.findByText("#3")).toBeInTheDocument();
    expect(screen.getByText("Box A3")).toBeInTheDocument();
    const card = screen.getByText("#3").closest(".gg-pickup-card") as HTMLElement;
    // Live price $6.00 x 2 at 20% off: $4.80 each, rounded to $5.
    expect(within(card).getByText("$10.00", { selector: ".gg-pickup-row__sale" })).toBeInTheDocument();
    expect(within(card).getByText("Yard sale savings").nextSibling).toHaveTextContent("−$2.00");
    expect(within(card).getByText("Total").nextSibling).toHaveTextContent("$10.00");
    expect(screen.getByRole("status")).toHaveTextContent(/Yard sale on until .* Cards \$3 and up · 20% off/);
  });

  it("completes a list paid by Venmo", async () => {
    const user = userEvent.setup();
    wrap(<PickupRequestsPage />);
    await user.click(await screen.findByRole("button", { name: "Complete" }));
    const dialog = screen.getByRole("dialog", { name: "Complete list #3?" });
    expect(within(dialog).getByRole("radio", { name: "Cash" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(dialog).getByRole("radio", { name: "Venmo" }));
    await user.click(within(dialog).getByRole("button", { name: "Complete · $10.00" }));
    expect(pickup.completeYardSaleList).toHaveBeenCalledWith("list-1", "venmo");
    expect(await screen.findByText(/List #3 complete: \$10\.00 by Venmo/)).toBeInTheDocument();
    expect(screen.queryByText("#3")).not.toBeInTheDocument();
  });

  it("takes one copy of a card off the list", async () => {
    const user = userEvent.setup();
    wrap(<PickupRequestsPage />);
    await user.click(await screen.findByRole("button", { name: "Take Lightning Bolt off list #3" }));
    const dialog = screen.getByRole("dialog", { name: "Take Lightning Bolt off list #3?" });
    await user.click(within(dialog).getByRole("button", { name: "Take off 1" }));
    expect(pickup.removeItem).toHaveBeenCalledWith("item-1", 1);
    expect(await screen.findByText("Lightning Bolt is back on the website.")).toBeInTheDocument();
  });

  it("won't complete a list holding a card that's gone from inventory", async () => {
    const list = yardList();
    list.items[0] = { ...list.items[0], available: false, currentPriceCents: null };
    pickup.list.mockResolvedValue(queue({ requests: [list] }));
    wrap(<PickupRequestsPage />);
    expect(await screen.findByText("No longer for sale. Take it off the list.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete" })).toBeDisabled();
  });

  it("reminds staff about lists left open after the sale", async () => {
    pickup.list.mockResolvedValue(
      queue({
        yardSales: [
          { id: "sale-1", startedAt: inHours(-8), endsAt: inHours(-2), endedAt: inHours(-2), active: false, discountPercent: 20, minPriceCents: 300 },
        ],
      }),
    );
    wrap(<PickupRequestsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The yard sale is over, but 1 list is still open.");
    expect(screen.getByText("Sale over")).toBeInTheDocument();
  });

  it("keeps the kiosk's own flow for kiosk requests", async () => {
    pickup.list.mockResolvedValue(
      queue({
        requests: [
          { ...yardList(), id: "kiosk-1", yardSaleId: null, pickupNumber: null, customerName: "Kim", status: "waiting",
            items: [{ ...yardList().items[0], pulled: true }] },
        ],
      }),
    );
    const user = userEvent.setup();
    wrap(<PickupRequestsPage />);
    await user.click(await screen.findByRole("button", { name: "Mark ready" }));
    expect(pickup.markReady).toHaveBeenCalledWith("kiosk-1");
    expect(screen.queryByRole("button", { name: "Complete" })).not.toBeInTheDocument();
  });
});

describe("the Yard Sale Mode page", () => {
  const off: YardSaleSnapshot = { sale: null, openLists: 0, openListsFromEndedSales: 0, completedLists: 0, completedTotalCents: 0 };
  const on: YardSaleSnapshot = {
    sale: { id: "sale-1", startedAt: inHours(-1), endsAt: inHours(3), endedAt: null, active: true, discountPercent: 25, minPriceCents: 500, listsSent: 4 },
    openLists: 2,
    openListsFromEndedSales: 0,
    completedLists: 2,
    completedTotalCents: 3150,
  };

  it("starts a sale with the discount, minimum price and end time chosen", async () => {
    yard.snapshot.mockResolvedValue(off);
    yard.start.mockResolvedValue(on);
    const user = userEvent.setup();
    wrap(<YardSaleModePage />);
    const discount = await screen.findByLabelText("Discount on website cards (%)");
    await user.clear(discount);
    await user.type(discount, "25");
    const min = screen.getByLabelText("Show cards priced at least ($)");
    await user.clear(min);
    await user.type(min, "5");
    await user.click(screen.getByRole("button", { name: "Start yard sale" }));
    const dialog = screen.getByRole("dialog", { name: "Start the yard sale?" });
    expect(dialog).toHaveTextContent("Cards $5 and up · 25% off");
    await user.click(within(dialog).getByRole("button", { name: "Start yard sale" }));
    expect(yard.start).toHaveBeenCalledWith(expect.objectContaining({ discountPercent: 25, minPriceCents: 500 }));
    expect(Date.parse(yard.start.mock.calls[0][0].endsAt)).toBeGreaterThan(Date.now());
    expect(await screen.findByText("Yard sale on")).toBeInTheDocument();
    expect(screen.getByText("2 · $31.50")).toBeInTheDocument();
  });

  it("explains that the minimum is the website price, before the discount", async () => {
    yard.snapshot.mockResolvedValue(off);
    const user = userEvent.setup();
    wrap(<YardSaleModePage />);
    const discount = await screen.findByLabelText("Discount on website cards (%)");
    await user.clear(discount);
    await user.type(discount, "20");
    const min = screen.getByLabelText("Show cards priced at least ($)");
    await user.clear(min);
    await user.type(min, "3");
    expect(
      screen.getByText(
        "Each card's website price, before the discount: a $3 card shows, and sells for $2 at 20% off. Cheaper cards stay off the yard sale page.",
      ),
    ).toBeInTheDocument();
    await user.clear(discount);
    await user.type(discount, "0");
    expect(screen.getByText("Each card's website price, before the discount. Cheaper cards stay off the yard sale page.")).toBeInTheDocument();
    await user.clear(min);
    await user.type(min, "0");
    expect(screen.getByText("0 shows all our cards.")).toBeInTheDocument();
  });

  it("won't start with a discount it can't use", async () => {
    yard.snapshot.mockResolvedValue(off);
    const user = userEvent.setup();
    wrap(<YardSaleModePage />);
    const discount = await screen.findByLabelText("Discount on website cards (%)");
    await user.clear(discount);
    await user.type(discount, "95");
    await user.click(screen.getByRole("button", { name: "Start yard sale" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a discount from 0 to 90%");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("changes the discount during the sale and ends it", async () => {
    yard.snapshot.mockResolvedValue(on);
    yard.update.mockResolvedValue({ ...on, sale: { ...on.sale!, discountPercent: 50 } });
    yard.end.mockResolvedValue({ ...on, sale: { ...on.sale!, active: false, endedAt: new Date().toISOString() } });
    const user = userEvent.setup();
    wrap(<YardSaleModePage />);
    const discount = await screen.findByLabelText("Discount on website cards (%)");
    expect(discount).toHaveValue("25");
    await user.clear(discount);
    await user.type(discount, "50");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(yard.update).toHaveBeenCalledWith("sale-1", expect.objectContaining({ discountPercent: 50, minPriceCents: 500 }));

    await user.click(screen.getByRole("button", { name: "End yard sale now" }));
    await user.click(within(screen.getByRole("dialog", { name: "End the yard sale now?" })).getByRole("button", { name: "End yard sale" }));
    expect(yard.end).toHaveBeenCalledWith("sale-1");
    expect(await screen.findByText("Yard Sale Mode is off.")).toBeInTheDocument();
  });

  it("prints the QR sign with a hand of the most valuable newer cards at the sale", async () => {
    yard.snapshot.mockResolvedValue(on);
    yard.showcase.mockResolvedValue([
      { id: "ring", name: "The One Ring", imageUrl: "https://img.test/ring.jpg" },
      { id: "ugin", name: "Ugin, Eye of the Storms", imageUrl: "https://img.test/ugin.jpg" },
    ]);
    const user = userEvent.setup();
    wrap(<YardSaleModePage />);
    await user.click(await screen.findByRole("button", { name: "Print QR sign" }));
    // The sale's minimum price.
    expect(yard.showcase).toHaveBeenCalledWith(500);
    const dialog = await screen.findByRole("dialog", { name: "Yard sale sign preview" });
    const hand = within(dialog).getByRole("region", { name: "A few of our newer cards" });
    expect(within(hand).getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual([
      "Ugin, Eye of the Storms",
      "The One Ring",
    ]);
    expect(dialog).toHaveTextContent("Scan to see our cards $5 and up");
    expect(dialog).toHaveTextContent("Yard sale prices are 25% off our website prices, rounded to whole dollars.");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Yard sale sign preview" })).not.toBeInTheDocument();
  });

  it("prints the sign for the next sale's terms when none is on", async () => {
    yard.snapshot.mockResolvedValue(off);
    yard.showcase.mockResolvedValue([]);
    const user = userEvent.setup();
    wrap(<YardSaleModePage />);
    const discount = await screen.findByLabelText("Discount on website cards (%)");
    await user.clear(discount);
    await user.type(discount, "30");
    const min = screen.getByLabelText("Show cards priced at least ($)");
    await user.clear(min);
    await user.type(min, "4");
    await user.click(screen.getByRole("button", { name: "Print QR sign" }));
    expect(yard.showcase).toHaveBeenCalledWith(400);
    const dialog = await screen.findByRole("dialog", { name: "Yard sale sign preview" });
    expect(dialog).toHaveTextContent("Scan to see our cards $4 and up");
    expect(dialog).toHaveTextContent("Yard sale prices are 30% off our website prices");
    // No cards for the hand: just the QR code, and Print is ready right away.
    expect(within(dialog).queryByRole("region", { name: "A few of our newer cards" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Print" })).toBeEnabled();
  });

  it("still prints the sign, without cards, when they can't be loaded", async () => {
    yard.snapshot.mockResolvedValue(on);
    yard.showcase.mockRejectedValue(new Error("Could not load the cards to feature."));
    const user = userEvent.setup();
    wrap(<YardSaleModePage />);
    await user.click(await screen.findByRole("button", { name: "Print QR sign" }));
    expect(await screen.findByText("Couldn't load cards to feature, so the sign shows the QR code without them.")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "Yard sale sign preview" });
    expect(within(dialog).getByRole("img", { name: "QR code for geega-games.com/yard-sale" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("region", { name: "A few of our newer cards" })).toBeNull();
  });
});
