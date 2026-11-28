// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

// The storefront's shared view of the storewide sale (src/store/lib/storewideSale.ts):
// one read shared by every caller, "not known yet" kept apart from "no sale",
// and a fresh look just after the sale ends so open tabs (and carts) drop it on time.

const rpc = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../src/supabase", () => ({ supabase: { rpc: (...args: unknown[]) => rpc.fn(...args) } }));

type Mod = typeof import("../src/store/lib/storewideSale");
let mod: Mod;

const row = (over: Record<string, unknown> = {}) => ({
  id: "sale-1",
  name: "Black Friday Sale",
  discount_percent: 15,
  starts_at: "2026-11-27T14:32:00Z",
  ends_at: new Date(Date.now() + 10_000).toISOString(),
  ...over,
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-27T22:00:00Z"));
  rpc.fn.mockReset();
  vi.resetModules(); // fresh shared state per test
  mod = await import("../src/store/lib/storewideSale");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("storewideSale", () => {
  it("is 'not known' until the first answer, then shares the sale", async () => {
    rpc.fn.mockResolvedValue({ data: [row()], error: null });
    const { result } = renderHook(() => mod.useStorewideSale());
    expect(result.current).toEqual({ sale: null, known: false });
    await act(async () => {
      await mod.refreshStorewideSale();
    });
    expect(result.current.known).toBe(true);
    expect(result.current.sale).toMatchObject({ id: "sale-1", name: "Black Friday Sale", discountPercent: 15 });
  });

  it("knows 'no sale' as an answer, and keeps the last answer when a read fails", async () => {
    rpc.fn.mockResolvedValueOnce({ data: [], error: null });
    expect(await mod.refreshStorewideSale()).toEqual({ sale: null, known: true });
    rpc.fn.mockResolvedValueOnce({ data: [row()], error: null });
    expect((await mod.refreshStorewideSale()).sale?.discountPercent).toBe(15);
    rpc.fn.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await mod.refreshStorewideSale()).sale?.discountPercent).toBe(15);
    rpc.fn.mockRejectedValueOnce(new Error("offline"));
    expect((await mod.refreshStorewideSale()).sale?.discountPercent).toBe(15);
  });

  it("shares one read between callers asking at the same time", async () => {
    let resolve!: (v: unknown) => void;
    rpc.fn.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = mod.refreshStorewideSale();
    const b = mod.refreshStorewideSale();
    expect(a).toBe(b);
    resolve({ data: [row()], error: null });
    await a;
    expect(rpc.fn).toHaveBeenCalledTimes(1);
    // A later call reads again.
    rpc.fn.mockResolvedValue({ data: [], error: null });
    await mod.refreshStorewideSale();
    expect(rpc.fn).toHaveBeenCalledTimes(2);
  });

  it("looks again a second after the sale ends, so open tabs drop it on time", async () => {
    rpc.fn.mockResolvedValueOnce({ data: [row()], error: null });
    await mod.refreshStorewideSale();
    rpc.fn.mockResolvedValue({ data: [], error: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(rpc.fn).toHaveBeenCalledTimes(1); // not yet: it ends at 10s, checked at 11s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(rpc.fn).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect((await mod.refreshStorewideSale()).sale).toBeNull();
  });

  it("checks again shortly when this device's clock is ahead and the server still has the sale", async () => {
    rpc.fn.mockResolvedValue({ data: [row({ ends_at: new Date(Date.now() - 2000).toISOString() })], error: null });
    await mod.refreshStorewideSale();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(rpc.fn).toHaveBeenCalledTimes(2);
  });

  it("tells price views when the sale starts, changes % or ends — not on the first answer, nor a rename", async () => {
    const onChange = vi.fn();
    rpc.fn.mockResolvedValue({ data: [], error: null });
    renderHook(() => mod.useOnSalePriceChange(onChange));
    const answer = async (data: unknown[]) => {
      rpc.fn.mockResolvedValue({ data, error: null });
      await act(async () => {
        await mod.refreshStorewideSale();
      });
    };
    await answer([]); // the page's first look: nothing to re-read
    expect(onChange).not.toHaveBeenCalled();
    await answer([row()]); // the sale starts
    expect(onChange).toHaveBeenCalledTimes(1);
    await answer([row({ name: "Black Friday Weekend" })]); // renamed: prices unchanged
    expect(onChange).toHaveBeenCalledTimes(1);
    await answer([row({ discount_percent: 25 })]); // deeper
    expect(onChange).toHaveBeenCalledTimes(2);
    await answer([]); // the sale ends: back to regular prices
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("doesn't re-read for a change that happened before the view opened", async () => {
    rpc.fn.mockResolvedValue({ data: [], error: null });
    await mod.refreshStorewideSale();
    rpc.fn.mockResolvedValue({ data: [row()], error: null });
    await mod.refreshStorewideSale();
    const onChange = vi.fn();
    renderHook(() => mod.useOnSalePriceChange(onChange));
    await act(async () => {
      await mod.refreshStorewideSale();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("only changes the price key when the sale's effect on prices changes", () => {
    const sale = { id: "s", name: "A", discountPercent: 15, startsAt: "", endsAt: "" };
    expect(mod.storewideSaleKey(null)).toBe("none");
    expect(mod.storewideSaleKey(sale)).toBe(mod.storewideSaleKey({ ...sale, name: "Renamed" }));
    expect(mod.storewideSaleKey(sale)).not.toBe(mod.storewideSaleKey({ ...sale, discountPercent: 20 }));
    expect(mod.storewideSaleKey(sale)).not.toBe(mod.storewideSaleKey({ ...sale, id: "t" }));
  });
});
