import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  scryfallSearch,
  scryfallSearchPage,
} from "../api/_lib/scryfall";
import type {
  ScryfallCard,
  ScryfallList,
} from "../src/admin/services/scryfall.types";
import { HttpError } from "../api/_lib/http";

// These tests exercise the SERVER-side Scryfall client's pagination, page
// combining, de-duplication, and error handling — the logic that fixes older
// printings disappearing when Scryfall returns multiple pages. `fetch` is
// stubbed so nothing hits the network.

function card(id: string, extra: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    object: "card",
    id,
    name: "Lightning Bolt",
    lang: "en",
    layout: "normal",
    set: "lea",
    set_name: "Limited Edition Alpha",
    collector_number: id,
    rarity: "common",
    image_uris: { normal: `https://img/${id}.jpg` },
    ...extra,
  } as ScryfallCard;
}

function listResponse(body: ScryfallList): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function statusResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ object: "error", status, code: "x", details: "x" }),
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scryfallSearch — pagination & combining", () => {
  it("returns a single page unchanged when there is no next page", async () => {
    fetchMock.mockResolvedValueOnce(
      listResponse({
        object: "list",
        total_cards: 2,
        has_more: false,
        data: [card("1"), card("2")],
      }),
    );

    const res = await scryfallSearch("Lightning Bolt");
    expect(res.data.map((c) => c.id)).toEqual(["1", "2"]);
    expect(res.hasMore).toBe(false);
    expect(res.totalCards).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows next_page and combines results across pages", async () => {
    fetchMock
      .mockResolvedValueOnce(
        listResponse({
          object: "list",
          total_cards: 4,
          has_more: true,
          next_page: "https://api.scryfall.com/cards/search?page=2",
          data: [card("1"), card("2")],
        }),
      )
      .mockResolvedValueOnce(
        listResponse({
          object: "list",
          total_cards: 4,
          has_more: false,
          data: [card("3"), card("4")],
        }),
      );

    const res = await scryfallSearch("Lightning Bolt");
    expect(res.data.map((c) => c.id)).toEqual(["1", "2", "3", "4"]);
    expect(res.hasMore).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The 2nd call must use the next_page URL Scryfall returned.
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.scryfall.com/cards/search?page=2",
    );
  });

  it("de-duplicates by Scryfall id when a boundary card repeats across pages", async () => {
    fetchMock
      .mockResolvedValueOnce(
        listResponse({
          object: "list",
          has_more: true,
          next_page: "https://api.scryfall.com/cards/search?page=2",
          data: [card("1"), card("2")],
        }),
      )
      .mockResolvedValueOnce(
        listResponse({
          object: "list",
          has_more: false,
          data: [card("2"), card("3")], // "2" repeats
        }),
      );

    const res = await scryfallSearch("Lightning Bolt");
    expect(res.data.map((c) => c.id)).toEqual(["1", "2", "3"]);
  });

  it("stops at the page ceiling and reports hasMore=true (never spiders forever)", async () => {
    // Always claim there's another page. The client must stop at its ceiling.
    fetchMock.mockImplementation(async () =>
      listResponse({
        object: "list",
        has_more: true,
        next_page: "https://api.scryfall.com/cards/search?page=next",
        data: [card(`${Math.random()}`)],
      }),
    );

    const res = await scryfallSearch("a", { maxPages: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.hasMore).toBe(true);
  });

  it("preserves unique=prints and order params on the first request", async () => {
    fetchMock.mockResolvedValueOnce(
      listResponse({ object: "list", has_more: false, data: [card("1")] }),
    );
    await scryfallSearch("set:lea Lightning Bolt");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("unique=prints");
    expect(url).toContain("order=released");
    expect(url).toContain("dir=desc");
  });

  it("surfaces a 429 as an HttpError", async () => {
    fetchMock.mockResolvedValueOnce(statusResponse(429));
    await expect(scryfallSearch("x")).rejects.toBeInstanceOf(HttpError);
  });

  it("surfaces a 404 as an HttpError (handler maps it to an empty list)", async () => {
    fetchMock.mockResolvedValueOnce(statusResponse(404));
    await expect(scryfallSearch("x")).rejects.toMatchObject({ status: 404 });
  });
});

describe("scryfallSearchPage — single native page", () => {
  it("requests exactly the given page and reports hasMore", async () => {
    fetchMock.mockResolvedValueOnce(
      listResponse({
        object: "list",
        total_cards: 300,
        has_more: true,
        data: [card("a"), card("b")],
      }),
    );

    const res = await scryfallSearchPage("Lightning Bolt", 2);
    expect(res.data.map((c) => c.id)).toEqual(["a", "b"]);
    expect(res.hasMore).toBe(true);
    expect(res.totalCards).toBe(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("page=2");
    expect(url).toContain("unique=prints");
  });

  it("de-duplicates within a single page defensively", async () => {
    fetchMock.mockResolvedValueOnce(
      listResponse({
        object: "list",
        has_more: false,
        data: [card("a"), card("a"), card("b")],
      }),
    );
    const res = await scryfallSearchPage("x", 1);
    expect(res.data.map((c) => c.id)).toEqual(["a", "b"]);
  });
});