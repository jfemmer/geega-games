// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { SHIPS_TO_SUMMARY, US_REGIONS, US_STATE_MESSAGE, US_ZIP_MESSAGE } from "../src/store/lib/usAddress";

// The address book on the account page (/account/addresses). A saved address
// is what checkout ships to, so it follows the same rule as checkout: US
// addresses only (src/store/lib/usAddress.ts). No country to choose, a State
// list of places we ship, a US ZIP, and what's saved is tidied.

type Row = Record<string, unknown>;

const world = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  updated: [] as { id: unknown; row: Record<string, unknown> }[],
}));

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "member-1" } } }) },
    from: (table: string) => {
      if (table !== "addresses") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          order: () => ({ order: async () => ({ data: world.rows, error: null }) }),
        }),
        insert: async (row: Record<string, unknown>) => {
          world.inserted.push(row);
          world.rows = [...world.rows, { id: `addr-${world.rows.length + 1}`, ...row }];
          return { error: null };
        },
        update: (row: Record<string, unknown>) => ({
          eq: async (_column: string, id: unknown) => {
            world.updated.push({ id, row });
            world.rows = world.rows.map((existing) => (existing.id === id ? { ...existing, ...row } : existing));
            return { error: null };
          },
        }),
      };
    },
  },
}));

vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: { id: "member-1", email: "buyer@example.com" }, loading: false, signOut: async () => {} }),
}));

vi.mock("../src/store/lib/CartContext", () => ({
  useCart: () => ({
    lines: [],
    itemCount: 0,
    subtotalCents: 0,
    loading: false,
    error: null,
    refresh: async () => {},
    clear: async () => {},
  }),
}));

vi.mock("../src/store/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useRouter: () => ({ navigate: () => {}, path: "/account/addresses" }),
  matchRoute: () => null,
}));

vi.mock("../src/store/lib/stripeClient", () => ({ isStripeConfigured: true, getStripePromise: () => null }));
vi.mock("../src/store/pages/MyDecksPage", () => ({ MyDecksSection: () => null }));

const { AccountPage } = await import("../src/store/pages/AccountPages");

// jsdom has no layout: this stands in for the browser scrolling to a message.
const scrollIntoView = vi.fn();
const elementProto = Element.prototype as unknown as { scrollIntoView?: unknown };

beforeEach(() => {
  world.rows = [];
  world.inserted = [];
  world.updated = [];
  scrollIntoView.mockReset();
  elementProto.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  cleanup();
  delete elementProto.scrollIntoView;
});

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const stateSelect = () => screen.getByLabelText("State") as HTMLSelectElement;

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function openNewAddress() {
  render(<AccountPage />);
  fireEvent.click(await screen.findByRole("button", { name: "+ Add address" }));
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "Save address" }));

const legacyAddress = (overrides: Row = {}): Row => ({
  id: "addr-1",
  label: "Home",
  recipient: "Jordan Vega",
  line1: "123 Main St",
  line2: null,
  city: "Ballwin",
  state: "Missouri",
  postal_code: "63011",
  country: "US",
  phone: null,
  is_default: true,
  ...overrides,
});

describe("adding an address", () => {
  it("has no country to choose, and says where we ship", async () => {
    await openNewAddress();

    expect(screen.queryByLabelText(/country/i)).toBeNull();
    expect(screen.getByText(SHIPS_TO_SUMMARY)).toBeInTheDocument();
    expect(screen.queryByLabelText("Postal code")).toBeNull();
    expect(field("ZIP code")).toHaveAttribute("inputmode", "numeric");
  });

  it("offers only US states, territories and military regions", async () => {
    await openNewAddress();

    const options = within(stateSelect()).getAllByRole("option") as HTMLOptionElement[];
    expect(options[0].value).toBe("");
    expect(options.slice(1).map((option) => option.value)).toEqual(US_REGIONS.map((region) => region.code));
    const names = options.map((option) => option.textContent);
    expect(names).toContain("Missouri");
    expect(names).toContain("Puerto Rico");
    expect(names).not.toContain("Ontario");
  });

  it("saves a US address tidied", async () => {
    await openNewAddress();
    type("Recipient name", " Jordan Vega ");
    type("Address line 1", " 123 Main St ");
    type("City", "Ballwin");
    type("State", "MO");
    type("ZIP code", "630111234");
    save();

    await waitFor(() => expect(world.inserted).toHaveLength(1));
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(world.inserted[0]).toEqual({
      user_id: "member-1",
      label: null,
      recipient: "Jordan Vega",
      line1: "123 Main St",
      line2: null,
      city: "Ballwin",
      state: "MO",
      postal_code: "63011-1234",
      country: "US",
      phone: null,
      is_default: false,
    });
    // Back on the list, showing what was saved.
    expect(await screen.findByText(/Ballwin, MO 63011-1234, US/)).toBeInTheDocument();
  });

  it("won't save a postcode from another country", async () => {
    await openNewAddress();
    type("Address line 1", "100 Queen St W");
    type("City", "Toronto");
    type("State", "NY");
    type("ZIP code", "M5H 2N2");
    save();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(US_ZIP_MESSAGE);
    expect(world.inserted).toEqual([]);

    // The message is above the form and "Save address" below it: it is
    // scrolled into view, every time, or the tap would seem to do nothing.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(alert);
    save();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
  });

  it("won't save without a state", async () => {
    await openNewAddress();
    type("Address line 1", "123 Main St");
    type("City", "Ballwin");
    type("ZIP code", "63011");
    save();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please fill in address line 1, city, state, and ZIP code.",
    );
    expect(world.inserted).toEqual([]);
  });
});

describe("editing an address saved before the change", () => {
  it("shows a state typed as a name, and saves it as its code", async () => {
    world.rows = [legacyAddress()];
    render(<AccountPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    // "Missouri" was typed into a free-text box; the list finds it.
    expect(stateSelect().value).toBe("MO");
    save();

    await waitFor(() => expect(world.updated).toHaveLength(1));
    expect(world.updated[0].id).toBe("addr-1");
    expect(world.updated[0].row).toMatchObject({ state: "MO", postal_code: "63011", country: "US" });
  });

  it("asks for a state when the saved one isn't in the US", async () => {
    world.rows = [legacyAddress({ city: "Toronto", state: "Ontario", postal_code: "M5H 2N2", country: "CA" })];
    render(<AccountPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(stateSelect().value).toBe("");
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent(US_STATE_MESSAGE);
    expect(world.updated).toEqual([]);

    // Corrected to a US address, it saves as one.
    type("City", "New York");
    type("State", "NY");
    type("ZIP code", "10001");
    save();

    await waitFor(() => expect(world.updated).toHaveLength(1));
    expect(world.updated[0].row).toMatchObject({ city: "New York", state: "NY", postal_code: "10001", country: "US" });
  });
});
