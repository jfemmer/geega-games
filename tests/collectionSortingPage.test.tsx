// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SORTING_SHIPPING_NOTICE, SORTING_SHIPPING_TERMS } from "../src/store/lib/sortingService";

// The collection sorting service page (/collection-sorting): the Shipping
// Information notice word for word, the calculator (drop-off vs. shipping;
// return shipping and packaging as quote items; the total pending a final
// shipping quote; no made-up shipping amounts, no free shipping) and the
// request form (return address from the address book, the required
// shipping checkbox).

const world = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  optionsError: null as { message: string } | null,
  addresses: [] as Record<string, unknown>[],
  insertedAddress: null as Record<string, unknown> | null,
  user: null as { id: string; email: string } | null,
}));

vi.mock("../src/supabase", () => {
  function query(table: string) {
    const result = () =>
      table === "sorting_service_options"
        ? { data: world.optionsError ? null : world.options, error: world.optionsError }
        : { data: world.addresses, error: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      insert: (row: Record<string, unknown>) => {
        world.insertedAddress = row;
        return { select: () => ({ single: async () => ({ data: { id: "addr-new" }, error: null }) }) };
      },
    };
    return chain;
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: { getSession: async () => ({ data: { session: world.user ? { access_token: "member-token" } : null } }) },
      from: query,
      rpc: async () => ({ data: null, error: null }),
    },
  };
});

vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: world.user, loading: false, signOut: async () => {} }),
}));

vi.mock("../src/store/lib/router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useRouter: () => ({ path: "/collection-sorting", query: new URLSearchParams(), navigate: () => {} }),
  matchRoute: () => null,
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
Element.prototype.scrollIntoView = vi.fn();

const { default: CollectionSortingPage } = await import("../src/store/pages/CollectionSortingPage");

const SET_SORT = { id: "opt-1", name: "Sort by set", description: "Every card by set and number", rate_per_thousand_cents: 2000 };
const COLOR_SORT = { id: "opt-2", name: "Sort by color", description: null, rate_per_thousand_cents: 1200 };

beforeEach(() => {
  world.options = [SET_SORT, COLOR_SORT];
  world.optionsError = null;
  world.addresses = [];
  world.insertedAddress = null;
  world.user = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, referenceNumber: "GG-SR-1001" }),
  }));
});

afterEach(cleanup);

async function setUp(user: ReturnType<typeof userEvent.setup>, delivery: "Drop off locally" | "Ship it to us") {
  render(<CollectionSortingPage />);
  await user.click(await screen.findByRole("radio", { name: /Sort by set/ }));
  await user.type(screen.getByLabelText("2. About how many cards?"), "2,500");
  await user.click(screen.getByRole("radio", { name: new RegExp(delivery) }));
}

const estimate = () => screen.getByRole("region", { name: "Your estimate" });

describe("the service page", () => {
  it("shows the Shipping Information notice word for word", async () => {
    render(<CollectionSortingPage />);
    const notice = screen.getByRole("complementary", { name: "Shipping Information" });
    expect(notice).toHaveTextContent(SORTING_SHIPPING_NOTICE);
    await screen.findByRole("radio", { name: /Sort by set/ });
  });

  it("lists the rates staff set, and nothing invented", async () => {
    render(<CollectionSortingPage />);
    expect(await screen.findByRole("radio", { name: /Sort by set.*\$20\.00 per 1,000 cards/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Sort by color.*\$12\.00 per 1,000 cards/ })).toBeInTheDocument();
  });

  it("says requests open soon, without a form, when no rates are shown", async () => {
    world.options = [];
    render(<CollectionSortingPage />);
    expect(await screen.findByText(/Sorting requests open soon/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send my sorting request" })).not.toBeInTheDocument();
  });
});

describe("the calculator", () => {
  it("keeps shipping to us separate and adds return shipping and packaging to the quote, pending a final shipping quote", async () => {
    const user = userEvent.setup();
    await setUp(user, "Ship it to us");
    const panel = estimate();
    expect(within(panel).getByText("2,500 cards × $20.00 per 1,000 cards")).toBeInTheDocument();
    const rows = within(panel).getAllByRole("term").map((dt) => dt.parentElement!);
    const row = (label: string) => rows.find((r) => r.textContent?.startsWith(label))!;
    expect(row("Sorting service")).toHaveTextContent("$50.00");
    expect(row("Shipping your cards to us")).toHaveTextContent("Paid by you, separately");
    expect(row("Return shipping")).toHaveTextContent("Added to your final quote");
    expect(row("Return packaging & supplies")).toHaveTextContent("Added to your final quote");
    expect(row("Estimated service total")).toHaveTextContent("Pending final shipping quote");
    expect(row("Estimated service total")).toHaveTextContent("$50.00 + return shipping & packaging");
    // No shipping amount is made up, and nothing promises free shipping.
    for (const label of ["Shipping your cards to us", "Return shipping", "Return packaging & supplies"]) {
      expect(row(label).querySelector("dd")?.textContent).not.toMatch(/\$/);
    }
    expect(panel.textContent).not.toMatch(/free/i);
  });

  it("needs no shipping for a drop-off", async () => {
    const user = userEvent.setup();
    await setUp(user, "Drop off locally");
    const panel = estimate();
    expect(panel).toHaveTextContent("Not needed — local pickup");
    expect(panel).toHaveTextContent("Estimated total$50.00");
    expect(panel).not.toHaveTextContent("Pending final shipping quote");
    expect(panel).not.toHaveTextContent("Paid by you, separately");
  });

  it("flags a card count that isn't a number", async () => {
    const user = userEvent.setup();
    render(<CollectionSortingPage />);
    await user.click(await screen.findByRole("radio", { name: /Sort by set/ }));
    await user.type(screen.getByLabelText("2. About how many cards?"), "lots");
    expect(screen.getByText(/Enter a whole number of cards/)).toBeInTheDocument();
    expect(estimate()).toHaveTextContent("Sorting service");
  });
});

describe("the request form", () => {
  async function fillContact(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("First name"), "Ann");
    await user.type(screen.getByLabelText("Last name"), "Lee");
    await user.type(screen.getByLabelText("Email"), "ann@example.com");
  }

  async function fillAddress(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Name"), "Ann Lee");
    await user.type(screen.getByLabelText("Address line 1"), "9 Oak Ave");
    await user.type(screen.getByLabelText("City"), "St. Louis");
    await user.selectOptions(screen.getByLabelText("State"), "MO");
    await user.type(screen.getByLabelText("ZIP code"), "63101");
  }

  it("won't send a shipped request until the shipping checkbox is ticked", async () => {
    const user = userEvent.setup();
    await setUp(user, "Ship it to us");
    await fillContact(user);
    await fillAddress(user);
    const box = screen.getByRole("checkbox", { name: SORTING_SHIPPING_TERMS });
    expect(box).toBeRequired();
    await user.click(screen.getByRole("button", { name: "Send my sorting request" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/shipping terms/);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(box);
    await user.click(screen.getByRole("button", { name: "Send my sorting request" }));
    expect(await screen.findByText("GG-SR-1001")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("/api/sorting-requests");
    expect(JSON.parse(init.body)).toMatchObject({
      optionId: "opt-1",
      estimatedCards: 2500,
      deliveryMethod: "ship",
      firstName: "Ann",
      email: "ann@example.com",
      returnAddressId: null,
      returnAddress: { recipient: "Ann Lee", line1: "9 Oak Ave", city: "St. Louis", state: "MO", postalCode: "63101" },
      shippingTermsAccepted: true,
    });
    expect(screen.getByText(/Please wait for that email before sending anything/)).toBeInTheDocument();
  });

  it("asks a drop-off customer for no address and no checkbox", async () => {
    const user = userEvent.setup();
    await setUp(user, "Drop off locally");
    await fillContact(user);
    expect(screen.queryByRole("checkbox", { name: SORTING_SHIPPING_TERMS })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Address line 1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send my sorting request" }));
    await screen.findByText("GG-SR-1001");
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ deliveryMethod: "drop_off", shippingTermsAccepted: false, returnAddress: null });
  });

  it("offers a signed-in customer's saved addresses, default first", async () => {
    world.user = { id: "member-1", email: "ann@example.com" };
    world.addresses = [
      { id: "addr-1", label: "Home", recipient: "Ann Lee", line1: "1 Main St", line2: null, city: "Ballwin", state: "MO", postal_code: "63011", country: "US", is_default: true },
    ];
    const user = userEvent.setup();
    await setUp(user, "Ship it to us");
    await user.type(screen.getByLabelText("First name"), "Ann");
    await user.type(screen.getByLabelText("Last name"), "Lee");
    expect(screen.getByLabelText("Email")).toHaveValue("ann@example.com");
    await waitFor(() => expect(screen.getByLabelText("Ship it back to")).toHaveValue("addr-1"));
    await user.click(screen.getByRole("checkbox", { name: SORTING_SHIPPING_TERMS }));
    await user.click(screen.getByRole("button", { name: "Send my sorting request" }));
    await screen.findByText("GG-SR-1001");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    expect(JSON.parse(init.body)).toMatchObject({ returnAddressId: "addr-1", returnAddress: null });
    expect(init.headers.Authorization).toBe("Bearer member-token");
    expect(world.insertedAddress).toBeNull();
  });

  it("saves a signed-in customer's new address to their address book", async () => {
    world.user = { id: "member-1", email: "ann@example.com" };
    const user = userEvent.setup();
    await setUp(user, "Ship it to us");
    await user.type(screen.getByLabelText("First name"), "Ann");
    await user.type(screen.getByLabelText("Last name"), "Lee");
    await fillAddress(user);
    expect(screen.getByRole("checkbox", { name: "Save this address to my account" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: SORTING_SHIPPING_TERMS }));
    await user.click(screen.getByRole("button", { name: "Send my sorting request" }));
    await screen.findByText("GG-SR-1001");
    expect(world.insertedAddress).toMatchObject({ user_id: "member-1", line1: "9 Oak Ave", state: "MO", postal_code: "63101", is_default: true });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ returnAddressId: "addr-new", returnAddress: null });
  });

  it("asks for the calculator choices first", async () => {
    const user = userEvent.setup();
    render(<CollectionSortingPage />);
    await screen.findByRole("radio", { name: /Sort by set/ });
    await fillContact(user);
    await user.click(screen.getByRole("button", { name: "Send my sorting request" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Choose a sorting option/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
