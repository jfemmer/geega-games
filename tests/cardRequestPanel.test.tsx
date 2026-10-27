// @vitest-environment jsdom
//
// "Can't find it?" under a shop search that found nothing
// (src/store/components/CardRequestPanel.tsx): links a card we do have when
// the search was just typed loosely, and otherwise lets the visitor ask to
// hear when the card is in — a wishlist save when signed in, a back-in-stock
// email for guests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const SHEOLDRED = "11111111-1111-4111-8111-111111111111";
const WHISPERING = "22222222-2222-4222-8222-222222222222";
const JACE = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string; email: string },
  wishlistLoaded: true,
  wishlisted: new Set<string>(),
  toggle: vi.fn(async (): Promise<"ok" | "error" | "signin_required"> => "ok"),
  search: vi.fn(),
  inStock: [] as string[],
  stockError: false,
  stockQueries: [] as string[][],
}));

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: (table: string) => ({
      select: () => ({
        in: (_column: string, ids: string[]) => ({
          limit: async () => {
            mocks.stockQueries.push(ids);
            if (table !== "inventory_public" || mocks.stockError) return { data: null, error: { message: "boom" } };
            return { data: ids.filter((id) => mocks.inStock.includes(id)).map((oracle_id) => ({ oracle_id })), error: null };
          },
        }),
      }),
    }),
  },
}));
vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user, loading: false }),
}));
vi.mock("../src/store/lib/WishlistContext", () => ({
  useWishlist: () => ({
    loaded: mocks.wishlistLoaded,
    pending: new Set<string>(),
    isWishlisted: (id: string) => mocks.wishlisted.has(id),
    toggle: mocks.toggle,
  }),
}));
vi.mock("../src/store/lib/sellApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/store/lib/sellApi")>()),
  searchSellPrintings: mocks.search,
}));

const { CardRequestPanel } = await import("../src/store/components/CardRequestPanel");
const { RouterProvider } = await import("../src/store/lib/router");
const { distinctCards } = await import("../src/store/lib/cardRequest");

function printing(oracleId: string, cardName: string, set = "dmu") {
  return { oracleId, cardName, imageUrl: `https://cards.scryfall.io/small/${set}/${oracleId}.jpg` };
}

function found(...printings: ReturnType<typeof printing>[]) {
  mocks.search.mockResolvedValue({ printings, totalCards: printings.length, hasMore: false, page: 1 });
}

function renderPanel(query: string) {
  return render(
    <RouterProvider>
      <CardRequestPanel query={query} />
    </RouterProvider>,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocks.user = null;
  mocks.wishlistLoaded = true;
  mocks.wishlisted = new Set();
  mocks.toggle.mockReset().mockResolvedValue("ok");
  mocks.search.mockReset();
  mocks.inStock = [];
  mocks.stockError = false;
  mocks.stockQueries = [];
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("distinctCards", () => {
  it("lists each card once, in search order, skipping printings with no card id", () => {
    expect(
      distinctCards([
        printing(SHEOLDRED, "Sheoldred, the Apocalypse", "dmu"),
        { oracleId: null, cardName: "Token", imageUrl: null },
        printing(WHISPERING, "Sheoldred, Whispering One", "nph"),
        printing(SHEOLDRED, "Sheoldred, the Apocalypse", "pdmu"),
      ]).map((c) => c.cardName),
    ).toEqual(["Sheoldred, the Apocalypse", "Sheoldred, Whispering One"]);
  });
});

describe("CardRequestPanel", () => {
  it("lets a guest ask for an email when the card they searched for is in", async () => {
    found(printing(SHEOLDRED, "Sheoldred, the Apocalypse"), printing(WHISPERING, "Sheoldred, Whispering One"), printing(SHEOLDRED, "Sheoldred, the Apocalypse", "pdmu"));
    const user = userEvent.setup();
    renderPanel("Sheoldred, the Apocalypse");
    expect(screen.getByRole("heading", { name: "Can’t find “Sheoldred, the Apocalypse”?" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Looking that card up");

    // The exact card is picked for them.
    const exact = await screen.findByRole("radio", { name: "Sheoldred, the Apocalypse" }, { timeout: 2000 });
    expect(exact).toBeChecked();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(mocks.search).toHaveBeenCalledWith("Sheoldred, the Apocalypse");
    expect(mocks.stockQueries).toEqual([[SHEOLDRED, WHISPERING]]);

    await user.type(screen.getByLabelText("Your email"), "jordan@example.com");
    await user.click(screen.getByRole("button", { name: "Email me when it's in" }));

    expect(await screen.findByText("We'll email jordan@example.com when Sheoldred, the Apocalypse is in stock.")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe("/api/stock-alerts/subscribe");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      oracleId: SHEOLDRED,
      cardName: "Sheoldred, the Apocalypse",
      email: "jordan@example.com",
      website: "",
    });
  });

  it("asks which card when the search matched several", async () => {
    found(printing(SHEOLDRED, "Sheoldred, the Apocalypse"), printing(WHISPERING, "Sheoldred, Whispering One"));
    const user = userEvent.setup();
    renderPanel("sheoldred");
    await screen.findByRole("radio", { name: "Sheoldred, Whispering One" }, { timeout: 2000 });
    expect(screen.getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true);

    await user.type(screen.getByLabelText("Your email"), "jordan@example.com");
    await user.click(screen.getByRole("button", { name: "Email me when it's in" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Pick the card you're looking for.");
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: "Sheoldred, Whispering One" }));
    await user.click(screen.getByRole("button", { name: "Email me when it's in" }));
    expect(await screen.findByText(/when Sheoldred, Whispering One is in stock/)).toBeInTheDocument();
  });

  it("links a card we have when the search was just typed loosely", async () => {
    found(printing(JACE, "Jace, the Mind Sculptor"));
    mocks.inStock = [JACE];
    renderPanel("jace mind sculptor");
    const link = await screen.findByRole("link", { name: /Jace, the Mind Sculptor/ }, { timeout: 2000 });
    expect(link).toHaveAttribute("href", "/shop/card/jace-the-mind-sculptor");
    expect(screen.getByText("We have this one in stock:")).toBeInTheDocument();
    // Nothing to ask for: no alert form.
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Your email")).not.toBeInTheDocument();
  });

  it("links what's in stock and offers alerts for the rest", async () => {
    found(printing(SHEOLDRED, "Sheoldred, the Apocalypse"), printing(WHISPERING, "Sheoldred, Whispering One"));
    mocks.inStock = [SHEOLDRED];
    renderPanel("sheoldred");
    expect(await screen.findByRole("link", { name: /Sheoldred, the Apocalypse/ }, { timeout: 2000 })).toHaveAttribute(
      "href",
      "/shop/card/sheoldred-the-apocalypse",
    );
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Sheoldred, Whispering One" })).toBeChecked();
    expect(screen.getByText(/After a different card\?/)).toBeInTheDocument();
  });

  it("still offers alerts when it can't check what's in stock", async () => {
    found(printing(JACE, "Jace, the Mind Sculptor"));
    mocks.stockError = true;
    renderPanel("jace mind sculptor");
    expect(await screen.findByRole("radio", { name: "Jace, the Mind Sculptor" }, { timeout: 2000 })).toBeChecked();
  });

  it("saves the card to a signed-in customer's wishlist", async () => {
    mocks.user = { id: "user-1", email: "pat@example.com" };
    found(printing(SHEOLDRED, "Sheoldred, the Apocalypse"));
    const user = userEvent.setup();
    renderPanel("sheoldred the apocalypse");
    await screen.findByRole("radio", { name: "Sheoldred, the Apocalypse" }, { timeout: 2000 });
    expect(screen.queryByLabelText("Your email")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save to my wishlist and email me" }));
    expect(mocks.toggle).toHaveBeenCalledWith(SHEOLDRED, "Sheoldred, the Apocalypse");
    expect(await screen.findByText(/Sheoldred, the Apocalypse is on your wishlist/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Alert settings" })).toHaveAttribute("href", "/account/notifications");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never takes a card off the wishlist that's already on it", async () => {
    mocks.user = { id: "user-1", email: "pat@example.com" };
    mocks.wishlisted = new Set([SHEOLDRED]);
    found(printing(SHEOLDRED, "Sheoldred, the Apocalypse"));
    const user = userEvent.setup();
    renderPanel("Sheoldred, the Apocalypse");
    await user.click(await screen.findByRole("button", { name: "It's on my wishlist" }, { timeout: 2000 }));
    expect(mocks.toggle).not.toHaveBeenCalled();
    expect(await screen.findByText(/is on your wishlist/)).toBeInTheDocument();
  });

  it("waits for the wishlist to load before saving to it", async () => {
    mocks.user = { id: "user-1", email: "pat@example.com" };
    mocks.wishlistLoaded = false;
    found(printing(SHEOLDRED, "Sheoldred, the Apocalypse"));
    renderPanel("Sheoldred, the Apocalypse");
    expect(await screen.findByRole("button", { name: "Save to my wishlist and email me" }, { timeout: 2000 })).toBeDisabled();
  });

  it("says when the wishlist save fails", async () => {
    mocks.user = { id: "user-1", email: "pat@example.com" };
    mocks.toggle.mockResolvedValue("error");
    found(printing(SHEOLDRED, "Sheoldred, the Apocalypse"));
    const user = userEvent.setup();
    renderPanel("Sheoldred, the Apocalypse");
    await user.click(await screen.findByRole("button", { name: "Save to my wishlist and email me" }, { timeout: 2000 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't save it to your wishlist.");
  });

  it("shows the server's message when a guest's request fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ ok: false, message: "Please enter a valid email address." }) });
    found(printing(SHEOLDRED, "Sheoldred, the Apocalypse"));
    const user = userEvent.setup();
    renderPanel("Sheoldred, the Apocalypse");
    await user.type(await screen.findByLabelText("Your email", {}, { timeout: 2000 }), "nope");
    await user.click(screen.getByRole("button", { name: "Email me when it's in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter a valid email address.");
  });

  it("points to email when there's no Magic card by that name", async () => {
    found();
    renderPanel("pikachu vmax");
    expect(await screen.findByText(/couldn’t find a Magic card called “pikachu vmax”/, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /@/ })).toHaveAttribute("href", expect.stringMatching(/^mailto:/));
    expect(mocks.stockQueries).toEqual([]);
  });

  it("says so when the card lookup fails", async () => {
    mocks.search.mockRejectedValue(new Error("Too many searches"));
    renderPanel("sheoldred");
    expect(await screen.findByText(/couldn’t look that card up just now/, {}, { timeout: 2000 })).toBeInTheDocument();
  });
});
