// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { tooManyCardsMessage } from "../src/store/lib/orderLimits";

// The most different cards one order may have (admin Checkout Settings), as
// customers meet it: the cart and the checkout page say how many to remove
// and won't start checkout, and if the server refuses an order anyway (the
// limit changed while the page was open) its explanation is shown as it is.
// The server and database side: tests/checkoutUsOnlyApi.test.ts,
// tests/orderLimitDb.test.ts.

const world = vi.hoisted(() => ({
  lines: 3,
  status: { ordersPaused: false, message: "", pausedUntil: null as string | null, maxOrderLines: 2 as number | null },
}));

const cartLines = () =>
  Array.from({ length: world.lines }, (_, i) => ({
    inventoryItemId: `inv-${i}`,
    quantity: 1,
    name: `Card ${i}`,
    setCode: "usg",
    setName: "Urza's Saga",
    condition: "NM",
    finish: "nonfoil",
    imageUrl: null,
    priceCents: 1000,
    sellable: 4,
    variantType: null,
  }));

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async () => ({ data: 0, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ order: async () => ({ data: [], error: null }) }) }) }) }),
  },
}));
vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false, signUp: async () => ({}) }),
}));
vi.mock("../src/store/lib/CartContext", () => ({
  useCart: () => {
    const lines = cartLines();
    return {
      lines,
      itemCount: lines.length,
      subtotalCents: lines.length * 1000,
      discountableSubtotalCents: lines.length * 1000,
      loading: false,
      error: null,
      stockAdjusted: false,
      refresh: async () => {},
      clear: async () => {},
      setQuantity: async () => {},
      removeItem: async () => {},
    };
  },
}));
vi.mock("../src/store/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useRouter: () => ({ navigate: () => {}, path: "/checkout" }),
}));
vi.mock("../src/store/lib/stripeClient", () => ({ isStripeConfigured: true, getStripePromise: () => null }));
vi.mock("../src/store/lib/paypalClient", () => ({ isPayPalConfigured: false, paypalClientId: "" }));
vi.mock("../src/store/lib/guestClaims", () => ({ rememberClaim: () => {} }));
vi.mock("../src/store/lib/storeStatus", () => ({
  useStoreStatus: () => world.status,
  refreshStoreStatus: async () => world.status,
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
const { default: CartDrawer } = await import("../src/store/components/CartDrawer");

const fetchSpy = vi.fn();
beforeEach(() => {
  world.lines = 3;
  world.status = { ordersPaused: false, message: "", pausedUntil: null, maxOrderLines: 2 };
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
function fillGuest() {
  type("Email for your receipt & tracking", "buyer@example.com");
  type("Recipient", "Jordan Vega");
  type("Address line 1", "123 Main St");
  type("City", "Ballwin");
  type("State", "MO");
  type("ZIP code", "63011");
}
const continueButton = () => screen.getByRole("button", { name: "Continue to payment" });

describe("the cart", () => {
  it("says how many cards to remove and won't start checkout", () => {
    render(<CartDrawer open onClose={() => {}} />);
    expect(screen.getByText(tooManyCardsMessage(3, 2))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checkout" })).toBeDisabled();
  });

  it("checks out as usual within the limit, or before the limit is known", () => {
    world.lines = 2;
    render(<CartDrawer open onClose={() => {}} />);
    expect(screen.queryByText(/different cards/)).toBeNull();
    expect(screen.getByRole("button", { name: "Checkout" })).toBeEnabled();
    cleanup();

    world.lines = 3;
    world.status = { ...world.status, maxOrderLines: null };
    render(<CartDrawer open onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Checkout" })).toBeEnabled();
  });
});

describe("the checkout page", () => {
  it("says how many cards to remove and won't continue to payment", () => {
    render(<CheckoutPage />);
    fillGuest();
    expect(screen.getByText(tooManyCardsMessage(3, 2))).toBeInTheDocument();
    expect(continueButton()).toBeDisabled();

    // The vacation notice takes precedence when both apply.
    cleanup();
    world.status = { ...world.status, ordersPaused: true, message: "Back Monday." };
    render(<CheckoutPage />);
    expect(screen.queryByText(tooManyCardsMessage(3, 2))).toBeNull();
  });

  it("shows the server's explanation if it refuses the order anyway", async () => {
    world.status = { ...world.status, maxOrderLines: 500 };
    const message = tooManyCardsMessage(3, 2);
    fetchSpy.mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, code: "too_many_items", lines: 3, limit: 2, message }),
    });
    render(<CheckoutPage />);
    fillGuest();
    expect(continueButton()).toBeEnabled();
    fireEvent.click(continueButton());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
