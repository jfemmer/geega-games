// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Order } from "../src/admin/types";

// The Orders page's label printing and shipment emails, as staff use them:
// one click prints the envelope (or the postage label), the envelope format
// is remembered on the device, the ship dialog is honest about what the
// customer is emailed, and it says when label buying isn't connected yet.

const mocked = vi.hoisted(() => ({
  order: null as Order | null,
  easypostConnected: true,
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
    list: async () => (mocked.order ? [mocked.order] : []),
    get: async () => mocked.order,
    counts: async () => ({}),
    shippingSetup: async () => ({ easypostConnected: mocked.easypostConnected }),
    setStatus: async () => mocked.order,
    toggleItemPacked: async () => mocked.order,
    addNote: async () => mocked.order,
    ship: async () => mocked.order,
    buyLabel: async () => mocked.order,
  },
  scryfallRepository: { resolveExact: async () => null },
}));

const { ToastProvider } = await import("../src/admin/components/ui/ToastProvider");
const { OrdersPage } = await import("../src/admin/pages/OrdersPage");

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    orderNumber: "#1A2B3C4D",
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
    status: "ready_to_ship",
    carrier: null,
    trackingNumber: null,
    shippingMethod: "pwe",
    labelUrl: null,
    postageCostCents: null,
    shippingService: null,
    items: [],
    subtotalCents: 1200,
    discountCents: 0,
    shippingCents: 150,
    taxCents: 0,
    totalCents: 1350,
    internalNotes: null,
    timeline: [],
    emails: [
      { id: "e1", emailType: "order_confirmation", toEmail: "jordan@example.com", status: "delivered", at: "2026-09-30T15:00:00Z" },
      { id: "e2", emailType: "order_packed", toEmail: "jordan@example.com", status: "sent", at: "2026-09-30T16:00:00Z" },
    ],
    createdAt: "2026-09-30T15:00:00Z",
    paidAt: "2026-09-30T15:00:00Z",
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    ...overrides,
  } as Order;
}

const printSpy = vi.fn();

async function openOrder(order: Order) {
  mocked.order = order;
  render(
    <ToastProvider>
      <OrdersPage query={new URLSearchParams(`order=${order.id}`)} onNavigate={() => {}} />
    </ToastProvider>,
  );
  return screen.findByRole("dialog", { name: order.orderNumber });
}

beforeEach(() => {
  mocked.easypostConnected = true;
  printSpy.mockReset();
  window.print = printSpy;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("printing from an order", () => {
  it("prints a PWE envelope in one click", async () => {
    const drawer = await openOrder(makeOrder());
    const buttons = within(drawer).getAllByRole("button", { name: "Print envelope" });
    fireEvent.click(buttons[0]);

    expect(printSpy).toHaveBeenCalledTimes(1);
    const view = screen.getByRole("dialog", { name: "Envelope for #1A2B3C4D" });
    expect(view).toHaveTextContent("123 Main St");
    expect(view).toHaveTextContent("Geega Games");
    // On the usual 3⅝ × 6½ envelope unless another size is picked.
    expect(document.querySelector("style[data-gg-label-page]")?.textContent).toContain("6.5in 3.625in");
  });

  it("offers the two envelope sizes, the usual one first", async () => {
    const drawer = await openOrder(makeOrder());
    const picker = within(drawer).getByLabelText("Print on") as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.textContent)).toEqual([
      "3⅝ × 6½ envelope",
      "4⅛ × 9½ envelope (#10)",
    ]);
    expect(picker.value).toBe("envelope-6-3-4");
  });

  it("remembers the envelope size on this device", async () => {
    const drawer = await openOrder(makeOrder());
    fireEvent.change(within(drawer).getByLabelText("Print on"), { target: { value: "envelope-10" } });
    expect(window.localStorage.getItem("gg-admin:pwe-envelope")).toBe("envelope-10");

    fireEvent.click(within(drawer).getAllByRole("button", { name: "Print envelope" })[0]);
    expect(document.querySelector("style[data-gg-label-page]")?.textContent).toContain("9.5in 4.125in");
  });

  it("reprints a bought postage label", async () => {
    const drawer = await openOrder(
      makeOrder({
        shippingMethod: "tracked",
        status: "shipped",
        carrier: "USPS",
        trackingNumber: "9400111899223344556677",
        labelUrl: "https://easypost-files.example/label.png",
        trackingStatus: "in_transit",
        trackingCheckedAt: new Date().toISOString(),
      }),
    );
    expect(within(drawer).getByText(/In transit/)).toBeInTheDocument();

    fireEvent.click(within(drawer).getAllByRole("button", { name: "Print label" })[0]);
    const img = await screen.findByRole("img", { name: "Postage label for #1A2B3C4D" });
    fireEvent.load(img);
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("names the emails the customer got", async () => {
    const drawer = await openOrder(makeOrder());
    expect(within(drawer).getByText("Order confirmation")).toBeInTheDocument();
    expect(within(drawer).getByText("Packed")).toBeInTheDocument();
  });
});

describe("the ship dialog", () => {
  it("says the customer is emailed, and prints the envelope from there too", async () => {
    const drawer = await openOrder(makeOrder());
    fireEvent.click(within(drawer).getByRole("button", { name: "Ship order" }));
    const dialog = await screen.findByRole("dialog", { name: "Ship #1A2B3C4D" });

    expect(dialog).toHaveTextContent("Email to jordan@example.com");
    expect(dialog).toHaveTextContent("Sent when it’s marked shipped");
    expect(dialog).not.toHaveTextContent("not sent");

    fireEvent.click(within(dialog).getByRole("button", { name: "Print envelope" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("explains when label buying isn't connected yet", async () => {
    mocked.easypostConnected = false;
    const drawer = await openOrder(makeOrder({ shippingMethod: "tracked" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Ship order" }));
    const dialog = await screen.findByRole("dialog", { name: "Ship #1A2B3C4D" });

    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Buy & print label/ })).toBeDisabled());
    expect(dialog).toHaveTextContent("EASYPOST_API_KEY");
    // The manual tracking fallback is already open.
    expect(within(dialog).getByLabelText("Tracking number")).toBeVisible();
  });
});
