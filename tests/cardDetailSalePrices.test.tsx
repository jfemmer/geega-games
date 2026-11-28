// @vitest-environment jsdom
//
// A card page left open when the storewide sale ends goes back to the card's
// regular price in place: no reload and no loading screen. Renders the real
// CardDetailPage with get_card_detail and current_storewide_sale mocked; the
// sale comes from the real shared module (src/store/lib/storewideSale.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

const world = vi.hoisted(() => ({ saleOn: true, detailCalls: 0 }));

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: async (name: string) => {
      if (name === "current_storewide_sale") {
        return {
          data: world.saleOn
            ? [{ id: "sale-1", name: "Black Friday Sale", discount_percent: 15, starts_at: "2026-11-27T14:32:00Z", ends_at: "2099-11-29T05:59:00Z" }]
            : [],
          error: null,
        };
      }
      if (name !== "get_card_detail") throw new Error(`unexpected rpc: ${name}`);
      world.detailCalls += 1;
      const sale = world.saleOn;
      return {
        data: {
          oracleId: "ea5103f5-27e0-4eb1-902c-7f34652d6bf3",
          cardName: "Orcish Bowmasters",
          listings: [
            {
              id: "07e03967-5c4a-4f0e-9d1b-2a7c1f0e9b11",
              scryfallId: null,
              setCode: "ltr",
              setName: "The Lord of the Rings: Tales of Middle-earth",
              collectorNumber: "103",
              rarity: "rare",
              condition: "NM",
              finish: "nonfoil",
              variantType: null,
              quantity: 1,
              priceCents: sale ? 3485 : 4100,
              isDeal: sale,
              originalPriceCents: sale ? 4100 : null,
              dealDiscountPercent: sale ? 15 : null,
              dealSource: null,
              dealNote: null,
              imageUrl: null,
            },
          ],
          inStockCount: 1,
          minPriceCents: sale ? 3485 : 4100,
          maxPriceCents: sale ? 3485 : 4100,
        },
        error: null,
      };
    },
  },
}));

vi.mock("../src/store/lib/CartContext", () => ({ useCart: () => ({ addItem: async () => {} }) }));
vi.mock("../src/store/lib/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("../src/store/lib/WishlistContext", () => ({
  useWishlist: () => ({ isWishlisted: () => false, pending: new Set<string>(), toggle: async () => {} }),
}));

const { RouterProvider } = await import("../src/store/lib/router");
const { default: CardDetailPage } = await import("../src/store/pages/CardDetailPage");
const { refreshStorewideSale } = await import("../src/store/lib/storewideSale");

async function setSale(on: boolean) {
  world.saleOn = on;
  await act(async () => {
    await refreshStorewideSale();
  });
}

beforeEach(async () => {
  world.detailCalls = 0;
  await setSale(true);
});
afterEach(cleanup);

describe("a card page open when the storewide sale ends", () => {
  it("shows the regular price again, in place", async () => {
    window.history.replaceState({}, "", "/shop/card/orcish-bowmasters");
    render(
      <RouterProvider>
        <CardDetailPage slug="orcish-bowmasters" />
      </RouterProvider>,
    );
    await screen.findByRole("heading", { level: 1, name: "Orcish Bowmasters" });
    expect(screen.getAllByText("$34.85").length).toBeGreaterThan(0);

    await setSale(false);
    await waitFor(() => expect(screen.queryAllByText("$34.85")).toHaveLength(0));
    expect(screen.getAllByText("$41.00").length).toBeGreaterThan(0);
    // Never went back to the loading screen: the heading stayed up throughout.
    expect(screen.getByRole("heading", { level: 1, name: "Orcish Bowmasters" })).toBeInTheDocument();
    expect(world.detailCalls).toBe(2);
  });
});
