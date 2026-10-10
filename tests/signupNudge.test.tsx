// @vitest-environment jsdom
//
// Coverage for the "create a free account" prompts: the ?next= redirect
// helpers, and when the corner SignupNudge does and doesn't appear: right
// after a signed-out shopper adds a card to their cart. Mocks the Supabase
// module (auth.getSession decides signed-in/out), like
// storefrontWishlist.test.tsx, and the cart, whose count the test moves.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocked = vi.hoisted(() => ({ signedIn: false }));

// The cart, as the nudge sees it: a tiny store the test can change.
type CartState = { itemCount: number; subtotalCents: number; loading: boolean };
const cart = vi.hoisted(() => {
  let state: CartState = { itemCount: 0, subtotalCents: 0, loading: false };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: Partial<CartState>) {
      state = { ...state, ...next };
      listeners.forEach((listener) => listener());
    },
    reset(next: Partial<CartState> = {}) {
      state = { itemCount: 0, subtotalCents: 0, loading: false, ...next };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("../src/store/lib/CartContext", async () => {
  const React = await import("react");
  return { useCart: () => React.useSyncExternalStore(cart.subscribe, cart.get) };
});

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
  },
}));

const { AuthProvider } = await import("../src/store/lib/AuthContext");
const { RouterProvider, useRouter } = await import("../src/store/lib/router");
const { default: SignupNudge } = await import("../src/store/components/SignupNudge");
const { safeNextPath, rememberSignupNext, takeSignupNext } = await import(
  "../src/store/lib/authRedirect"
);

let go: (to: string) => void = () => {};
function NavHandle() {
  go = useRouter().navigate;
  return null;
}

function renderNudge() {
  return render(
    <AuthProvider>
      <RouterProvider>
        <NavHandle />
        <SignupNudge />
      </RouterProvider>
    </AuthProvider>,
  );
}

async function visit(...paths: string[]) {
  for (const p of paths) {
    await act(async () => go(p));
  }
}

/** The shopper adds a card: the cart's count and total go up. */
async function addToCart(priceCents = 1059) {
  const { itemCount, subtotalCents } = cart.get();
  await act(async () => cart.set({ itemCount: itemCount + 1, subtotalCents: subtotalCents + priceCents }));
}

beforeEach(() => {
  mocked.signedIn = false;
  cart.reset();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  window.scrollTo = () => {};
});

afterEach(() => {
  cleanup();
});

describe("safeNextPath", () => {
  it("keeps same-site paths and rejects anything that could leave the site", () => {
    expect(safeNextPath("/checkout")).toBe("/checkout");
    expect(safeNextPath("/shop?q=bolt")).toBe("/shop?q=bolt");
    expect(safeNextPath(null)).toBe("/account");
    expect(safeNextPath("https://evil.example")).toBe("/account");
    expect(safeNextPath("//evil.example")).toBe("/account");
    expect(safeNextPath("/\\evil.example")).toBe("/account");
  });
});

describe("remembered signup destination", () => {
  it("is read once, then cleared", () => {
    rememberSignupNext("/checkout");
    expect(takeSignupNext()).toBe("/checkout");
    expect(takeSignupNext()).toBeNull();
  });

  it("expires after a week", () => {
    localStorage.setItem(
      "gg_signup_next",
      JSON.stringify({ next: "/checkout", at: Date.now() - 8 * 24 * 60 * 60 * 1000 }),
    );
    expect(takeSignupNext()).toBeNull();
  });
});

describe("SignupNudge", () => {
  it("doesn't interrupt browsing: nothing until a card goes in the cart", async () => {
    renderNudge();
    await visit("/shop", "/shop/sets", "/shop/card/sol-ring", "/");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("appears as soon as a card is added, with what an account saves on this order", async () => {
    renderNudge();
    await visit("/shop/card/faerie-mastermind");
    await addToCart(1059);

    const nudge = await screen.findByRole("complementary", { name: "Save $0.53 on this order" });
    expect(nudge).toHaveTextContent("Added to your cart");
    expect(nudge).toHaveTextContent("your cards are 5% off, on this order and every one after. Your cart comes with you.");
    const back = encodeURIComponent("/shop/card/faerie-mastermind");
    expect(screen.getByRole("link", { name: /create free account/i })).toHaveAttribute("href", `/signup?next=${back}`);
    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute("href", `/login?next=${back}`);
  });

  it("keeps the saving up to date as the cart grows", async () => {
    renderNudge();
    await visit("/shop");
    await addToCart(1059);
    await addToCart(2000);
    expect(await screen.findByRole("complementary", { name: "Save $1.53 on this order" })).toBeInTheDocument();
  });

  it("doesn't count a cart saved from an earlier visit — only an add does", async () => {
    cart.reset({ loading: true });
    renderNudge();
    await visit("/shop");
    // The saved cart loads: two cards, already there.
    await act(async () => cart.set({ loading: false, itemCount: 2, subtotalCents: 3000 }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    // Then they add one.
    await addToCart(1000);
    expect(await screen.findByRole("complementary", { name: "Save $2.00 on this order" })).toBeInTheDocument();
  });

  it("never shows on checkout (which has its own offer), sign-in, sign-up or account pages", async () => {
    renderNudge();
    await visit("/shop");
    await addToCart();
    expect(await screen.findByRole("complementary")).toBeInTheDocument();
    for (const page of ["/checkout", "/login", "/signup", "/account/orders"]) {
      await visit(page);
      expect(screen.queryByRole("complementary"), page).not.toBeInTheDocument();
    }
  });

  it("stays dismissed once closed", async () => {
    const user = userEvent.setup();
    renderNudge();
    await visit("/shop");
    await addToCart();
    await user.click(await screen.findByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    await addToCart();
    await visit("/shop?sort=newest");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    // A fresh page load within the month doesn't bring it back either.
    cleanup();
    cart.reset();
    renderNudge();
    await visit("/shop");
    await addToCart();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("is never shown to a signed-in customer: they already get the discount", async () => {
    mocked.signedIn = true;
    renderNudge();
    await visit("/shop");
    await addToCart();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});
