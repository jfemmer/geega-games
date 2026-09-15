// @vitest-environment jsdom
//
// Integration coverage for the storefront search bar (Header <-> router <->
// ShopPage <-> useCatalog). This exercises the ACTUAL bug: Header previously
// had no controlled value (App.tsx never passed `search`/`onSearch`) and
// pushed a new history entry per keystroke, while ShopPage seeded
// filters.query from the URL only in its useState initializer and never
// re-synced after mount. These tests render the real <App/> tree — the only
// thing mocked is Supabase (no live network in tests).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vi.mock factories are hoisted above all imports/module-scope code, so any
// outer state they close over must itself come from vi.hoisted() — otherwise
// Vitest refuses the reference at transform time.
const mocked = vi.hoisted(() => {
  type FixtureRow = {
    id: string;
    scryfall_id: string;
    set_code: string;
    set_name: string;
    collector_number: string;
    card_name: string;
    rarity: string;
    type_line: string;
    finish: string;
    condition: string;
    quantity: number;
    price_cents: number;
  };

  const FIXTURE: FixtureRow[] = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      scryfall_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      set_code: "LEA",
      set_name: "Limited Edition Alpha",
      collector_number: "161",
      card_name: "Lightning Bolt",
      rarity: "common",
      type_line: "Instant",
      finish: "nonfoil",
      condition: "NM",
      quantity: 4,
      price_cents: 50000,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      scryfall_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      set_code: "RAV",
      set_name: "Ravnica: City of Guilds",
      collector_number: "150",
      card_name: "Lightning Helix",
      rarity: "uncommon",
      type_line: "Instant",
      finish: "nonfoil",
      condition: "LP",
      quantity: 6,
      price_cents: 150,
    },
    {
      id: "33333333-3333-3333-3333-333333333333",
      scryfall_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      set_code: "MH2",
      set_name: "Modern Horizons 2",
      collector_number: "268",
      card_name: "Counterspell",
      rarity: "uncommon",
      type_line: "Instant",
      finish: "nonfoil",
      condition: "NM",
      quantity: 10,
      price_cents: 200,
    },
  ];

  /** Mirrors search_inventory's ilike-across-columns match, case-insensitive. */
  function matches(row: FixtureRow, query: string | undefined): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      row.card_name.toLowerCase().includes(q) ||
      row.set_code.toLowerCase().includes(q) ||
      row.set_name.toLowerCase().includes(q) ||
      row.collector_number.toLowerCase().includes(q)
    );
  }

  const rpcCalls: { fn: string; args: unknown }[] = [];
  const state = { forceSearchError: false };

  return { FIXTURE, matches, rpcCalls, state };
});

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
    rpc: async (fn: string, args?: unknown) => {
      mocked.rpcCalls.push({ fn, args });
      if (fn === "search_inventory") {
        if (mocked.state.forceSearchError) {
          return { data: null, error: { message: "search_inventory failed" } };
        }
        const a = (args ?? {}) as { p_query?: string };
        const rows = mocked.FIXTURE.filter((r) => mocked.matches(r, a.p_query));
        return {
          data: rows.map((r) => ({ ...r, total_count: rows.length })),
          error: null,
        };
      }
      if (fn === "inventory_facets") {
        return {
          data: [
            {
              sets: ["LEA", "RAV", "MH2"],
              rarities: ["common", "uncommon"],
              creature_types: [],
              price_min_cents: 150,
              price_max_cents: 50000,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    },
  },
}));

// Imported dynamically so it resolves strictly after the mock above is
// registered, regardless of any import-hoisting subtleties.
const { default: App } = await import("../src/App");

function goTo(path: string) {
  window.history.pushState({}, "", path);
}

/**
 * Sets the search box's value in one synchronous event, instead of
 * simulating per-character keystrokes. Deterministic and fast — used by
 * every test except the dedicated debounce-coalescing test below, which
 * specifically needs real keystroke-by-keystroke timing.
 */
function setSearchValue(text: string) {
  const box = screen.getByLabelText(/search cards/i);
  fireEvent.change(box, { target: { value: text } });
}

beforeEach(() => {
  mocked.rpcCalls.length = 0;
  mocked.state.forceSearchError = false;
  localStorage.clear();
  goTo("/");
});

afterEach(() => {
  // vitest.config.ts runs with globals: false, so @testing-library/react's
  // auto-cleanup (which hooks a global `afterEach`) never registers —
  // without this, every test's <App/> tree piles up in document.body and
  // later getByText/getByLabelText calls start matching multiple stacked
  // instances instead of testing anything meaningful.
  cleanup();
  vi.useRealTimers();
});

describe("storefront search", () => {
  it("searches from the homepage and navigates to /shop with filtered results", async () => {
    goTo("/");
    render(<App />);

    setSearchValue("bolt");

    await waitFor(() => expect(window.location.pathname).toBe("/shop"));
    await waitFor(() =>
      expect(screen.getByText("Lightning Bolt")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Counterspell")).not.toBeInTheDocument();
    expect(screen.queryByText("Lightning Helix")).not.toBeInTheDocument();
    expect(window.location.search).toContain("q=bolt");
  });

  it("searches while already on /shop without pushing a history entry per character", async () => {
    goTo("/shop");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Counterspell")).toBeInTheDocument(),
    );
    const lengthBefore = window.history.length;

    setSearchValue("helix");

    // Wait on a NEGATIVE signal (Counterspell leaving), not on Helix
    // appearing — Helix is already visible in the unfiltered baseline, so
    // waiting for it would resolve instantly and prove nothing about
    // whether filtering actually ran.
    await waitFor(() =>
      expect(screen.queryByText("Counterspell")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Lightning Bolt")).not.toBeInTheDocument();
    expect(screen.getByText("Lightning Helix")).toBeInTheDocument();
    // Every keystroke replaced the same entry — typing 5 characters must not
    // create 5 new history entries.
    expect(window.history.length).toBe(lengthBefore);
  });

  it("updates results after ShopPage has already mounted (the regression itself)", async () => {
    // This is exactly the scenario the bug broke: ShopPage seeded
    // filters.query from the URL only once, at mount, in a useState
    // initializer, so a later URL change (here, driven by Header) never
    // reached it.
    goTo("/shop");
    render(<App />);

    // Full catalog visible pre-search.
    await waitFor(() =>
      expect(screen.getByText("Lightning Bolt")).toBeInTheDocument(),
    );
    expect(screen.getByText("Lightning Helix")).toBeInTheDocument();
    expect(screen.getByText("Counterspell")).toBeInTheDocument();

    setSearchValue("counter");

    await waitFor(() =>
      expect(screen.queryByText("Lightning Bolt")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Lightning Helix")).not.toBeInTheDocument();
    expect(screen.getByText("Counterspell")).toBeInTheDocument();
  });

  it("clearing the search restores the full catalog", async () => {
    goTo("/shop?q=bolt");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Lightning Bolt")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Counterspell")).not.toBeInTheDocument();

    setSearchValue("");

    await waitFor(() =>
      expect(screen.getByText("Counterspell")).toBeInTheDocument(),
    );
    expect(screen.getByText("Lightning Bolt")).toBeInTheDocument();
    expect(screen.getByText("Lightning Helix")).toBeInTheDocument();
    expect(window.location.search).not.toContain("q=");
  });

  it("supports browser back after a search-driven navigation", async () => {
    goTo("/");
    render(<App />);

    setSearchValue("bolt");
    await waitFor(() => expect(window.location.pathname).toBe("/shop"));

    // Call back() once outside waitFor — waitFor retries its callback on
    // failure, and a history navigation isn't idempotent to repeat.
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    // The homepage's hero heading (unlike "Shop singles", which also appears
    // as a persistent nav link on every page) confirms we're really back on
    // the homepage, not just that the path string changed.
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /carefully curated/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/search cards/i)).toHaveValue("");
  });

  it("debounces rapid keystrokes into a single search_inventory query", async () => {
    // delay: null removes userEvent's own inter-keystroke pacing so all 4
    // characters land well inside Header's 250ms debounce window regardless
    // of how loaded the machine running the test is.
    const user = userEvent.setup({ delay: null });
    goTo("/shop");
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Lightning Bolt")).toBeInTheDocument(),
    );

    const callsBeforeTyping = mocked.rpcCalls.filter(
      (c) => c.fn === "search_inventory",
    ).length;

    const box = screen.getByLabelText(/search cards/i);
    await user.type(box, "bolt"); // fires 4 fast keystrokes

    await waitFor(() =>
      expect(screen.queryByText("Counterspell")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Lightning Bolt")).toBeInTheDocument();

    const searchCalls = mocked.rpcCalls.filter(
      (c) => c.fn === "search_inventory",
    );
    // Exactly one NEW call for the settled query "bolt" — not one per
    // keystroke (which would mean 4 additional calls).
    expect(searchCalls.length).toBe(callsBeforeTyping + 1);
    expect(
      (searchCalls[searchCalls.length - 1].args as { p_query?: string })
        .p_query,
    ).toBe("bolt");
  });

  it("surfaces an RPC error instead of silently showing stale/empty results", async () => {
    mocked.state.forceSearchError = true;
    goTo("/shop");
    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(/search_inventory failed/i),
    ).toBeInTheDocument();
  });

  it("searches by set code and collector number, case-insensitively", async () => {
    goTo("/shop");
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Lightning Bolt")).toBeInTheDocument(),
    );

    setSearchValue("mh2");
    await waitFor(() =>
      expect(screen.queryByText("Lightning Bolt")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Counterspell")).toBeInTheDocument();
  });
});
