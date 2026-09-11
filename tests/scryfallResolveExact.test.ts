import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scryfallResolveExact } from "../api/_lib/scryfall";
import type {
  ScryfallCard,
  ScryfallList,
} from "../src/admin/services/scryfall.types";

// Accuracy tests for the exact-printing resolver: it must return the printing
// matching set + collector (+ finish), fall back through the ladder, and NEVER
// return a name mismatch. fetch is stubbed so nothing hits the network.

function card(over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    object: "card",
    id: "00000000-0000-0000-0000-000000000001",
    name: "Lightning Bolt",
    lang: "en",
    layout: "normal",
    set: "lea",
    set_name: "Limited Edition Alpha",
    collector_number: "161",
    rarity: "common",
    finishes: ["nonfoil"],
    image_uris: { normal: "https://img/n.jpg" },
    ...over,
  } as ScryfallCard;
}

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function status(s: number): Response {
  return {
    ok: s >= 200 && s < 300,
    status: s,
    json: async () => ({ object: "error", status: s }),
  } as unknown as Response;
}
function list(data: ScryfallCard[]): ScryfallList {
  return { object: "list", has_more: false, data } as ScryfallList;
}

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("scryfallResolveExact — ladder", () => {
  it("uses exact scryfallId when it is a real UUID", async () => {
    fetchMock.mockResolvedValueOnce(ok(card({ id: "abc" as never })));
    const r = await scryfallResolveExact({
      scryfallId: "11111111-2222-3333-4444-555555555555",
    });
    expect(r?.name).toBe("Lightning Bolt");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/cards/11111111-2222-3333-4444-555555555555");
  });

  it("ignores a synthetic (non-UUID) id and resolves by set+collector", async () => {
    fetchMock.mockResolvedValueOnce(ok(card({ set: "lea", collector_number: "161" })));
    const r = await scryfallResolveExact({
      scryfallId: "mock_prt_bolt",
      cardName: "Lightning Bolt",
      setCode: "lea",
      collectorNumber: "161",
    });
    expect(r?.set).toBe("lea");
    expect(r?.collector_number).toBe("161");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/cards/lea/161");
  });

  it("tries collector-number variants when the first form 404s", async () => {
    fetchMock
      .mockResolvedValueOnce(status(404)) // cn "138★"
      .mockResolvedValueOnce(
        ok(
          card({
            name: "Ragavan, Nimble Pilferer",
            set: "mh2",
            collector_number: "138",
          }),
        ),
      );
    const r = await scryfallResolveExact({
      cardName: "Ragavan, Nimble Pilferer",
      setCode: "mh2",
      collectorNumber: "138★",
    });
    expect(r?.collector_number).toBe("138");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to a targeted name+set+cn search when exact endpoint 404s", async () => {
    fetchMock.mockImplementation(async (u: string) => {
      if (String(u).includes("/cards/search")) {
        return ok(
          list([
            card({
              name: "Ragavan, Nimble Pilferer",
              set: "mh2",
              collector_number: "138",
            }),
          ]),
        );
      }
      return status(404);
    });
    const r = await scryfallResolveExact({
      cardName: "Ragavan, Nimble Pilferer",
      setCode: "mh2",
      collectorNumber: "138",
    });
    expect(r?.set).toBe("mh2");
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/cards/search")),
    ).toBe(true);
  });

  it("NEVER returns a name mismatch from a search fallback", async () => {
    fetchMock.mockImplementation(async (u: string) => {
      if (String(u).includes("/cards/search")) {
        return ok(list([card({ name: "Counterspell", set: "mh2", collector_number: "267" })]));
      }
      return status(404);
    });
    const r = await scryfallResolveExact({
      cardName: "Ragavan, Nimble Pilferer",
      setCode: "mh2",
      collectorNumber: "138",
    });
    expect(r).toBeNull();
  });

  it("prefers the printing whose set+collector match among search results", async () => {
    fetchMock.mockImplementation(async (u: string) => {
      if (String(u).includes("/cards/search")) {
        return ok(
          list([
            card({ set: "mh2", collector_number: "492" }),
            card({ set: "mh2", collector_number: "138" }),
            card({ set: "mh2", collector_number: "382" }),
          ]),
        );
      }
      return status(404);
    });
    const r = await scryfallResolveExact({
      cardName: "Lightning Bolt",
      setCode: "mh2",
      collectorNumber: "138",
    });
    expect(r?.collector_number).toBe("138");
  });

  it("returns null when nothing matches confidently", async () => {
    fetchMock.mockResolvedValue(status(404));
    const r = await scryfallResolveExact({
      cardName: "Nonexistent Card",
      setCode: "zzz",
      collectorNumber: "999",
    });
    expect(r).toBeNull();
  });
});