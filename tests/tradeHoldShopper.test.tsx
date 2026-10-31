// @vitest-environment jsdom
//
// Shoppers and copies held for a trade: the card page says a copy is on hold
// for a pending trade and offers "Notify me if it's released"; the cart and
// checkout say when a line came out because a trade holds it. Renders the
// real components with Supabase and the cart stubbed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const HELD_ID = "0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f";
const ORACLE = "ea5103f5-27e0-4eb1-902c-7f34652d6bf3";

let listings: Record<string, unknown>[] = [];
let held: Record<string, unknown>[] = [];
let user: { id: string; email: string | null } | null = null;
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "get_card_detail") {
        return {
          data: {
            oracleId: ORACLE, cardName: "Mox Diamond", listings, inStockCount: listings.length,
            minPriceCents: listings.length ? 30000 : null, maxPriceCents: listings.length ? 30000 : null,
          },
          error: null,
        };
      }
      if (name === "trade_held_copies") return { data: held, error: null };
      throw new Error(`unexpected rpc: ${name}`);
    },
    auth: { getSession: async () => ({ data: { session: user ? { access_token: "tok" } : null } }) },
  },
}));

const cart = { tradeHeld: [] as unknown[], dismissTradeHeld: vi.fn(), addItem: async () => {} };
vi.mock("../src/store/lib/CartContext", () => ({ useCart: () => cart }));
vi.mock("../src/store/lib/AuthContext", () => ({ useAuth: () => ({ user }) }));
vi.mock("../src/store/lib/WishlistContext", () => ({
  useWishlist: () => ({ isWishlisted: () => false, pending: new Set<string>(), toggle: async () => {} }),
}));

const { RouterProvider } = await import("../src/store/lib/router");
const { default: CardDetailPage } = await import("../src/store/pages/CardDetailPage");
const { default: TradeHeldNotices } = await import("../src/store/components/TradeHeldNotices");

const heldRow = (over: Record<string, unknown> = {}) => ({
  id: HELD_ID, card_name: "Mox Diamond", set_code: "tmp", set_name: "Tempest", collector_number: "280",
  condition: "LP", finish: "nonfoil", variant_type: null, image_url: null, price_cents: 30000,
  held_quantity: 1, sellable_quantity: 0, ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
let replyAvailable: () => void;
/** The request to the hold-watch endpoint (the page also loads trade terms). */
const watchCall = () => {
  const call = fetchMock.mock.calls.find((c) => c[0] === "/api/stock-alerts/hold-watch");
  expect(call, "asked the hold-watch endpoint").toBeTruthy();
  return call as unknown as [string, RequestInit];
};
beforeEach(() => {
  listings = [];
  held = [heldRow()];
  user = null;
  rpcCalls.length = 0;
  cart.tradeHeld = [];
  let watchReply = { ok: true, status: "watching" };
  fetchMock = vi.fn(async (url: string) =>
    url === "/api/stock-alerts/hold-watch"
      ? new Response(JSON.stringify(watchReply), { status: 200 })
      : new Response(JSON.stringify({ ok: false }), { status: 503 }),
  );
  replyAvailable = () => {
    watchReply = { ok: true, status: "available" };
  };
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const heldSection = () => within(screen.getByRole("heading", { name: "On hold for a pending trade" }).parentElement as HTMLElement);

async function openCard() {
  window.history.replaceState({}, "", "/shop/card/mox-diamond");
  render(
    <RouterProvider>
      <CardDetailPage slug="mox-diamond" />
    </RouterProvider>,
  );
  await screen.findByRole("heading", { level: 1, name: "Mox Diamond" });
}

describe("a card a trade is holding", () => {
  it("says why it can't be bought, and a guest can ask to hear if it's released", async () => {
    await openCard();
    expect(await screen.findByRole("heading", { name: "On hold for a pending trade" })).toBeTruthy();
    expect(screen.getByText("On hold for a pending trade", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText(/Our copy is held for a customer’s trade/)).toBeTruthy();
    expect(screen.getByText("Tempest #280 · Lightly Played")).toBeTruthy();
    expect(rpcCalls.find((c) => c.name === "trade_held_copies")?.args).toEqual({ p_oracle_id: ORACLE, p_ids: null });

    fireEvent.change(screen.getByLabelText("Notify me if it’s released"), { target: { value: "me@example.com" } });
    fireEvent.click(heldSection().getByRole("button", { name: "Notify me" }));
    expect(await screen.findByText(/We’ll email you if this Mox Diamond is released/)).toBeTruthy();
    const [, init] = watchCall();
    expect(JSON.parse(String(init.body))).toEqual({ inventoryItemId: HELD_ID, email: "me@example.com" });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("a signed-in shopper asks with one tap, using their account", async () => {
    user = { id: "u1", email: "member@example.com" };
    await openCard();
    fireEvent.click(await screen.findByRole("button", { name: "Notify me if it’s released" }));
    expect(await screen.findByText(/We’ll email member@example.com if this Mox Diamond is released/)).toBeTruthy();
    const [, init] = watchCall();
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("if it was released meanwhile, says so and reloads the card", async () => {
    replyAvailable();
    await openCard();
    fireEvent.change(await screen.findByLabelText("Notify me if it’s released"), { target: { value: "me@example.com" } });
    held = [];
    listings = [{ id: HELD_ID, scryfallId: null, setCode: "tmp", setName: "Tempest", collectorNumber: "280", rarity: "rare", condition: "LP",
      finish: "nonfoil", variantType: null, imageUrl: null, quantity: 1, priceCents: 30000, isDeal: false, originalPriceCents: null,
      dealDiscountPercent: null, dealSource: null, dealNote: null }];
    fireEvent.click(heldSection().getByRole("button", { name: "Notify me" }));
    expect(await screen.findByRole("heading", { name: "Available listings" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "On hold for a pending trade" })).toBeNull());
  });

  it("only all-held lines are shown as held: a line with copies left is just for sale", async () => {
    held = [heldRow({ sellable_quantity: 1 })];
    await openCard();
    await screen.findByText("Currently out of stock");
    expect(screen.queryByRole("heading", { name: "On hold for a pending trade" })).toBeNull();
  });
});

describe("cart lines a trade took", () => {
  it("names the card and offers the notify button; dismissing calls the cart", () => {
    cart.tradeHeld = [{
      id: HELD_ID, cardName: "Mox Diamond", setCode: "tmp", setName: "Tempest", collectorNumber: "280", condition: "LP",
      finish: "foil", variantType: null, imageUrl: null, priceCents: 30000, heldQuantity: 1, sellableQuantity: 0,
    }];
    render(
      <RouterProvider>
        <TradeHeldNotices />
      </RouterProvider>,
    );
    expect(screen.getByText(/is on hold for a pending trade, so we took it out of your cart/)).toBeTruthy();
    expect(screen.getByText("(Tempest #280 · Lightly Played · Foil)")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Mox Diamond" }).getAttribute("href")).toBe("/shop/card/mox-diamond");
    expect(screen.getByLabelText("Notify me if it’s released")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the note about Mox Diamond" }));
    expect(cart.dismissTradeHeld).toHaveBeenCalledWith(HELD_ID);
  });

  it("a line only cut down says so, without the notify button", () => {
    cart.tradeHeld = [{
      id: HELD_ID, cardName: "Mox Diamond", setCode: "tmp", setName: "Tempest", collectorNumber: null, condition: "NM",
      finish: "nonfoil", variantType: null, imageUrl: null, priceCents: 30000, heldQuantity: 1, sellableQuantity: 1,
    }];
    render(
      <RouterProvider>
        <TradeHeldNotices />
      </RouterProvider>,
    );
    expect(screen.getByText(/is partly on hold for a pending trade/)).toBeTruthy();
    expect(screen.queryByLabelText("Notify me if it’s released")).toBeNull();
  });
});
