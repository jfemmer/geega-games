// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// The real checkout page, signed in and as a guest. A signed-in customer's
// cards are 5% off (the database takes it off: supabase/migrations/
// 20261009010000_member_discount.sql); the page shows the same numbers and
// never sends a discount of its own. A guest is told what signing in would
// save on this order.

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  priceCents: 1059,
}));

/** A query builder that answers every chained call, then resolves empty. */
function emptyQuery() {
  const result = { data: [], error: null };
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "insert", "order", "eq", "limit"]) builder[name] = () => builder;
  builder.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) },
    from: () => emptyQuery(),
    rpc: async () => ({ data: 0, error: null }),
  },
}));

vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: state.user, loading: false, signUp: async () => ({}) }),
}));

vi.mock("../src/store/lib/CartContext", () => ({
  useCart: () => ({
    lines: [
      {
        inventoryItemId: "inv-1",
        quantity: 1,
        name: "Faerie Mastermind",
        setCode: "mom",
        setName: "March of the Machine",
        condition: "NM",
        finish: "nonfoil",
        imageUrl: null,
        priceCents: state.priceCents,
        sellable: 1,
        variantType: null,
      },
    ],
    itemCount: 1,
    subtotalCents: state.priceCents,
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
  state.user = null;
  state.priceCents = 1059;
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, orderId: "11111111-2222-3333-4444-555555555555", clientSecret: "cs", amountDueCents: 1556 }),
  });
  vi.stubGlobal("fetch", fetchSpy);
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function summaryRow(label: string): string {
  const row = screen.getAllByText(label).find((el) => el.tagName === "SPAN")?.parentElement;
  return row?.textContent ?? "";
}

function fillAddress() {
  fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "Jordan Vega" } });
  fireEvent.change(screen.getByLabelText("Address line 1"), { target: { value: "123 Main St" } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Ballwin" } });
  fireEvent.change(screen.getByLabelText("State"), { target: { value: "MO" } });
  fireEvent.change(screen.getByLabelText("ZIP code"), { target: { value: "63011" } });
}

describe("checkout for a signed-in customer", () => {
  beforeEach(() => {
    state.user = { id: "user-1", email: "jordan@example.com" };
  });

  it("takes 5% off the cards, not the shipping", async () => {
    render(<CheckoutPage />);
    expect(summaryRow("Subtotal")).toBe("Subtotal$10.59");
    expect(summaryRow("Member discount (5%)")).toBe("Member discount (5%)-$0.53");
    expect(summaryRow("Shipping")).toBe("Shipping$5.50");
    expect(summaryRow("Amount due")).toBe("Amount due$15.56");
    // Nothing to sell them on: they're already signed in.
    expect(document.querySelector(".gg-member-offer")).toBeNull();
    expect(document.querySelector(".gg-member-nudge")).toBeNull();
  });

  it("keeps free shipping on $75 of cards even though the discount brings it under", () => {
    state.priceCents = 7600;
    render(<CheckoutPage />);
    expect(summaryRow("Member discount (5%)")).toBe("Member discount (5%)-$3.80");
    expect(summaryRow("Shipping")).toBe("ShippingFree");
    expect(summaryRow("Amount due")).toBe("Amount due$72.20");
  });

  it("never sends a discount: the server works it out from who is signed in", async () => {
    render(<CheckoutPage />);
    fillAddress();
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("/api/checkout/create-payment-intent");
    expect(init.body).not.toMatch(/discount/i);
    expect(JSON.parse(init.body)).not.toHaveProperty("guest");
  });
});

describe("checkout as a guest", () => {
  it("opens with the offer: what an account saves on this order, before anything is filled in", () => {
    render(<CheckoutPage />);
    const offer = screen.getByRole("region", { name: "Save $0.53 on this order" });
    expect(offer).toHaveTextContent(
      "Create a free account or sign in and your cards are 5% off, on this order and every one after. It takes about a minute, and your cart comes with you.",
    );
    // Both bring them back here, cart intact.
    expect(screen.getByRole("link", { name: "Create free account" })).toHaveAttribute("href", "/signup?next=%2F");
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/login?next=%2F");
    // It comes first: before the contact details.
    const contact = screen.getByRole("heading", { name: "Contact" });
    expect(offer.compareDocumentPosition(contact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("charges full price, and shows by the total what they'd pay signed in", () => {
    render(<CheckoutPage />);
    expect(screen.queryByText("Member discount (5%)")).toBeNull();
    expect(summaryRow("Amount due")).toBe("Amount due$16.09");

    const nudge = document.querySelector(".gg-member-nudge") as HTMLElement;
    expect(nudge).toHaveTextContent("Sign in and pay $15.56 instead — 5% off your cards.");
    expect(nudge.querySelector("a")?.getAttribute("href")).toBe("/login?next=%2F");
  });

  it("keeps the guest form plain: the offer above does the asking", () => {
    render(<CheckoutPage />);
    expect(screen.getByText(/Checking out as a guest/)).toHaveTextContent("Checking out as a guest — no account needed.");
  });
});
