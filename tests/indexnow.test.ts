import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INDEXNOW_KEY,
  INDEXNOW_KEY_LOCATION,
  indexNowPayload,
  recentlyChangedPaths,
} from "../src/seo/indexnow";
import { renderSeoHead } from "../src/seo/head";

// IndexNow (src/seo/indexnow.ts + api/indexnow.ts): the key file must be
// served from the site root, only recently changed pages are announced, and
// only Vercel's cron (with CRON_SECRET) can trigger a submission.

describe("IndexNow key file", () => {
  it("is in public/ and contains exactly the key", () => {
    const file = new URL(`../public/${INDEXNOW_KEY}.txt`, import.meta.url);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8").trim()).toBe(INDEXNOW_KEY);
    expect(INDEXNOW_KEY_LOCATION).toBe(`https://geega-games.com/${INDEXNOW_KEY}.txt`);
  });
});

describe("recentlyChangedPaths", () => {
  const routes = [
    { path: "/a", changefreq: "monthly" as const, priority: "0.5", lastmod: "2026-09-26" },
    { path: "/b", changefreq: "monthly" as const, priority: "0.5", lastmod: "2026-09-20" },
    { path: "/c", changefreq: "monthly" as const, priority: "0.5" },
  ];
  it("keeps pages whose lastmod is within the lookback window", () => {
    expect(recentlyChangedPaths(routes, new Date("2026-09-27T14:17:00Z"), 3)).toEqual(["/a"]);
    expect(recentlyChangedPaths(routes, new Date("2026-09-22T14:17:00Z"), 3)).toEqual(["/a", "/b"]);
  });
});

describe("indexNowPayload", () => {
  it("dedupes URLs and includes the host, key and key location", () => {
    const p = indexNowPayload(["https://geega-games.com/a", "https://geega-games.com/a"]);
    expect(p).toEqual({
      host: "geega-games.com",
      key: INDEXNOW_KEY,
      keyLocation: INDEXNOW_KEY_LOCATION,
      urlList: ["https://geega-games.com/a"],
    });
  });
});

const cards: { card_name: string; oracle_id: string | null }[] = [];
vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      gt: () => chain,
      not: () => chain,
      gte: () => chain,
      limit: async () => ({ data: cards, error: null }),
    };
    return { from: () => chain };
  },
}));

const { default: handler } = await import("../api/indexnow.ts");

function call(headers: Record<string, string> = {}, method = "GET") {
  const res = {
    statusCode: 200,
    body: undefined as unknown as { ok: boolean; submitted?: number },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload as typeof this.body;
      return this;
    },
    setHeader() {},
  };
  return handler({ method, headers } as never, res as never).then(() => res);
}

describe("GET /api/indexnow", () => {
  const fetchMock = vi.fn(async () => ({ status: 202, text: async () => "" }));
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    cards.length = 0;
    process.env.CRON_SECRET = "s3cret";
    delete process.env.VERCEL_ENV;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CRON_SECRET;
  });

  it("does nothing without CRON_SECRET configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await call({ authorization: "Bearer anything" });
    expect(res.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses requests that aren't from the cron", async () => {
    expect((await call()).statusCode).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips preview deployments", async () => {
    process.env.VERCEL_ENV = "preview";
    const res = await call({ authorization: "Bearer s3cret" });
    expect(res.statusCode).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits recently changed pages and newly listed cards", async () => {
    cards.push({ card_name: "Sol Ring", oracle_id: "o1" }, { card_name: "Sol Ring", oracle_id: "o1" });
    const res = await call({ authorization: "Bearer s3cret" });
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("https://api.indexnow.org/indexnow");
    const body = JSON.parse(init.body) as { urlList: string[]; key: string };
    expect(body.key).toBe(INDEXNOW_KEY);
    expect(body.urlList.filter((u) => u.endsWith("/shop/card/sol-ring"))).toHaveLength(1);
    expect(body.urlList.every((u) => u.startsWith("https://geega-games.com/"))).toBe(true);
  });
});

describe("site verification tags", () => {
  const seo = { title: "T", description: "D", path: "/" };
  it("renders Google and Bing codes when set", () => {
    const html = renderSeoHead(seo, { verification: { google: "abcDEF123_-xyz", bing: "0123456789ABCDEF" } });
    expect(html).toContain('<meta name="google-site-verification" content="abcDEF123_-xyz" />');
    expect(html).toContain('<meta name="msvalidate.01" content="0123456789ABCDEF" />');
  });
  it("ignores anything that isn't a plain token", () => {
    const html = renderSeoHead(seo, { verification: { google: '"><script>x</script>' } });
    expect(html).not.toContain("google-site-verification");
  });
});
