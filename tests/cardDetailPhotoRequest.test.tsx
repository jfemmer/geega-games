// @vitest-environment jsdom
//
// The card page only offers "Request a photo" on listings whose regular
// price is $5 or more (PHOTO_REQUEST_MIN_PRICE_CENTS). Renders the real
// CardDetailPage with get_card_detail mocked; cart, auth and wishlist hooks
// are stubbed because they're unrelated to this rule.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

type Listing = {
  id: string;
  priceCents: number;
  originalPriceCents: number | null;
  isDeal: boolean;
  collectorNumber: string;
};

const mocked = vi.hoisted(() => ({ listings: [] as Listing[] }));

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: async (name: string) => {
      if (name !== "get_card_detail") throw new Error(`unexpected rpc: ${name}`);
      const prices = mocked.listings.map((l) => l.priceCents);
      return {
        data: {
          oracleId: "oracle-1",
          cardName: "Sol Ring",
          listings: mocked.listings.map((l) => ({
            scryfallId: null,
            setCode: "cmm",
            setName: "Commander Masters",
            rarity: "uncommon",
            condition: "near_mint",
            finish: "nonfoil",
            variantType: null,
            imageUrl: null,
            quantity: 1,
            dealDiscountPercent: null,
            dealSource: null,
            dealNote: null,
            ...l,
          })),
          inStockCount: mocked.listings.length,
          minPriceCents: prices.length ? Math.min(...prices) : null,
          maxPriceCents: prices.length ? Math.max(...prices) : null,
        },
        error: null,
      };
    },
  },
}));

vi.mock("../src/store/lib/CartContext", () => ({
  useCart: () => ({ addItem: async () => {} }),
}));

vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock("../src/store/lib/WishlistContext", () => ({
  useWishlist: () => ({ isWishlisted: () => false, pending: new Set<string>(), toggle: async () => {} }),
}));

const { RouterProvider } = await import("../src/store/lib/router");
const { default: CardDetailPage } = await import("../src/store/pages/CardDetailPage");

function listing(id: string, priceCents: number, originalPriceCents: number | null = null): Listing {
  return { id, priceCents, originalPriceCents, isDeal: originalPriceCents !== null, collectorNumber: id };
}

async function renderPage() {
  render(
    <RouterProvider>
      <CardDetailPage slug="sol-ring" />
    </RouterProvider>,
  );
  await screen.findByRole("heading", { level: 1, name: "Sol Ring" });
}

/** The listing row that shows this collector number. */
function row(collectorNumber: string): HTMLElement {
  const li = screen.getByText(new RegExp(`#${collectorNumber}\\b`)).closest("li");
  if (!li) throw new Error(`no listing row for #${collectorNumber}`);
  return li;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/shop/card/sol-ring");
});

afterEach(() => {
  cleanup();
});

describe("Card page photo requests ($5 minimum)", () => {
  it("offers a photo only on listings priced $5 or more", async () => {
    mocked.listings = [listing("101", 300), listing("102", 500), listing("103", 1200)];
    await renderPage();

    const photoButton = { name: /request a photo of this copy/i };
    expect(within(row("101")).queryByRole("button", photoButton)).not.toBeInTheDocument();
    expect(within(row("102")).getByRole("button", photoButton)).toBeInTheDocument();
    expect(within(row("103")).getByRole("button", photoButton)).toBeInTheDocument();
    expect(screen.getByText(/under any listing priced \$5 or more/i)).toBeInTheDocument();
  });

  it("keeps the option on a $6 card that's on sale for $4.50", async () => {
    mocked.listings = [listing("201", 450, 600)];
    await renderPage();

    expect(
      within(row("201")).getByRole("button", { name: /request a photo of this copy/i }),
    ).toBeInTheDocument();
  });

  it("points to email instead when every listing is under $5", async () => {
    mocked.listings = [listing("301", 99), listing("302", 499)];
    await renderPage();

    expect(screen.queryByRole("button", { name: /request a photo/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/want to see the actual card/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Email us" })).toBeInTheDocument();
  });
});
