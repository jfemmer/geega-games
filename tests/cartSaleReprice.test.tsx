// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { StorewideSale, StorewideSaleState } from "../src/store/lib/storewideSale";

// The real CartProvider: cards already in a cart follow the storewide sale.
// When the sale starts, ends or changes while the page is open, the lines are
// re-priced on the spot from cart_item_availability (the database's sale-aware
// price, the one checkout charges), quietly: no loading state, and nothing is
// dropped or clamped (a guest's own checkout hold reads as sold out to them).

type AvailRow = { id: string; card_name: string; price_cents: number; original_price_cents: number | null; quantity: number };

const world = vi.hoisted(() => ({
  rows: new Map<string, AvailRow>(),
  availabilityCalls: 0,
  sale: { sale: null, known: true } as StorewideSaleState,
  saleListeners: new Set<() => void>(),
}));

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: {
    rpc: async (name: string, args: { p_ids?: string[] }) => {
      if (name !== "cart_item_availability") throw new Error(`unexpected rpc ${name}`);
      world.availabilityCalls += 1;
      const data = (args.p_ids ?? [])
        .map((id) => world.rows.get(id))
        .filter((r): r is AvailRow => !!r)
        .map((r) => ({ ...r, set_code: "tst", set_name: "Test", condition: "NM", finish: "nonfoil", image_url: null, variant_type: null, sale_only: false }));
      return { data, error: null };
    },
  },
}));

vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock("../src/store/lib/storewideSale", async () => {
  const actual = await vi.importActual<typeof import("../src/store/lib/storewideSale")>("../src/store/lib/storewideSale");
  const { useSyncExternalStore } = await import("react");
  return {
    storewideSaleKey: actual.storewideSaleKey,
    refreshStorewideSale: async () => world.sale,
    useStorewideSale: () =>
      useSyncExternalStore(
        (l: () => void) => {
          world.saleListeners.add(l);
          return () => world.saleListeners.delete(l);
        },
        () => world.sale,
      ),
  };
});

const { CartProvider, useCart } = await import("../src/store/lib/CartContext");

const BLACK_FRIDAY: StorewideSale = {
  id: "sale-1",
  name: "Black Friday Sale",
  discountPercent: 15,
  startsAt: "2026-11-27T14:32:00Z",
  endsAt: "2026-11-29T05:59:00Z",
};

function setSale(next: StorewideSaleState) {
  act(() => {
    world.sale = next;
    world.saleListeners.forEach((l) => l());
  });
}

function price(id: string, price_cents: number, original_price_cents: number | null = null, quantity = 5) {
  world.rows.set(id, { id, card_name: id, price_cents, original_price_cents, quantity });
}

const loadingSeen: boolean[] = [];
function Probe() {
  const cart = useCart();
  loadingSeen.push(cart.loading);
  return (
    <div>
      <ul>
        {cart.lines.map((l) => (
          <li key={l.inventoryItemId} data-testid={l.inventoryItemId}>
            {l.priceCents}|{l.originalPriceCents ?? "-"}|{l.quantity}
          </li>
        ))}
      </ul>
      <p data-testid="subtotal">{cart.subtotalCents}</p>
      <p data-testid="savings">{cart.saleSavingsCents}</p>
    </div>
  );
}

const line = (id: string) => screen.getByTestId(id).textContent;
const guestCart = () => JSON.parse(localStorage.getItem("geega.guestCart.v1") ?? "[]");

beforeEach(() => {
  world.rows.clear();
  world.availabilityCalls = 0;
  world.sale = { sale: null, known: true };
  world.saleListeners.clear();
  loadingSeen.length = 0;
  localStorage.setItem(
    "geega.guestCart.v1",
    JSON.stringify([
      { inventoryItemId: "cradle", quantity: 1 },
      { inventoryItemId: "signet", quantity: 2 },
    ]),
  );
  price("cradle", 8000);
  price("signet", 500);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function renderCart() {
  render(
    <CartProvider>
      <Probe />
    </CartProvider>,
  );
  await waitFor(() => expect(line("cradle")).toBe("8000|-|1"));
  expect(line("signet")).toBe("500|-|2");
  loadingSeen.length = 0;
}

describe("cards already in the cart follow the storewide sale", () => {
  it("re-prices the cart when a sale starts, with the regular price kept for the strike-through", async () => {
    await renderCart();
    price("cradle", 6800, 8000);
    price("signet", 425, 500);
    setSale({ sale: BLACK_FRIDAY, known: true });

    await waitFor(() => expect(line("cradle")).toBe("6800|8000|1"));
    expect(line("signet")).toBe("425|500|2");
    expect(screen.getByTestId("subtotal")).toHaveTextContent("7650");
    expect(screen.getByTestId("savings")).toHaveTextContent(String(1200 + 75 * 2));
    // Quiet: the cart never went back to "loading" (that would unmount the card form at checkout).
    expect(loadingSeen).not.toContain(true);
  });

  it("goes back to regular prices when the sale ends", async () => {
    price("cradle", 6800, 8000);
    price("signet", 425, 500);
    world.sale = { sale: BLACK_FRIDAY, known: true };
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
    await waitFor(() => expect(line("cradle")).toBe("6800|8000|1"));

    price("cradle", 8000);
    price("signet", 500);
    setSale({ sale: null, known: true });
    await waitFor(() => expect(line("cradle")).toBe("8000|-|1"));
    expect(line("signet")).toBe("500|-|2");
    expect(screen.getByTestId("savings")).toHaveTextContent("0");
  });

  it("re-prices when the percentage is changed mid-sale", async () => {
    world.sale = { sale: BLACK_FRIDAY, known: true };
    price("cradle", 6800, 8000);
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
    await waitFor(() => expect(line("cradle")).toBe("6800|8000|1"));
    price("cradle", 6000, 8000);
    setSale({ sale: { ...BLACK_FRIDAY, discountPercent: 25 }, known: true });
    await waitFor(() => expect(line("cradle")).toBe("6000|8000|1"));
  });

  it("doesn't re-load when the first answer about the sale arrives", async () => {
    world.sale = { sale: null, known: false };
    await renderCart();
    const calls = world.availabilityCalls;
    setSale({ sale: BLACK_FRIDAY, known: true }); // the page's first look, not a change
    await new Promise((r) => setTimeout(r, 20));
    expect(world.availabilityCalls).toBe(calls);
  });

  it("never drops or clamps a line while re-pricing, so a held card stays in the cart", async () => {
    await renderCart();
    // The guest is on the payment step: their own hold makes "signet" read as sold out to them.
    world.rows.delete("signet");
    price("cradle", 6800, 8000, 1);
    setSale({ sale: BLACK_FRIDAY, known: true });

    await waitFor(() => expect(line("cradle")).toBe("6800|8000|1"));
    expect(line("signet")).toBe("500|-|2");
    expect(guestCart()).toEqual([
      { inventoryItemId: "cradle", quantity: 1 },
      { inventoryItemId: "signet", quantity: 2 },
    ]);
    expect(loadingSeen).not.toContain(true);
  });
});
