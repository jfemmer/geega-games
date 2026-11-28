// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { StorewideSale } from "../src/store/lib/storewideSale";

// The real CartProvider: cards already in a cart follow the storewide sale.
// When the sale starts, ends or changes while the page is open, the lines are
// re-priced on the spot from cart_item_availability (the database's sale-aware
// price, the one checkout charges), quietly: no loading state, and nothing is
// dropped or clamped (a guest's own checkout hold reads as sold out to them).
// The sale comes from the real shared module (src/store/lib/storewideSale.ts),
// fed by a mocked current_storewide_sale.

type AvailRow = { id: string; card_name: string; price_cents: number; original_price_cents: number | null; quantity: number };

const world = vi.hoisted(() => ({
  rows: new Map<string, AvailRow>(),
  availabilityCalls: 0,
  sale: null as Record<string, unknown> | null,
}));

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: {
    rpc: async (name: string, args: { p_ids?: string[] }) => {
      if (name === "current_storewide_sale") return { data: world.sale ? [world.sale] : [], error: null };
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

const { CartProvider, useCart } = await import("../src/store/lib/CartContext");
const { refreshStorewideSale } = await import("../src/store/lib/storewideSale");

const BLACK_FRIDAY: StorewideSale = {
  id: "sale-1",
  name: "Black Friday Sale",
  discountPercent: 15,
  startsAt: "2026-11-27T14:32:00Z",
  endsAt: "2026-11-29T05:59:00Z",
};

const saleRow = (sale: StorewideSale) => ({
  id: sale.id,
  name: sale.name,
  discount_percent: sale.discountPercent,
  starts_at: sale.startsAt,
  ends_at: sale.endsAt,
});

/** What the database says about the sale now, as the page's next look picks it up. */
async function setSale(sale: StorewideSale | null) {
  world.sale = sale ? saleRow(sale) : null;
  await act(async () => {
    await refreshStorewideSale();
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

beforeEach(async () => {
  world.rows.clear();
  world.availabilityCalls = 0;
  await setSale(null); // each test starts with no sale, already known
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
    await setSale(BLACK_FRIDAY);

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
    await setSale(BLACK_FRIDAY);
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
    await waitFor(() => expect(line("cradle")).toBe("6800|8000|1"));

    price("cradle", 8000);
    price("signet", 500);
    await setSale(null);
    await waitFor(() => expect(line("cradle")).toBe("8000|-|1"));
    expect(line("signet")).toBe("500|-|2");
    expect(screen.getByTestId("savings")).toHaveTextContent("0");
  });

  it("re-prices when the percentage is changed mid-sale", async () => {
    await setSale(BLACK_FRIDAY);
    price("cradle", 6800, 8000);
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
    await waitFor(() => expect(line("cradle")).toBe("6800|8000|1"));
    price("cradle", 6000, 8000);
    await setSale({ ...BLACK_FRIDAY, discountPercent: 25 });
    await waitFor(() => expect(line("cradle")).toBe("6000|8000|1"));
  });

  it("doesn't re-load when nothing about the prices changed (same sale looked at again)", async () => {
    await renderCart();
    await setSale(null);
    await setSale(null);
    expect(world.availabilityCalls).toBe(1); // only the cart's own first load
  });

  it("never drops or clamps a line while re-pricing, so a held card stays in the cart", async () => {
    await renderCart();
    // The guest is on the payment step: their own hold makes "signet" read as sold out to them.
    world.rows.delete("signet");
    price("cradle", 6800, 8000, 1);
    await setSale(BLACK_FRIDAY);

    await waitFor(() => expect(line("cradle")).toBe("6800|8000|1"));
    expect(line("signet")).toBe("500|-|2");
    expect(guestCart()).toEqual([
      { inventoryItemId: "cradle", quantity: 1 },
      { inventoryItemId: "signet", quantity: 2 },
    ]);
    expect(loadingSeen).not.toContain(true);
  });
});
