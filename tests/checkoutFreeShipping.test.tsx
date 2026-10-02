// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// The real checkout page, as a guest sees it: an order with $75 or more of
// cards ships tracked for free, automatically, so Plain White Envelope is
// not offered and the order is sent to the server as tracked. Under $75 the
// customer still chooses. (The server enforces the same rule on its own:
// supabase/migrations/20261002200000_free_shipping_at_75.sql.)

const cart = vi.hoisted(() => ({ priceCents: 8000 }));

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async () => ({ data: null, error: null }),
  },
}));

vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false, signUp: async () => ({}) }),
}));

vi.mock("../src/store/lib/CartContext", () => ({
  useCart: () => ({
    lines: [
      {
        inventoryItemId: "inv-1",
        quantity: 1,
        name: "Gaea's Cradle",
        setCode: "usg",
        setName: "Urza's Saga",
        condition: "LP",
        finish: "nonfoil",
        imageUrl: null,
        priceCents: cart.priceCents,
        sellable: 1,
        variantType: null,
      },
    ],
    itemCount: 1,
    subtotalCents: cart.priceCents,
    loading: false,
    error: null,
    refresh: async () => {},
    clear: async () => {},
  }),
}));

vi.mock("../src/store/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useRouter: () => ({ navigate: () => {}, path: "/checkout" }),
}));

vi.mock("../src/store/lib/stripeClient", () => ({ isStripeConfigured: true, getStripePromise: () => null }));
vi.mock("../src/store/lib/paypalClient", () => ({ isPayPalConfigured: false, paypalClientId: "" }));
vi.mock("../src/store/lib/guestClaims", () => ({ rememberClaim: () => {} }));
vi.mock("../src/store/lib/storeStatus", () => ({
  useStoreStatus: () => ({ ordersPaused: false, message: "", pausedUntil: null }),
  refreshStoreStatus: async () => ({ ordersPaused: false, message: "", pausedUntil: null }),
  formatReopenDate: () => "",
}));
vi.mock("../src/store/components/GoogleAddressAutocomplete", () => ({ default: () => null }));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PaymentElement: () => null,
  useStripe: () => null,
  useElements: () => null,
}));
vi.mock("@paypal/react-paypal-js", () => ({
  FUNDING: {},
  PayPalButtons: () => null,
  PayPalScriptProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  usePayPalScriptReducer: () => [{ isPending: false, isRejected: false }],
}));

const { default: CheckoutPage } = await import("../src/store/pages/CheckoutPage");

const fetchSpy = vi.fn();

beforeEach(() => {
  cart.priceCents = 8000;
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, orderId: "11111111-2222-3333-4444-555555555555", guestToken: "tok", clientSecret: "cs", amountDueCents: 0 }),
  });
  vi.stubGlobal("fetch", fetchSpy);
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillGuestDetails() {
  fireEvent.change(screen.getByLabelText(/Email for your receipt/), { target: { value: "buyer@example.com" } });
  fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "Jordan Vega" } });
  fireEvent.change(screen.getByLabelText("Address line 1"), { target: { value: "123 Main St" } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Ballwin" } });
  fireEvent.change(screen.getByLabelText("State"), { target: { value: "MO" } });
  fireEvent.change(screen.getByLabelText("Postal code"), { target: { value: "63011" } });
}

async function placeOrder(): Promise<{ shippingMethod: string }> {
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  const [url, init] = fetchSpy.mock.calls[0] as [string, { body: string }];
  expect(url).toBe("/api/checkout/create-payment-intent");
  return JSON.parse(init.body);
}

function summaryRow(label: string): string {
  const row = screen.getAllByText(label).find((el) => el.tagName === "SPAN")?.parentElement;
  return row?.textContent ?? "";
}

describe("checkout with $75 or more of cards", () => {
  it("doesn't offer Plain White Envelope: free tracked shipping is applied", () => {
    render(<CheckoutPage />);

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText(/Plain White Envelope/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Free tracked shipping. Orders of $75 or more ship free with tracking, automatically.",
    );
    expect(summaryRow("Shipping")).toBe("ShippingFree");
    expect(summaryRow("Amount due")).toBe("Amount due$80.00");
  });

  it("sends the order as tracked", async () => {
    render(<CheckoutPage />);
    fillGuestDetails();
    expect((await placeOrder()).shippingMethod).toBe("tracked");
  });

  it("applies at exactly $75", () => {
    cart.priceCents = 7500;
    render(<CheckoutPage />);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(summaryRow("Shipping")).toBe("ShippingFree");
  });
});

describe("checkout under $75", () => {
  beforeEach(() => {
    cart.priceCents = 6000;
  });

  it("offers tracked and the envelope, and charges the one picked", async () => {
    render(<CheckoutPage />);

    expect(screen.getByRole("radio", { name: "Tracked ($5.50)" })).toBeChecked();
    expect(summaryRow("Shipping")).toBe("Shipping$5.50");
    expect(screen.getByText(/Add \$15\.00 more and your order ships free with tracking/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Plain White Envelope ($1.50, untracked)" }));
    expect(summaryRow("Shipping")).toBe("Shipping$1.50");
    expect(summaryRow("Amount due")).toBe("Amount due$61.50");

    fillGuestDetails();
    expect((await placeOrder()).shippingMethod).toBe("pwe");
  });

  it("drops an envelope pick once the cart reaches $75", async () => {
    const { rerender } = render(<CheckoutPage />);
    fireEvent.click(screen.getByRole("radio", { name: "Plain White Envelope ($1.50, untracked)" }));

    // The customer adds another card in the cart: now $80.
    cart.priceCents = 8000;
    rerender(<CheckoutPage />);

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(summaryRow("Shipping")).toBe("ShippingFree");
    fillGuestDetails();
    expect((await placeOrder()).shippingMethod).toBe("tracked");
  });
});
