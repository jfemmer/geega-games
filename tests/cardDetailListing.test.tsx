// @vitest-environment jsdom
//
// A card page's ?listing=<id> address — the one the structured data and the
// product feed give each copy for sale — opens the page with that copy
// chosen: listed first, marked, and its picture shown. Google asks that each
// variant's address "preselect" it this way. Renders the real CardDetailPage
// with get_card_detail mocked; cart, auth and wishlist hooks are stubbed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const NM_ID = "07e03967-5c4a-4f0e-9d1b-2a7c1f0e9b11";
const FOIL_ID = "c031c54e-8b7d-4a52-a0e3-6f2d9c4b7a22";

const LISTINGS = [
  {
    id: NM_ID,
    collectorNumber: "103",
    condition: "NM",
    finish: "nonfoil",
    priceCents: 4100,
    imageUrl: "https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1",
  },
  {
    id: FOIL_ID,
    collectorNumber: "433",
    condition: "LP",
    finish: "foil",
    priceCents: 4700,
    imageUrl: "https://cards.scryfall.io/large/front/d/e/de2de055.jpg?2",
  },
];

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: async (name: string) => {
      if (name !== "get_card_detail") throw new Error(`unexpected rpc: ${name}`);
      return {
        data: {
          oracleId: "ea5103f5-27e0-4eb1-902c-7f34652d6bf3",
          cardName: "Orcish Bowmasters",
          listings: LISTINGS.map((l) => ({
            scryfallId: null,
            setCode: "ltr",
            setName: "The Lord of the Rings: Tales of Middle-earth",
            rarity: "rare",
            variantType: null,
            quantity: 1,
            isDeal: false,
            originalPriceCents: null,
            dealDiscountPercent: null,
            dealSource: null,
            dealNote: null,
            ...l,
          })),
          inStockCount: 2,
          minPriceCents: 4100,
          maxPriceCents: 4700,
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

async function openAt(address: string) {
  window.history.replaceState({}, "", address);
  render(
    <RouterProvider>
      <CardDetailPage slug="orcish-bowmasters" />
    </RouterProvider>,
  );
  await screen.findByRole("heading", { level: 1, name: "Orcish Bowmasters" });
}

/** The listing rows, top to bottom, by collector number. */
function rowOrder(): string[] {
  const list = screen.getByRole("heading", { name: "Available listings" }).parentElement!.querySelector("ul") as HTMLElement;
  return within(list)
    .getAllByRole("listitem")
    .map((li) => /#(\d+)/.exec(li.textContent ?? "")?.[1] ?? "?");
}

function cardPicture(): HTMLImageElement {
  return screen.getByRole("img", { name: "Orcish Bowmasters" }) as HTMLImageElement;
}

afterEach(() => {
  cleanup();
});

describe("a card page opened at a listing's own address", () => {
  it("shows that copy first, marked as chosen, with its picture", async () => {
    await openAt(`/shop/card/orcish-bowmasters?listing=${FOIL_ID}`);

    expect(rowOrder()).toEqual(["433", "103"]);
    const chosen = screen.getByText("Selected").closest("li") as HTMLElement;
    expect(chosen).toHaveAttribute("aria-current", "true");
    expect(chosen).toHaveTextContent("#433");
    expect(within(chosen).getByText("$47.00")).toBeInTheDocument();
    expect(within(chosen).getByRole("button", { name: "Add to cart" })).toBeEnabled();
    expect(cardPicture().getAttribute("src")).toBe("https://cards.scryfall.io/large/front/d/e/de2de055.jpg?2");
  });

  it("is the plain card page without one: cheapest first, nothing marked", async () => {
    await openAt("/shop/card/orcish-bowmasters");

    expect(rowOrder()).toEqual(["103", "433"]);
    expect(screen.queryByText("Selected")).toBeNull();
    expect(cardPicture().getAttribute("src")).toBe("https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1");
  });

  it("is the plain card page when that copy has sold, or the address is garbled", async () => {
    for (const listing of ["0a0a0a0a-0000-4000-8000-000000000000", "not-a-listing"]) {
      await openAt(`/shop/card/orcish-bowmasters?listing=${listing}`);
      expect(rowOrder()).toEqual(["103", "433"]);
      expect(screen.queryByText("Selected")).toBeNull();
      cleanup();
    }
  });

  it("tells a signed-out shopper that signed-in orders are 5% off", async () => {
    await openAt("/shop/card/orcish-bowmasters");
    const note = document.querySelector(".gg-card-detail__membernote") as HTMLElement;
    expect(note).toHaveTextContent("Signed-in orders are 5% off. Sign in or create a free account.");
    expect([...note.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      `/login?next=${encodeURIComponent("/shop/card/orcish-bowmasters")}`,
      `/signup?next=${encodeURIComponent("/shop/card/orcish-bowmasters")}`,
    ]);
  });

  it("asks for the card's picture first, the same files the server told the browser to fetch early", async () => {
    await openAt("/shop/card/orcish-bowmasters");
    const picture = cardPicture();
    expect(picture.getAttribute("fetchpriority")).toBe("high");
    expect(picture.getAttribute("sizes")).toBe("(max-width: 640px) 80vw, 360px");
    expect(picture.getAttribute("srcset")).toBe(
      "https://cards.scryfall.io/normal/front/7/c/7c024bae.jpg?1 488w, https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1 672w",
    );
  });
});
