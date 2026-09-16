import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { default: handler } = await import("../api/sell/scryfall-search.ts");

function makeReqRes(query: Record<string, string>, ip: string) {
  const req = {
    method: "GET",
    headers: { "x-forwarded-for": ip },
    query,
    socket: { remoteAddress: ip },
  };
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  return { req, res };
}

function scryfallListResponse(cards: { id: string; name: string }[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      object: "list",
      total_cards: cards.length,
      has_more: false,
      data: cards.map((c) => ({
        object: "card",
        id: c.id,
        name: c.name,
        lang: "en",
        layout: "normal",
        set: "lea",
        set_name: "Limited Edition Alpha",
        collector_number: "1",
        rarity: "common",
        image_uris: { normal: `https://img/${c.id}.jpg` },
      })),
    }),
  } as unknown as Response;
}

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("GET /api/sell/scryfall-search — public endpoint", () => {
  it("rejects non-GET methods", async () => {
    const { req, res } = makeReqRes({}, nextIp());
    req.method = "POST";
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(405);
  });

  it("returns an empty list for a too-short query without calling Scryfall", async () => {
    const { req, res } = makeReqRes({ q: "a" }, nextIp());
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(200);
    expect((res.body as { data: unknown[] }).data).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an excessively long query", async () => {
    const { req, res } = makeReqRes({ q: "a".repeat(500) }, nextIp());
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(400);
  });

  it("returns normalized printing data for a real query", async () => {
    fetchMock.mockResolvedValueOnce(
      scryfallListResponse([{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Lightning Bolt" }]),
    );
    const { req, res } = makeReqRes({ q: "Lightning Bolt" }, nextIp());
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(200);
    const body = res.body as { data: { cardName: string; scryfallId: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].cardName).toBe("Lightning Bolt");
    expect(body.data[0].scryfallId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });

  it("never leaks a Scryfall API key or admin-only behavior — no auth header is required", async () => {
    fetchMock.mockResolvedValueOnce(scryfallListResponse([{ id: "b", name: "Counterspell" }]));
    const { req, res } = makeReqRes({ q: "Counterspell" }, nextIp());
    // Deliberately no Authorization header — this must still work, unlike
    // the staff-only /api/admin/scryfall/search endpoint.
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(200);
  });

  it("caches an identical query instead of calling Scryfall again", async () => {
    fetchMock.mockResolvedValue(scryfallListResponse([{ id: "c", name: "Ponder" }]));
    const ip = nextIp();
    const first = makeReqRes({ q: "Ponder" }, ip);
    await handler(first.req as never, first.res as never);
    const second = makeReqRes({ q: "Ponder" }, ip);
    await handler(second.req as never, second.res as never);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.res.statusCode).toBe(200);
  });

  it("rate-limits a single IP hammering the endpoint", async () => {
    fetchMock.mockImplementation(async () =>
      scryfallListResponse([{ id: `${Math.random()}`, name: "Island" }]),
    );
    const ip = nextIp();
    let lastStatus = 200;
    // Distinct queries so the cache doesn't short-circuit the calls before
    // the rate limiter has a chance to engage.
    for (let i = 0; i < 95; i++) {
      const { req, res } = makeReqRes({ q: `Island ${i}` }, ip);
      await handler(req as never, res as never);
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
  });
});
