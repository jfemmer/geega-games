// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

// The shop, deals, set and kiosk grids (useCatalog) follow the storewide sale
// only while it runs: when it ends with a page open, the cards on screen are
// re-read in place and show their regular prices again — no reload, no
// loading flash (the cards stay until the new prices arrive), and a failed
// re-read leaves them as they were. The sale comes from the real shared module.

const world = vi.hoisted(() => ({
  saleOn: false,
  searchCalls: 0,
  failSearch: false,
}));

const SALE = {
  id: "sale-1",
  name: "Black Friday Sale",
  discount_percent: 15,
  starts_at: "2026-11-27T14:32:00Z",
  ends_at: "2099-11-29T05:59:00Z",
};

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: async (name: string) => {
      if (name === "current_storewide_sale") return { data: world.saleOn ? [SALE] : [], error: null };
      if (name !== "search_inventory") throw new Error(`unexpected rpc ${name}`);
      world.searchCalls += 1;
      if (world.failSearch) return { data: null, error: { message: "network down" } };
      const sale = world.saleOn;
      return {
        data: [
          {
            id: "inv-1",
            card_name: "Gaea's Cradle",
            set_code: "usg",
            set_name: "Urza's Saga",
            quantity: 1,
            image_url: null,
            price_cents: sale ? 68000 : 80000,
            original_price_cents: sale ? 80000 : null,
            deal_discount_percent: sale ? 15 : null,
            condition: "NM",
            finish: "nonfoil",
            total_count: 1,
          },
        ],
        error: null,
      };
    },
  },
}));

const { useCatalog, DEFAULT_FILTERS } = await import("../src/store/lib/useCatalog");
const { refreshStorewideSale } = await import("../src/store/lib/storewideSale");

async function setSale(on: boolean) {
  world.saleOn = on;
  await act(async () => {
    await refreshStorewideSale();
  });
}

beforeEach(async () => {
  world.searchCalls = 0;
  world.failSearch = false;
  await setSale(true); // the page opens during the sale
});

afterEach(cleanup);

async function openGrid() {
  const loadingSeen: boolean[] = [];
  const hook = renderHook(() => {
    const result = useCatalog(DEFAULT_FILTERS, 0);
    loadingSeen.push(result.loading);
    return result;
  });
  await waitFor(() => expect(hook.result.current.cards[0]?.priceCents).toBe(68000), { timeout: 2000 });
  loadingSeen.length = 0;
  return { hook, loadingSeen };
}

describe("open shop grids when the storewide sale ends", () => {
  it("go back to regular prices in place, without a loading flash", async () => {
    const { hook, loadingSeen } = await openGrid();
    expect(hook.result.current.cards[0]).toMatchObject({ priceCents: 68000, originalPriceCents: 80000, isDeal: true });

    await setSale(false); // the sale ends
    await waitFor(() => expect(hook.result.current.cards[0]?.priceCents).toBe(80000));
    expect(hook.result.current.cards[0]).toMatchObject({ originalPriceCents: null, isDeal: false });
    expect(loadingSeen).not.toContain(true);
    expect(hook.result.current.error).toBeNull();
  });

  it("keep what's on screen if the re-read fails", async () => {
    const { hook, loadingSeen } = await openGrid();
    world.failSearch = true;
    const calls = world.searchCalls;
    await setSale(false);
    await waitFor(() => expect(world.searchCalls).toBe(calls + 1));
    await new Promise((r) => setTimeout(r, 20));
    expect(hook.result.current.cards).toHaveLength(1);
    expect(hook.result.current.error).toBeNull();
    expect(loadingSeen).not.toContain(true);
  });

  it("re-read once per change, not on every look at the sale", async () => {
    await openGrid();
    const calls = world.searchCalls;
    await setSale(true);
    await setSale(true);
    expect(world.searchCalls).toBe(calls);
  });
});
