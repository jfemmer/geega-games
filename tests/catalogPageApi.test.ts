import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /shop/card/:slug and /shop/set/:code, as answered by api/catalog-page.ts:
// status codes, caching, redirects, and what happens when the database or the
// app shell can't be reached. What goes INTO the page is covered in
// tests/catalogPage.test.ts.

const SHELL = [
  "<!doctype html><html><head>",
  "<!--seo-head-->",
  "<title>Geega Games | Buy & Sell Magic: The Gathering Cards — St. Louis</title>",
  '<meta name="robots" content="index, follow" />',
  "<!--/seo-head-->",
  '<script type="module" crossorigin src="/assets/index-AbC123.js"></script>',
  '</head><body><div id="root"></div></body></html>',
].join("\n");

type RpcResult = { data: unknown; error: { message: string } | null };

const state: {
  shell: { html: string; source: "bundle" | "fetch" } | null;
  shellHosts: (string | undefined)[];
  rpc: Record<string, RpcResult | Error>;
  calls: { name: string; args: unknown; signal: unknown }[];
  clientError: Error | null;
} = { shell: null, shellHosts: [], rpc: {}, calls: [], clientError: null };

vi.mock("../api/_lib/spaShell.js", () => ({
  loadSpaShell: async (host?: string) => {
    state.shellHosts.push(host);
    return state.shell;
  },
}));

vi.mock("../api/_lib/supabasePublic.js", () => ({
  getSupabasePublic: () => {
    if (state.clientError) throw state.clientError;
    return {
      rpc(name: string, args?: unknown) {
        return {
          abortSignal: async (signal: unknown) => {
            state.calls.push({ name, args, signal });
            const result = state.rpc[name];
            if (result instanceof Error) throw result;
            return result ?? { data: null, error: null };
          },
        };
      },
    };
  },
}));

const { default: handler } = await import("../api/catalog-page.ts");

interface Reply {
  statusCode: number;
  headers: Record<string, string>;
  body: string | undefined;
}

async function call(
  url: string,
  opts: { method?: string; query?: Record<string, unknown>; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const reply: Reply = { statusCode: 200, headers: {}, body: undefined };
  const res = {
    setHeader(name: string, value: string) {
      reply.headers[name.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      reply.statusCode = code;
      return res;
    },
    send(body: string) {
      reply.body = body;
      return res;
    },
    end() {
      return res;
    },
  };
  // Vercel hands the function the visitor's own path, plus the query the
  // rewrite adds (see vercel.json); req.query is that query, parsed.
  const query =
    opts.query ??
    Object.fromEntries(new URL(url, "https://geega-games.com").searchParams.entries());
  const req = { method: opts.method ?? "GET", url, query, headers: { host: "geega-games.com", ...opts.headers } };
  await handler(req as never, res as never);
  return reply;
}

const CARD = {
  cardName: "Orcish Bowmasters",
  typeLine: "Creature — Orc Archer",
  inStockCount: 1,
  minPriceCents: 4100,
  maxPriceCents: 4100,
  listings: [
    {
      setCode: "LTR",
      setName: "The Lord of the Rings: Tales of Middle-earth",
      collectorNumber: "103",
      condition: "NM",
      finish: "nonfoil",
      imageUrl: "https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1",
      priceCents: 4100,
    },
  ],
};
const SETS = [{ set_code: "LTR", set_name: "The Lord of the Rings: Tales of Middle-earth", card_count: 2 }];
const SET_CARDS = [
  { card_name: "Delighted Halfling", condition: "LP", finish: "nonfoil", price_cents: 2400 },
  { card_name: "Orcish Bowmasters", condition: "NM", finish: "nonfoil", price_cents: 4100 },
];

beforeEach(() => {
  state.shell = { html: SHELL, source: "bundle" };
  state.shellHosts = [];
  state.rpc = {};
  state.calls = [];
  state.clientError = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a card page", () => {
  it("is served with the card's own tags, ready for the app to take over", async () => {
    state.rpc.get_card_detail = { data: CARD, error: null };
    const res = await call("/shop/card/orcish-bowmasters?kind=card&slug=orcish-bowmasters");

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["x-gg-page"]).toBe("filled");
    expect(res.headers["x-gg-shell"]).toBe("bundle");
    expect(res.headers["x-gg-address"]).toBe("path");
    expect(res.body).toContain("<title>Orcish Bowmasters — Buy Magic: The Gathering Singles | Geega Games</title>");
    expect(res.body).toContain('<link rel="canonical" href="https://geega-games.com/shop/card/orcish-bowmasters" />');
    expect(res.body).toContain('<meta property="og:image" content="https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1" />');
    expect(res.body).toContain('<div id="root"><noscript>');
    expect(res.body).toContain('<script type="module" crossorigin src="/assets/index-AbC123.js"></script>');
    expect(res.body?.match(/<title>/g)).toHaveLength(1);

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ name: "get_card_detail", args: { p_slug: "orcish-bowmasters" } });
    expect(state.calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("is cached at the edge for a few minutes, never in the browser", async () => {
    state.rpc.get_card_detail = { data: CARD, error: null };
    const res = await call("/shop/card/orcish-bowmasters");
    expect(res.headers["cache-control"]).toBe("public, max-age=0, s-maxage=300, stale-while-revalidate=600");
  });

  it("is a real 404 when no such card is listed — still with the app, which says so too", async () => {
    state.rpc.get_card_detail = { data: null, error: null };
    const res = await call("/shop/card/not-a-real-card");
    expect(res.statusCode).toBe(404);
    expect(res.headers["x-gg-page"]).toBe("not-found");
    expect(res.headers["cache-control"]).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=300");
    expect(res.body).toContain("<title>Card Not Found | Geega Games</title>");
    expect(res.body).toContain('<meta name="robots" content="noindex, follow" />');
    expect(res.body).not.toContain('rel="canonical"');
    expect(res.body).toContain('<script type="module" crossorigin src="/assets/index-AbC123.js"></script>');
  });

  it("keeps a sold-out card's page (200) but asks not to be indexed", async () => {
    state.rpc.get_card_detail = {
      data: { ...CARD, listings: [], inStockCount: 0, minPriceCents: null, maxPriceCents: null },
      error: null,
    };
    const res = await call("/shop/card/orcish-bowmasters");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<meta name="robots" content="noindex, follow" />');
    expect(res.body).toContain("Currently out of stock");
  });

  it("is a 404 without asking the database when the address could never be a card", async () => {
    const res = await call("/shop/card/not_a_slug!");
    expect(res.statusCode).toBe(404);
    expect(res.headers["x-gg-page"]).toBe("not-found");
    expect(res.body).toContain("<title>Card Not Found | Geega Games</title>");
    expect(state.calls).toEqual([]);
  });

  it("describes the address it is served at, whatever the query string says", async () => {
    state.rpc.get_card_detail = { data: CARD, error: null };
    await call("/shop/card/orcish-bowmasters?slug=black-lotus&kind=set&code=leb");
    expect(state.calls.map((c) => [c.name, c.args])).toEqual([["get_card_detail", { p_slug: "orcish-bowmasters" }]]);
  });

  it("still works if the function is only shown the rewrite's query", async () => {
    state.rpc.get_card_detail = { data: CARD, error: null };
    const res = await call("/api/catalog-page?kind=card&slug=orcish-bowmasters");
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-gg-address"]).toBe("query");
    expect(res.body).toContain("<title>Orcish Bowmasters — Buy");
  });
});

describe("a set page", () => {
  it("is served with the set's tags and a plain list of its cards", async () => {
    state.rpc.shop_sets_with_counts = { data: SETS, error: null };
    state.rpc.search_inventory = { data: SET_CARDS, error: null };
    const res = await call("/shop/set/ltr?kind=set&code=ltr");

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-gg-page"]).toBe("filled");
    expect(res.body).toContain(
      "<title>Buy The Lord of the Rings: Tales of Middle-earth Singles — Magic: The Gathering | Geega Games</title>",
    );
    expect(res.body).toContain('<link rel="canonical" href="https://geega-games.com/shop/set/ltr" />');
    expect(res.body).toContain('<a href="/shop/card/delighted-halfling">Delighted Halfling</a>');

    // The same two calls the page makes in the browser.
    expect(state.calls.map((c) => c.name).sort()).toEqual(["search_inventory", "shop_sets_with_counts"]);
    expect(state.calls.find((c) => c.name === "search_inventory")?.args).toEqual({
      p_sets: ["LTR"],
      p_in_stock_only: true,
      p_sort: "name_asc",
      p_limit: 100,
      p_offset: 0,
    });
  });

  it("is a real 404 when nothing from that set is in stock", async () => {
    state.rpc.shop_sets_with_counts = { data: SETS, error: null };
    state.rpc.search_inventory = { data: [], error: null };
    const res = await call("/shop/set/zzz");
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("<title>Set Not Found | Geega Games</title>");
    expect(res.body).not.toContain('rel="canonical"');
  });

  it("still serves the page if only the list of cards can't be loaded", async () => {
    state.rpc.shop_sets_with_counts = { data: SETS, error: null };
    state.rpc.search_inventory = { data: null, error: { message: "statement timeout" } };
    const res = await call("/shop/set/ltr");
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-gg-page"]).toBe("filled");
    expect(res.body).toContain("<h1>The Lord of the Rings: Tales of Middle-earth</h1>");
    expect(res.body).not.toContain("<ul>");
  });
});

describe("an upper-case address", () => {
  it("is redirected permanently to the lower-case one, keeping the visitor's query string", async () => {
    const res = await call("/shop/card/Orcish-Bowmasters?utm_source=x&kind=card&slug=Orcish-Bowmasters");
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe("/shop/card/orcish-bowmasters?utm_source=x");
    expect(res.headers["cache-control"]).toBe("public, max-age=0, s-maxage=86400");
    expect(res.body).toBeUndefined();
    expect(state.calls).toEqual([]);
    expect(state.shellHosts).toEqual([]);

    expect((await call("/shop/set/LTR")).headers.location).toBe("/shop/set/ltr");
  });
});

describe("when something is unavailable", () => {
  it("serves the plain app shell if the lookup fails — what this address returned before", async () => {
    state.rpc.get_card_detail = { data: null, error: { message: "upstream connect error" } };
    const res = await call("/shop/card/orcish-bowmasters");
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-gg-page"]).toBe("plain-shell");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toBe(SHELL);
  });

  it("does the same if the lookup times out or the database can't be reached at all", async () => {
    state.rpc.get_card_detail = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect((await call("/shop/card/orcish-bowmasters")).body).toBe(SHELL);

    state.rpc = {};
    state.clientError = new Error("Missing required server environment variable: SUPABASE_URL");
    const res = await call("/shop/set/ltr");
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-gg-page"]).toBe("plain-shell");
    expect(res.body).toBe(SHELL);
  });

  it("does the same if the list of sets can't be loaded (never a false “not found”)", async () => {
    state.rpc.shop_sets_with_counts = { data: null, error: { message: "boom" } };
    state.rpc.search_inventory = { data: SET_CARDS, error: null };
    const res = await call("/shop/set/ltr");
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-gg-page"]).toBe("plain-shell");
  });

  it("answers 503 (try again) if the app shell itself can't be had", async () => {
    state.shell = null;
    state.rpc.get_card_detail = { data: CARD, error: null };
    const res = await call("/shop/card/orcish-bowmasters");
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("60");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain('<a href="/shop">browse the shop</a>');
    expect(res.body).toContain('<meta name="robots" content="noindex">');
    expect(state.calls).toEqual([]);
  });

  it("says which copy of the shell it used", async () => {
    state.shell = { html: SHELL, source: "fetch" };
    state.rpc.get_card_detail = { data: CARD, error: null };
    expect((await call("/shop/card/orcish-bowmasters")).headers["x-gg-shell"]).toBe("fetch");
  });
});

describe("the request itself", () => {
  it("answers HEAD like GET, without a body", async () => {
    state.rpc.get_card_detail = { data: CARD, error: null };
    const res = await call("/shop/card/orcish-bowmasters", { method: "HEAD" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["x-gg-page"]).toBe("filled");
    expect(res.body).toBeUndefined();
  });

  it("refuses anything but GET and HEAD", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await call("/shop/card/orcish-bowmasters", { method });
      expect(res.statusCode, method).toBe(405);
      expect(res.headers.allow).toBe("GET, HEAD");
    }
    expect(state.calls).toEqual([]);
  });

  it("doesn't touch req.query when the path says which page it is", async () => {
    // On Vercel, req.query is a getter that parses the URL with Node's legacy
    // url.parse(), which writes a deprecation warning into the error log.
    state.rpc.get_card_detail = { data: CARD, error: null };
    let reads = 0;
    const reply: Reply = { statusCode: 200, headers: {}, body: undefined };
    const res = {
      setHeader: (name: string, value: string) => ((reply.headers[name.toLowerCase()] = value), res),
      status: (code: number) => ((reply.statusCode = code), res),
      send: (body: string) => ((reply.body = body), res),
      end: () => res,
    };
    const req = {
      method: "GET",
      url: "/shop/card/orcish-bowmasters?kind=card&slug=orcish-bowmasters",
      headers: { host: "geega-games.com" },
      get query() {
        reads += 1;
        return { kind: "card", slug: "orcish-bowmasters" };
      },
    };
    await handler(req as never, res as never);
    expect(reply.statusCode).toBe(200);
    expect(reply.headers["x-gg-address"]).toBe("path");
    expect(reads).toBe(0);
  });

  it("tells the shell loader which of our hosts the request came in on", async () => {
    state.rpc.get_card_detail = { data: CARD, error: null };
    await call("/shop/card/orcish-bowmasters", { headers: { "x-forwarded-host": "geega-games.vercel.app" } });
    await call("/shop/card/orcish-bowmasters");
    expect(state.shellHosts).toEqual(["geega-games.vercel.app", "geega-games.com"]);
  });
});
