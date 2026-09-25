// @vitest-environment jsdom
//
// Coverage for the home page's "Shop my deck" showcase and its hand-off to
// the header's ShopByDeck popover. Mocks the Supabase module (auth +
// customer_decks) and the cart hook — CartProvider's own network calls are
// unrelated here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocked = vi.hoisted(() => ({ signedIn: false }));

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({
        data: {
          session: mocked.signedIn
            ? { user: { id: "user-1", email: "shopper@example.com" } }
            : null,
        },
      }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: [{ id: "deck-1", name: "Atraxa Superfriends", format: "commander", commander_name: "Atraxa" }],
          }),
        }),
      }),
    }),
  },
}));

vi.mock("../src/store/lib/CartContext", () => ({
  useCart: () => ({ addItem: async () => {} }),
}));

const { AuthProvider } = await import("../src/store/lib/AuthContext");
const { RouterProvider } = await import("../src/store/lib/router");
const { default: DeckShowcase } = await import("../src/store/components/DeckShowcase");
const { default: ShopByDeck } = await import("../src/store/components/ShopByDeck");

function renderPage() {
  return render(
    <AuthProvider>
      <RouterProvider>
        <ShopByDeck />
        <DeckShowcase />
      </RouterProvider>
    </AuthProvider>,
  );
}

beforeEach(() => {
  mocked.signedIn = false;
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
});

describe("Shop my deck showcase", () => {
  it("labels the header button so it's discoverable", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: /shop my deck/i })).toBeInTheDocument();
  });

  it("sends signed-out visitors to sign up, returning them to the deck builder", async () => {
    renderPage();
    const cta = await screen.findByRole("link", { name: /create a free account to start/i });
    expect(cta).toHaveAttribute("href", `/signup?next=${encodeURIComponent("/account/decks")}`);
    expect(screen.queryByRole("button", { name: /shop a saved deck/i })).not.toBeInTheDocument();
  });

  it("opens the header deck shopper for signed-in customers", async () => {
    mocked.signedIn = true;
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /shop a saved deck/i }));

    const list = await screen.findByRole("listbox", { name: /your saved decks/i });
    expect(list).toHaveTextContent("Atraxa Superfriends");
    expect(screen.getByRole("button", { name: /shop my deck/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // A second click keeps it open rather than toggling it shut.
    await user.click(screen.getByRole("button", { name: /shop a saved deck/i }));
    expect(screen.getByRole("button", { name: /shop my deck/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
