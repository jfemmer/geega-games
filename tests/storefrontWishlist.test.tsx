// @vitest-environment jsdom
//
// Coverage for the wishlist heart toggle (WishlistButton <-> WishlistContext
// <-> customer_wishlist_items), mirroring storefrontSearch.test.tsx's
// approach: mock the Supabase module only (auth.getSession decides
// signed-in/out; a small in-memory table stands in for
// customer_wishlist_items), then drive real components through
// @testing-library/react. Deliberately renders AuthProvider + RouterProvider
// + WishlistProvider directly rather than the full <App/> — CartProvider's
// own network calls are unrelated to this feature and would just be more
// surface to mock for no additional coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocked = vi.hoisted(() => {
  const state = {
    signedIn: false,
    wishlistRows: new Set<string>(),
  };
  const calls: { op: "select" | "insert" | "delete"; payload?: unknown }[] = [];
  return { state, calls };
});

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({
        data: {
          session: mocked.state.signedIn
            ? { user: { id: "user-1", email: "shopper@example.com" } }
            : null,
        },
      }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
    from: (table: string) => {
      if (table !== "customer_wishlist_items") {
        throw new Error(`unexpected table in wishlist test: ${table}`);
      }
      return {
        select: () => {
          mocked.calls.push({ op: "select" });
          return Promise.resolve({
            data: [...mocked.state.wishlistRows].map((oracle_id) => ({ oracle_id })),
            error: null,
          });
        },
        insert: (row: { user_id: string; oracle_id: string; card_name: string }) => {
          mocked.calls.push({ op: "insert", payload: row });
          mocked.state.wishlistRows.add(row.oracle_id);
          return Promise.resolve({ error: null });
        },
        delete: () => {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq: (col: string, val: unknown) => {
              filters[col] = val;
              return builder;
            },
            then: (
              resolve: (v: { error: null }) => void,
            ) => {
              mocked.calls.push({ op: "delete", payload: filters });
              if (typeof filters.oracle_id === "string") {
                mocked.state.wishlistRows.delete(filters.oracle_id);
              }
              resolve({ error: null });
            },
          };
          return builder;
        },
      };
    },
  },
}));

const { AuthProvider } = await import("../src/store/lib/AuthContext");
const { RouterProvider } = await import("../src/store/lib/router");
const { WishlistProvider } = await import("../src/store/lib/WishlistContext");
const { default: WishlistButton } = await import(
  "../src/store/components/WishlistButton"
);

function renderButton() {
  return render(
    <AuthProvider>
      <RouterProvider>
        <WishlistProvider>
          <WishlistButton oracleId="oracle-dark-ritual" cardName="Dark Ritual" />
        </WishlistProvider>
      </RouterProvider>
    </AuthProvider>,
  );
}

beforeEach(() => {
  mocked.state.signedIn = false;
  mocked.state.wishlistRows = new Set();
  mocked.calls.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("wishlist heart toggle", () => {
  it("prompts sign-in instead of saving when signed out", async () => {
    const user = userEvent.setup();
    renderButton();

    const heart = await screen.findByRole("button", { name: /save dark ritual/i });
    await user.click(heart);

    expect(
      await screen.findByText(/save cards and we.ll email you when they restock/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/login?next="),
    );
    // No mutation was attempted while signed out.
    expect(mocked.calls.filter((c) => c.op !== "select")).toHaveLength(0);
  });

  it("saves a card on click when signed in, and shows it as saved", async () => {
    mocked.state.signedIn = true;
    const user = userEvent.setup();
    renderButton();

    const heart = await screen.findByRole("button", { name: /save dark ritual/i });
    expect(heart).toHaveAttribute("aria-pressed", "false");

    await user.click(heart);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /remove dark ritual/i }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    const insertCall = mocked.calls.find((c) => c.op === "insert");
    expect(insertCall?.payload).toMatchObject({
      user_id: "user-1",
      oracle_id: "oracle-dark-ritual",
      card_name: "Dark Ritual",
    });
  });

  it("loads already-saved state on mount and removes it on click", async () => {
    mocked.state.signedIn = true;
    mocked.state.wishlistRows.add("oracle-dark-ritual");
    const user = userEvent.setup();
    renderButton();

    const heart = await screen.findByRole("button", { name: /remove dark ritual/i });
    expect(heart).toHaveAttribute("aria-pressed", "true");

    await user.click(heart);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /save dark ritual/i }),
      ).toHaveAttribute("aria-pressed", "false"),
    );
    const deleteCall = mocked.calls.find((c) => c.op === "delete");
    expect(deleteCall?.payload).toMatchObject({
      user_id: "user-1",
      oracle_id: "oracle-dark-ritual",
    });
  });
});
