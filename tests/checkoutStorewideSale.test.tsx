// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { StorewideSale, StorewideSaleState } from "../src/store/lib/storewideSale";

// The real checkout page during a storewide sale: each card shows its sale
// price with the regular price struck through, the summary says how much is
// sale savings, and a signed-in shopper whose total was set before a sale
// started is told on the payment step and offered the way back to the sale
// price. The cart itself re-prices: tests/cartSaleReprice.test.tsx.

const world = vi.hoisted(() => ({
  user: null as { id: string } | null,
  sale: { sale: null, known: true } as StorewideSaleState,
  saleListeners: new Set<() => void>(),
}));

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: world.user ? { access_token: "member-token" } : null } }),
    },
    rpc: async () => ({ data: 0, error: null }),
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
      insert: async () => ({ error: null }),
    }),
  },
}));

vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: world.user, loading: false, signUp: async () => ({}) }),
}));

vi.mock("../src/store/lib/CartContext", () => ({
  useCart: () => ({
    lines: [
      {
        inventoryItemId: "inv-1",
        quantity: 2,
        name: "Arcane Signet",
        setCode: "cmr",
        setName: "Commander Legends",
        condition: "NM",
        finish: "nonfoil",
        imageUrl: null,
        priceCents: 425,
        originalPriceCents: 500,
        sellable: 4,
        variantType: null,
        saleOnly: false,
      },
    ],
    itemCount: 2,
    subtotalCents: 850,
    discountableSubtotalCents: 850,
    saleSavingsCents: 150,
    hasSaleOnly: false,
    loading: false,
    error: null,
    refresh: async () => {},
    clear: async () => {},
  }),
}));

vi.mock("../src/store/lib/storewideSale", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    storewideSaleKey: (s: StorewideSale | null) => (s ? `${s.id}:${s.discountPercent}` : "none"),
    refreshStorewideSale: async () => world.sale,
    useStorewideSale: () =>
      useSyncExternalStore(
        (l: () => void) => {
          world.saleListeners.add(l);
          return () => world.saleListeners.delete(l);
        },
        () => world.sale,
      ),
  };
});

vi.mock("../src/store/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useRouter: () => ({ navigate: () => {}, path: "/checkout" }),
}));
vi.mock("../src/store/lib/stripeClient", () => ({ isStripeConfigured: true, getStripePromise: () => null }));
vi.mock("../src/store/lib/paypalClient", () => ({ isPayPalConfigured: false, paypalClientId: "" }));
vi.mock("../src/store/lib/guestClaims", () => ({ rememberClaim: () => {} }));
vi.mock("../src/store/lib/storeStatus", () => ({
  useStoreStatus: () => ({ ordersPaused: false, message: "", pausedUntil: null, maxOrderLines: null }),
  refreshStoreStatus: async () => ({ ordersPaused: false, message: "", pausedUntil: null, maxOrderLines: null }),
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

const BLACK_FRIDAY: StorewideSale = {
  id: "sale-1",
  name: "Black Friday Sale",
  discountPercent: 15,
  startsAt: "2026-11-27T14:32:00Z",
  endsAt: "2026-11-29T05:59:00Z",
};

function setSale(sale: StorewideSale | null) {
  act(() => {
    world.sale = { sale, known: true };
    world.saleListeners.forEach((l) => l());
  });
}

const fetchSpy = vi.fn();
beforeEach(() => {
  world.user = null;
  world.sale = { sale: null, known: true };
  world.saleListeners.clear();
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, orderId: "11111111-2222-3333-4444-555555555555", guestToken: "tok", clientSecret: "cs", amountDueCents: 1400 }),
  });
  vi.stubGlobal("fetch", fetchSpy);
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function goToPayment() {
  if (!world.user) type("Email for your receipt & tracking", "buyer@example.com");
  type("Recipient", "Jordan Vega");
  type("Address line 1", "123 Main St");
  type("City", "Ballwin");
  type("State", "MO");
  type("ZIP code", "63011");
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
  await screen.findByRole("heading", { name: "Payment" });
}

const saleNotice = () => screen.queryByText(/just started/);

describe("checkout during a storewide sale", () => {
  it("shows each card's sale price with the regular price struck through, and the savings", () => {
    render(<CheckoutPage />);
    const struck = screen.getByText("$10.00", { selector: ".gg-price-original" });
    expect(struck).toHaveTextContent(/regular price\s*\$10\.00/);
    expect(struck.parentElement).toHaveTextContent("$8.50");
    expect(screen.getByText("Includes $1.50 in sale savings")).toBeInTheDocument();
  });

  it("tells a signed-in shopper when a sale starts after their total was set, and takes them back for it", async () => {
    world.user = { id: "member-1" };
    render(<CheckoutPage />);
    await goToPayment();
    expect(saleNotice()).toBeNull();

    setSale(BLACK_FRIDAY);
    expect(saleNotice()).toHaveTextContent("Black Friday Sale just started: 15% off storewide.");
    fireEvent.click(screen.getByRole("button", { name: "Back to checkout for the sale price" }));
    expect(screen.getByRole("button", { name: "Continue to payment" })).toBeInTheDocument();
    expect(saleNotice()).toBeNull();
  });

  it("says nothing when the total already had the sale, or when the sale ends (they keep the sale price)", async () => {
    world.user = { id: "member-1" };
    world.sale = { sale: BLACK_FRIDAY, known: true };
    render(<CheckoutPage />);
    await goToPayment();
    setSale({ ...BLACK_FRIDAY, name: "Black Friday Sale (extended)" });
    expect(saleNotice()).toBeNull();
    setSale(null);
    expect(saleNotice()).toBeNull();
  });

  it("speaks up again if the sale deepens while they pay", async () => {
    world.user = { id: "member-1" };
    world.sale = { sale: BLACK_FRIDAY, known: true };
    render(<CheckoutPage />);
    await goToPayment();
    setSale({ ...BLACK_FRIDAY, id: "sale-2", discountPercent: 25 });
    expect(saleNotice()).toHaveTextContent("25% off storewide");
  });

  it("doesn't send a guest back (their own hold could drop single copies from the browser cart)", async () => {
    render(<CheckoutPage />);
    await goToPayment();
    setSale(BLACK_FRIDAY);
    expect(saleNotice()).toBeNull();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });
});
