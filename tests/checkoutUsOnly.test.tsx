// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { SHIPS_TO_SUMMARY, US_ONLY_MESSAGE, US_REGIONS, US_ZIP_MESSAGE } from "../src/store/lib/usAddress";

// The real checkout page: an order can only be addressed within the United
// States. There is no country to choose, the State list holds only places we
// ship, a ZIP has to be a US ZIP, and what's sent to the server (and saved to
// the address book) is tidied. The server and the database enforce the same
// rule on their own: tests/checkoutUsOnlyApi.test.ts, tests/usAddress.test.ts.

type Row = Record<string, unknown>;
type LookupAddress = { line1: string; line2: string; city: string; state: string; postalCode: string; country: string };

const world = vi.hoisted(() => ({
  user: null as { id: string } | null,
  savedAddresses: [] as Record<string, unknown>[],
  insertedAddresses: [] as Record<string, unknown>[],
  // The page's handler for an address picked from the lookup.
  pickFromLookup: null as null | ((address: Record<string, string>) => void),
}));

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: world.user ? { access_token: "member-token" } : null } }),
    },
    rpc: async () => ({ data: 0, error: null }),
    from: (table: string) => {
      if (table !== "addresses") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          order: () => ({ order: async () => ({ data: world.savedAddresses, error: null }) }),
        }),
        insert: async (row: Record<string, unknown>) => {
          world.insertedAddresses.push(row);
          return { error: null };
        },
      };
    },
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
        quantity: 1,
        name: "Gaea's Cradle",
        setCode: "usg",
        setName: "Urza's Saga",
        condition: "LP",
        finish: "nonfoil",
        imageUrl: null,
        priceCents: 8000,
        sellable: 1,
        variantType: null,
      },
    ],
    itemCount: 1,
    subtotalCents: 8000,
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

// The address lookup is Google's widget; here it just hands the page's
// handler to the test, which then "picks" an address.
vi.mock("../src/store/components/GoogleAddressAutocomplete", () => ({
  default: ({ onSelect }: { onSelect: (address: Record<string, string>) => void }) => {
    world.pickFromLookup = onSelect;
    return null;
  },
}));

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
// jsdom has no layout: this stands in for the browser scrolling to a message.
const scrollIntoView = vi.fn();
const elementProto = Element.prototype as unknown as { scrollIntoView?: unknown };

beforeEach(() => {
  scrollIntoView.mockReset();
  elementProto.scrollIntoView = scrollIntoView;
  world.user = null;
  world.savedAddresses = [];
  world.insertedAddresses = [];
  world.pickFromLookup = null;
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, orderId: "11111111-2222-3333-4444-555555555555", guestToken: "tok", clientSecret: "cs", amountDueCents: 8000 }),
  });
  vi.stubGlobal("fetch", fetchSpy);
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete elementProto.scrollIntoView;
});

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const stateSelect = () => screen.getByLabelText("State") as HTMLSelectElement;
const continueButton = () => screen.getByRole("button", { name: "Continue to payment" });

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** A guest's details, complete and in Missouri unless a test says otherwise. */
function fillGuest(address: { state?: string | null; zip?: string } = {}) {
  type("Email for your receipt & tracking", "buyer@example.com");
  type("Recipient", "Jordan Vega");
  type("Address line 1", "123 Main St");
  type("City", "Ballwin");
  if (address.state !== null) type("State", address.state ?? "MO");
  type("ZIP code", address.zip ?? "63011");
}

async function sentOrder(): Promise<{ headers: Record<string, string>; body: { guest?: unknown; ship: Row } }> {
  fireEvent.click(continueButton());
  await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  const [url, init] = fetchSpy.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
  expect(url).toBe("/api/checkout/create-payment-intent");
  return { headers: init.headers, body: JSON.parse(init.body) };
}

function pick(address: Partial<LookupAddress>) {
  act(() => {
    world.pickFromLookup!({ line1: "", line2: "", city: "", state: "", postalCode: "", country: "", ...address });
  });
}

describe("the shipping address form", () => {
  it("has no country to choose, and says where we ship", () => {
    render(<CheckoutPage />);

    expect(screen.queryByLabelText(/country/i)).toBeNull();
    expect(screen.getByText(SHIPS_TO_SUMMARY)).toBeInTheDocument();
  });

  it("offers only US states, territories and military regions", () => {
    render(<CheckoutPage />);

    const state = stateSelect();
    expect(state.tagName).toBe("SELECT");
    expect(state.value).toBe("");

    const options = within(state).getAllByRole("option") as HTMLOptionElement[];
    expect(options[0].textContent).toBe("Choose a state…");
    expect(options[0].value).toBe("");
    // Every other choice is a place we ship, by its USPS code.
    expect(options.slice(1).map((option) => option.value)).toEqual(US_REGIONS.map((region) => region.code));

    const names = options.map((option) => option.textContent);
    for (const here of ["Missouri", "Alaska", "Hawaii", "District of Columbia", "Puerto Rico", "Guam", "Armed Forces Europe (AE)"]) {
      expect(names, here).toContain(here);
    }
    for (const elsewhere of ["Ontario", "British Columbia", "Quebec", "England", "Canada", "Mexico"]) {
      expect(names, elsewhere).not.toContain(elsewhere);
    }
    expect(within(state).getByRole("group", { name: "US territories" })).toBeInTheDocument();
    expect(within(state).getByRole("group", { name: "Military (APO/FPO/DPO)" })).toBeInTheDocument();
  });

  it("asks for a ZIP code, on a number keypad", () => {
    render(<CheckoutPage />);
    expect(screen.queryByLabelText("Postal code")).toBeNull();
    expect(field("ZIP code")).toHaveAttribute("inputmode", "numeric");
    // Named so a browser's saved address fills them in.
    expect(field("ZIP code")).toHaveAttribute("autocomplete", "shipping postal-code");
    expect(stateSelect()).toHaveAttribute("autocomplete", "shipping address-level1");
  });

  it("won't continue until a state is chosen", () => {
    render(<CheckoutPage />);
    fillGuest({ state: null });
    expect(continueButton()).toBeDisabled();

    type("State", "MO");
    expect(continueButton()).toBeEnabled();
  });

  it("won't continue with a postcode from another country, and says what it needs", () => {
    render(<CheckoutPage />);
    fillGuest({ zip: "M5V 3L9" });

    expect(continueButton()).toBeDisabled();
    // The hint waits until the customer has finished typing.
    expect(screen.queryByText(US_ZIP_MESSAGE)).toBeNull();

    fireEvent.blur(field("ZIP code"));
    expect(screen.getByRole("alert")).toHaveTextContent(US_ZIP_MESSAGE);
    expect(field("ZIP code")).toHaveAttribute("aria-invalid", "true");
    expect(field("ZIP code")).toHaveAccessibleDescription(US_ZIP_MESSAGE);

    type("ZIP code", "63011");
    expect(screen.queryByText(US_ZIP_MESSAGE)).toBeNull();
    expect(field("ZIP code")).not.toHaveAttribute("aria-invalid");
    expect(continueButton()).toBeEnabled();
  });

  it("doesn't nag about a ZIP that hasn't been typed yet", () => {
    render(<CheckoutPage />);
    fireEvent.blur(field("ZIP code"));
    expect(screen.queryByText(US_ZIP_MESSAGE)).toBeNull();
  });
});

describe("placing an order as a guest", () => {
  it("sends a US address, tidied", async () => {
    render(<CheckoutPage />);
    fillGuest({ zip: "630111234" });
    type("Recipient", "  Jordan Vega ");
    type("Address line 2 (optional)", " Apt 4 ");

    const { body } = await sentOrder();
    expect(body.ship).toEqual({
      recipient: "Jordan Vega",
      line1: "123 Main St",
      line2: "Apt 4",
      city: "Ballwin",
      state: "MO",
      postalCode: "63011-1234",
      country: "US",
    });
  });

  it.each([
    ["Puerto Rico", "PR", "00901"],
    ["Alaska", "AK", "99501"],
    ["a military address", "AE", "09012"],
  ])("can ship to %s", async (_where, state, zip) => {
    render(<CheckoutPage />);
    fillGuest({ state, zip });

    const { body } = await sentOrder();
    expect(body.ship).toMatchObject({ state, postalCode: zip, country: "US" });
  });

  it("shows the server's own words if it refuses the address", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, code: "shipping_address", message: US_ONLY_MESSAGE }),
    });
    render(<CheckoutPage />);
    fillGuest();
    fireEvent.click(continueButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(US_ONLY_MESSAGE);
    // The message is at the top of the page and the button at the bottom:
    // it is scrolled into view, or on a phone the tap would seem to do nothing.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.contexts[0]).toBe(alert);
    // Still on the form, nothing to pay for.
    expect(continueButton()).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "Payment" })).toBeNull();
  });

  it("doesn't move the page when an order goes through", async () => {
    render(<CheckoutPage />);
    fillGuest();
    await sentOrder();
    await screen.findByRole("heading", { name: "Payment" });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("the address lookup", () => {
  it("fills the form from a US address", () => {
    render(<CheckoutPage />);
    pick({ line1: "123 Main St", city: "Ballwin", state: "MO", postalCode: "63011", country: "US" });

    expect(field("Address line 1").value).toBe("123 Main St");
    expect(field("City").value).toBe("Ballwin");
    expect(stateSelect().value).toBe("MO");
    expect(field("ZIP code").value).toBe("63011");
  });

  it("reads a state given by name, and keeps ZIP+4", () => {
    render(<CheckoutPage />);
    pick({ line1: "1 Capitol Ave", city: "Jefferson City", state: "Missouri", postalCode: "65101-1234", country: "United States" });

    expect(stateSelect().value).toBe("MO");
    expect(field("ZIP code").value).toBe("65101-1234");
  });

  it("puts a territory, which Google lists as a country, in the State field", () => {
    render(<CheckoutPage />);
    pick({ line1: "100 Calle Fortaleza", city: "San Juan", state: "San Juan", postalCode: "00901", country: "PR" });

    expect(stateSelect().value).toBe("PR");
    expect(field("City").value).toBe("San Juan");
    expect(screen.queryByText(US_ONLY_MESSAGE)).toBeNull();
  });

  it("says we don't ship there when given an address abroad, and leaves the form alone", () => {
    render(<CheckoutPage />);
    type("Address line 1", "123 Main St");
    type("City", "Ballwin");

    pick({ line1: "100 Queen St W", city: "Toronto", state: "ON", postalCode: "M5H 2N2", country: "CA" });

    expect(screen.getByRole("alert")).toHaveTextContent(US_ONLY_MESSAGE);
    expect(field("Address line 1").value).toBe("123 Main St");
    expect(field("City").value).toBe("Ballwin");
    expect(stateSelect().value).toBe("");
    expect(field("ZIP code").value).toBe("");

    // The note is about the lookup, not about what is typed afterwards.
    type("City", "St. Louis");
    expect(screen.queryByText(US_ONLY_MESSAGE)).toBeNull();
  });

  it("clears that note when a US address is picked next", () => {
    render(<CheckoutPage />);
    pick({ line1: "100 Queen St W", city: "Toronto", state: "ON", postalCode: "M5H 2N2", country: "CA" });
    expect(screen.getByText(US_ONLY_MESSAGE)).toBeInTheDocument();

    pick({ line1: "123 Main St", city: "Ballwin", state: "MO", postalCode: "63011", country: "US" });
    expect(screen.queryByText(US_ONLY_MESSAGE)).toBeNull();
    expect(stateSelect().value).toBe("MO");
  });
});

describe("a signed-in customer", () => {
  const savedAddress = (overrides: Row = {}): Row => ({
    id: "addr-1",
    recipient: "Jordan Vega",
    line1: "123 Main St",
    line2: null,
    city: "Ballwin",
    state: "Missouri",
    postal_code: "63011",
    country: "US",
    ...overrides,
  });

  beforeEach(() => {
    world.user = { id: "member-1" };
  });

  it("orders to a saved address from before the change, sent tidied", async () => {
    // Saved when State was a free-text box: "Missouri", not "MO".
    world.savedAddresses = [savedAddress()];
    render(<CheckoutPage />);
    await screen.findByLabelText("Saved addresses");

    expect(continueButton()).toBeEnabled();
    const { headers, body } = await sentOrder();
    expect(headers.Authorization).toBe("Bearer member-token");
    expect(body.guest).toBeUndefined();
    expect(body.ship).toEqual({
      recipient: "Jordan Vega",
      line1: "123 Main St",
      city: "Ballwin",
      state: "MO",
      postalCode: "63011",
      country: "US",
    });
    // An address already in the book isn't saved again.
    expect(world.insertedAddresses).toEqual([]);
  });

  it("can't order to a saved address abroad, and is told why", async () => {
    world.savedAddresses = [
      savedAddress({ line1: "100 Queen St W", city: "Toronto", state: "ON", postal_code: "M5H 2N2", country: "CA" }),
    ];
    render(<CheckoutPage />);
    await screen.findByLabelText("Saved addresses");

    expect(screen.getByRole("alert")).toHaveTextContent(
      `We can’t ship to this saved address. ${US_ONLY_MESSAGE} Choose another address or enter a new one.`,
    );
    expect(continueButton()).toBeDisabled();

    // Entering a new address is the way forward.
    fireEvent.change(screen.getByLabelText("Saved addresses"), { target: { value: "new" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(stateSelect()).toBeInTheDocument();
  });

  it("can't order to a saved address with a state or postcode we don't ship to", async () => {
    world.savedAddresses = [savedAddress({ state: "Ontario", postal_code: "M5H 2N2" })];
    render(<CheckoutPage />);
    await screen.findByLabelText("Saved addresses");

    expect(screen.getByRole("alert")).toHaveTextContent("We can’t ship to this saved address. Please choose a US state or territory.");
    expect(continueButton()).toBeDisabled();
  });

  it("has a new address saved to the address book tidied", async () => {
    render(<CheckoutPage />);
    type("Recipient", "Jordan Vega");
    type("Address line 1", " 123 Main St ");
    type("City", "Ballwin");
    type("State", "MO");
    type("ZIP code", "63011 1234");

    const { body } = await sentOrder();
    expect(world.insertedAddresses).toEqual([
      {
        user_id: "member-1",
        recipient: "Jordan Vega",
        line1: "123 Main St",
        line2: null,
        city: "Ballwin",
        state: "MO",
        postal_code: "63011-1234",
        country: "US",
        is_default: true,
      },
    ]);
    expect(body.ship).toMatchObject({ state: "MO", postalCode: "63011-1234", country: "US" });
  });
});
