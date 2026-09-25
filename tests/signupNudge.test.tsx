// @vitest-environment jsdom
//
// Coverage for the "create a free account" prompts: the ?next= redirect
// helpers, and when the corner SignupNudge does and doesn't appear. Mocks
// only the Supabase module (auth.getSession decides signed-in/out), like
// storefrontWishlist.test.tsx.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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

beforeEach(() => {
  mocked.signedIn = false;
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
  it("stays hidden on the first couple of pages, then appears", async () => {
    renderNudge();
    await visit("/shop");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    await visit("/shop/sets");
    const nudge = await screen.findByRole("complementary", { name: /free account/i });
    expect(nudge).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create account/i })).toHaveAttribute(
      "href",
      `/signup?next=${encodeURIComponent("/shop/sets")}`,
    );
  });

  it("never shows on sign-in, sign-up, checkout or account pages", async () => {
    renderNudge();
    await visit("/shop", "/shop/sets", "/login");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    await visit("/checkout");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    await visit("/account/orders");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("stays dismissed once closed", async () => {
    const user = userEvent.setup();
    renderNudge();
    await visit("/shop", "/shop/sets");
    await user.click(await screen.findByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    await visit("/shop?sort=newest", "/");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    // A fresh page load within the month doesn't bring it back either.
    cleanup();
    renderNudge();
    await visit("/shop", "/shop/sets");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("is never shown to a signed-in customer", async () => {
    mocked.signedIn = true;
    renderNudge();
    await visit("/shop", "/shop/sets", "/");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});
