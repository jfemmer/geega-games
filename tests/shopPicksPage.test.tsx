// @vitest-environment jsdom
//
// /shop/picks?c=slug,… (src/store/pages/ShopPicksPage.tsx): a post about a
// few cards lands on exactly those cards, in the post's order, with the
// ones that sold since listed separately. Renders the real page with
// get_card_detail mocked; cart, auth and wishlist hooks are stubbed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

type Listing = { id: string; quantity: number; priceCents: number; condition?: string; finish?: string };

function detail(oracleId: string, cardName: string, listings: Listing[]) {
  return {
    oracleId,
    cardName,
    typeLine: "Instant",
    inStockCount: listings.length,
    minPriceCents: null,
    maxPriceCents: null,
    listings: listings.map((l) => ({
      scryfallId: null,
      setCode: "2xm",
      setName: "Double Masters",
      collectorNumber: "1",
      rarity: "uncommon",
      condition: "NM",
      finish: "nonfoil",
      variantType: null,
      imageUrl: null,
      isDeal: false,
      originalPriceCents: null,
      dealDiscountPercent: null,
      dealSource: null,
      dealNote: null,
      ...l,
    })),
  };
}

const CARDS: Record<string, ReturnType<typeof detail>> = {
  "lightning-bolt": detail("aaaaaaaa-0000-4000-8000-000000000001", "Lightning Bolt", [
    { id: "bolt-nm", quantity: 2, priceCents: 150 },
    { id: "bolt-foil", quantity: 1, priceCents: 900, finish: "foil", condition: "LP" },
  ]),
  "counterspell": detail("aaaaaaaa-0000-4000-8000-000000000002", "Counterspell", [{ id: "cs-nm", quantity: 1, priceCents: 125 }]),
  "sheoldred-the-apocalypse": detail("aaaaaaaa-0000-4000-8000-000000000003", "Sheoldred, the Apocalypse", []),
};

const rpcCalls = vi.hoisted(() => [] as string[]);

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: async (name: string, args: { p_slug: string }) => {
      if (name !== "get_card_detail") throw new Error(`unexpected rpc: ${name}`);
      rpcCalls.push(args.p_slug);
      return { data: CARDS[args.p_slug] ?? null, error: null };
    },
  },
}));
vi.mock("../src/store/lib/CartContext", () => ({ useCart: () => ({ addItem: async () => {} }) }));
vi.mock("../src/store/lib/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("../src/store/lib/WishlistContext", () => ({
  useWishlist: () => ({ isWishlisted: () => false, pending: new Set<string>(), toggle: async () => "ok" }),
}));

const { RouterProvider } = await import("../src/store/lib/router");
const { default: ShopPicksPage } = await import("../src/store/pages/ShopPicksPage");
const { listingTiles } = await import("../src/store/lib/cardDetail");

function openAt(address: string) {
  window.history.replaceState({}, "", address);
  return render(
    <RouterProvider>
      <ShopPicksPage />
    </RouterProvider>,
  );
}

beforeEach(() => {
  rpcCalls.length = 0;
});
afterEach(() => {
  cleanup();
});

describe("listingTiles", () => {
  it("turns a card's in-stock copies into shop tiles", () => {
    const tiles = listingTiles({
      ...CARDS["lightning-bolt"],
      listings: [...CARDS["lightning-bolt"].listings, { ...CARDS["lightning-bolt"].listings[0], id: "gone", quantity: 0 }],
    });
    expect(tiles.map((t) => [t.id, t.name, t.foil, t.type])).toEqual([
      ["bolt-nm", "Lightning Bolt", false, "Instant"],
      ["bolt-foil", "Lightning Bolt", true, "Instant"],
    ]);
  });
});

describe("ShopPicksPage", () => {
  it("shows every in-stock copy of each card in the post, in the post's order", async () => {
    openAt("/shop/picks?c=counterspell,lightning-bolt&utm_source=facebook&utm_medium=social&utm_campaign=picks-2026-10-27");
    expect(screen.getByRole("heading", { level: 1, name: "Cards from our post" })).toBeInTheDocument();

    await screen.findAllByRole("button", { name: /add to cart/i });
    const names = [...document.querySelectorAll(".gg-grid .gg-card-name")].map((el) => el.textContent?.trim());
    expect(names).toEqual(["Counterspell", "Lightning Bolt", "Lightning Bolt"]);
    expect(screen.getAllByRole("button", { name: /add to cart/i })).toHaveLength(3);
    expect(rpcCalls).toEqual(["counterspell", "lightning-bolt"]);
    expect(screen.getByRole("link", { name: "See everything in the shop" })).toHaveAttribute("href", "/shop");
  });

  it("lists the cards that sold since the post, linked to their pages", async () => {
    openAt("/shop/picks?c=sheoldred-the-apocalypse,lightning-bolt,not-a-card-we-have");
    const sold = await screen.findByRole("region", { name: "Sold since we posted" });
    expect(within(sold).getByRole("link", { name: "Sheoldred, the Apocalypse" })).toHaveAttribute(
      "href",
      "/shop/card/sheoldred-the-apocalypse",
    );
    // A card we no longer list at all is simply left out.
    expect(screen.queryByText(/not-a-card-we-have/)).toBeNull();
    expect(screen.getAllByRole("button", { name: /add to cart/i })).toHaveLength(2);
  });

  it("says so when everything in the post has sold", async () => {
    openAt("/shop/picks?c=sheoldred-the-apocalypse");
    expect(await screen.findByText("These cards have all sold since we posted them.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sheoldred, the Apocalypse" })).toHaveAttribute("href", "/shop/card/sheoldred-the-apocalypse");
    expect(screen.getByRole("link", { name: "See what’s in stock" })).toHaveAttribute("href", "/shop");
  });

  it("handles a link with no cards, or junk, without asking the database", () => {
    openAt("/shop/picks?c=../admin,%20");
    expect(screen.getByText("This link doesn’t list any cards.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse the shop" })).toHaveAttribute("href", "/shop");
    expect(rpcCalls).toEqual([]);
  });

  it("keeps the page out of search results", async () => {
    openAt("/shop/picks?c=counterspell");
    await screen.findAllByRole("button", { name: /add to cart/i });
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toMatch(/noindex/);
  });
});
