import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.EMAIL_TOKEN_SECRET = "s".repeat(32);
});

/** Page views written (site_page_views inserts). */
const inserted: Record<string, unknown>[] = [];
/** Shop searches written (site_searches inserts). */
const searches: Record<string, unknown>[] = [];
/** Updates, with the filters they were narrowed by. */
const updates: { table: string; values: Record<string, unknown>; filters: [string, string, unknown][] }[] = [];
/** Pretend the 20261027050000 database update hasn't run: its columns don't exist yet. */
let missingNewerColumns = false;

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (table === "site_searches") {
          searches.push(row);
          return { error: null };
        }
        if (missingNewerColumns && ("engaged" in row || "utm_source" in row)) {
          return { error: { message: "Could not find the 'engaged' column of 'site_page_views' in the schema cache" } };
        }
        inserted.push(row);
        return { error: null };
      },
      update: (values: Record<string, unknown>) => {
        const call = { table, values, filters: [] as [string, string, unknown][] };
        updates.push(call);
        const query = {
          eq(column: string, value: unknown) {
            call.filters.push(["eq", column, value]);
            return query;
          },
          gte(column: string, value: unknown) {
            call.filters.push(["gte", column, value]);
            return query;
          },
          then(resolve: (r: { error: null }) => void) {
            resolve({ error: null });
          },
        };
        return query;
      },
    }),
  }),
}));

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

let ipCounter = 0;
async function track(body: unknown, headers: Record<string, string> = {}) {
  // Load the handler BEFORE queueing the body, so it's listening when it arrives.
  const { default: handler } = await import("../api/track.ts");
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    headers: Record<string, string>;
    socket: { remoteAddress: string };
  };
  req.method = "POST";
  // A fresh IP per call so the per-IP rate limit never interferes.
  req.headers = {
    "user-agent": CHROME,
    host: "geega-games.com",
    "x-forwarded-for": `203.0.113.${++ipCounter}`,
    "x-vercel-ip-country": "US",
    ...headers,
  };
  req.socket = { remoteAddress: "127.0.0.1" };
  const res = {
    statusCode: 0,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    end() {
      return this;
    },
    setHeader() {},
  };
  queueMicrotask(() => {
    req.emit("data", Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));
    req.emit("end");
  });
  await handler(req as never, res as never);
  return res;
}

beforeEach(() => {
  inserted.length = 0;
  searches.length = 0;
  updates.length = 0;
  missingNewerColumns = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("path and referrer cleaning", () => {
  it("drops query strings and fragments, and refuses non-site paths", async () => {
    const { cleanPath } = await import("../api/track.ts");
    expect(cleanPath("/reset-password?token=secret&email=a@b.c")).toBe("/reset-password");
    expect(cleanPath("/shop/#top")).toBe("/shop");
    expect(cleanPath("/")).toBe("/");
    expect(cleanPath("https://evil.example/")).toBeNull();
    expect(cleanPath("//evil.example")).toBeNull();
    expect(cleanPath("/admin_dashboard/orders")).toBeNull();
    expect(cleanPath("/api/track")).toBeNull();
    expect(cleanPath(42)).toBeNull();
  });

  it("keeps only an external referrer's hostname", async () => {
    const { referrerHost } = await import("../api/track.ts");
    expect(referrerHost("https://www.google.com/search?q=lightning+bolt", "geega-games.com")).toBe("google.com");
    expect(referrerHost("https://geega-games.com/shop", "geega-games.com")).toBeNull();
    expect(referrerHost("https://www.geega-games.com/", "geega-games.com")).toBeNull();
    expect(referrerHost("", "geega-games.com")).toBeNull();
    expect(referrerHost("not a url", "geega-games.com")).toBeNull();
  });
});

describe("campaign tags and searches", () => {
  it("turns a campaign tag into a short slug", async () => {
    const { cleanUtm } = await import("../api/track.ts");
    expect(cleanUtm("facebook", 60)).toBe("facebook");
    expect(cleanUtm("  Fall Sale!! 2026 ", 60)).toBe("fall-sale-2026");
    expect(cleanUtm("picks-2026-10-27", 80)).toBe("picks-2026-10-27");
    expect(cleanUtm("a".repeat(100), 60)).toHaveLength(60);
    expect(cleanUtm("x-".repeat(50), 9)).toBe("x-x-x-x-x");
    expect(cleanUtm("!!!", 60)).toBeNull();
    expect(cleanUtm("", 60)).toBeNull();
    expect(cleanUtm(42, 60)).toBeNull();
    expect(cleanUtm(null, 60)).toBeNull();
  });

  it("keeps a search as typed (lower-cased and tidied), but never one that looks personal", async () => {
    const { cleanSearchQuery, looksPersonal } = await import("../api/track.ts");
    expect(cleanSearchQuery("  Sheoldred,   the APOCALYPSE ")).toBe("sheoldred, the apocalypse");
    expect(cleanSearchQuery("bolt\u0000\nlightning")).toBe("bolt lightning");
    expect(cleanSearchQuery("x".repeat(120))).toHaveLength(80);
    expect(cleanSearchQuery("a")).toBeNull();
    expect(cleanSearchQuery("   ")).toBeNull();
    expect(cleanSearchQuery(7)).toBeNull();
    expect(cleanSearchQuery("me@example.com")).toBeNull();
    expect(cleanSearchQuery("314-555-0199")).toBeNull();
    expect(cleanSearchQuery("(314) 555 0199")).toBeNull();
    // Card names with numbers are fine.
    expect(cleanSearchQuery("1996 world champion")).toBe("1996 world champion");
    expect(cleanSearchQuery("mh3 297")).toBe("mh3 297");
    expect(looksPersonal("jordan@example.com")).toBe(true);
    expect(looksPersonal("lightning bolt")).toBe(false);
  });
});

describe("POST /api/track", () => {
  it("records a view without storing the IP, user agent or query string", async () => {
    const res = await track({ p: "/shop?q=bolt", r: "https://www.facebook.com/groups/mtg" });
    expect(res.statusCode).toBe(204);
    expect(inserted).toHaveLength(1);
    const row = inserted[0];
    expect(row).toMatchObject({ path: "/shop", referrer_host: "facebook.com", country: "US", device: "desktop" });
    expect(row.visitor_hash).toMatch(/^[0-9a-f]{32}$/);
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("203.0.113");
    expect(stored).not.toContain("Chrome");
    expect(stored).not.toContain("bolt");
  });

  it("records approximate city and state from Vercel's geo headers", async () => {
    await track(
      { p: "/" },
      { "x-vercel-ip-country-region": "MO", "x-vercel-ip-city": "St.%20Louis" },
    );
    expect(inserted[0]).toMatchObject({ country: "US", region: "MO", city: "St. Louis" });

    await track({ p: "/" }, { "x-vercel-ip-city": "S%C3%A3o%20Paulo", "x-vercel-ip-country": "BR", "x-vercel-ip-country-region": "SP" });
    expect(inserted[1]).toMatchObject({ country: "BR", region: "SP", city: "São Paulo" });
  });

  it("stores no location when the geo headers are missing or malformed", async () => {
    await track({ p: "/" }, { "x-vercel-ip-country-region": "not-a-region", "x-vercel-ip-city": "%E0%A4%A" });
    expect(inserted[0]).toMatchObject({ region: null, city: null });
    await track({ p: "/" });
    expect(inserted[1]).toMatchObject({ region: null, city: null });
  });

  it("detects phones", async () => {
    await track({ p: "/" }, { "user-agent": IPHONE });
    expect(inserted[0].device).toBe("mobile");
  });

  it("ignores bots, admin pages and junk, still answering 204", async () => {
    for (const [body, headers] of [
      [{ p: "/" }, { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }],
      [{ p: "/" }, { "user-agent": "facebookexternalhit/1.1" }],
      [{ p: "/admin_dashboard" }, {}],
      [{ p: "https://evil.example" }, {}],
      ["not json", {}],
    ] as const) {
      const res = await track(body, headers);
      expect(res.statusCode).toBe(204);
    }
    expect(inserted).toHaveLength(0);
  });

  it("gives the same visitor the same id within a day, and a new one the next day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const same = { "x-forwarded-for": "198.51.100.7" };
    vi.setSystemTime(new Date("2026-09-24T10:00:00Z"));
    await track({ p: "/" }, same);
    vi.setSystemTime(new Date("2026-09-24T18:00:00Z"));
    await track({ p: "/shop" }, same);
    vi.setSystemTime(new Date("2026-09-25T09:00:00Z"));
    await track({ p: "/" }, same);
    expect(inserted[0].visitor_hash).toBe(inserted[1].visitor_hash);
    expect(inserted[2].visitor_hash).not.toBe(inserted[0].visitor_hash);
  });

  it("leaves out Facebook's own servers (Meta's network and its crawlers)", async () => {
    for (const headers of [
      { "x-forwarded-for": "173.252.107.19" },
      { "x-forwarded-for": "57.144.12.4, 10.0.0.1" },
      { "x-forwarded-for": "2a03:2880:f12f:83:face:b00c::25de" },
      { "x-forwarded-for": "::ffff:157.240.22.35" },
      { "user-agent": "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)" },
    ]) {
      const res = await track({ p: "/shop", e: true }, headers);
      expect(res.statusCode).toBe(204);
    }
    expect(inserted).toHaveLength(0);
    // A person on a phone network is still counted.
    await track({ p: "/shop", e: true }, { "x-forwarded-for": "172.58.10.20", "user-agent": IPHONE });
    expect(inserted).toHaveLength(1);
  });

  it("records whether the visitor interacted with the page", async () => {
    await track({ p: "/", e: true });
    await track({ p: "/", e: false });
    await track({ p: "/" });
    await track({ p: "/", e: "yes" });
    expect(inserted.map((r) => r.engaged)).toEqual([true, false, null, null]);
  });

  it("records the landing link's campaign tags, cleaned", async () => {
    await track({ p: "/shop/picks", e: true, u: { s: "Facebook", m: "social", c: "picks-2026-10-27" } });
    expect(inserted[0]).toMatchObject({ utm_source: "facebook", utm_medium: "social", utm_campaign: "picks-2026-10-27" });
    await track({ p: "/", u: { s: 5, m: ["x"], c: "<script>" } });
    expect(inserted[1]).toMatchObject({ utm_source: null, utm_medium: null, utm_campaign: "script" });
    await track({ p: "/", u: "facebook" });
    expect(inserted[2]).toMatchObject({ utm_source: null, utm_medium: null, utm_campaign: null });
  });

  it("marks a page engaged when a visitor who left without interacting comes back and does", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T15:00:00Z"));
    const same = { "x-forwarded-for": "198.51.100.44" };
    await track({ p: "/shop", e: false }, same);
    const res = await track({ t: "e", p: "/shop?sort=new" }, same);
    expect(res.statusCode).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("site_page_views");
    expect(updates[0].values).toEqual({ engaged: true });
    expect(updates[0].filters).toEqual([
      ["eq", "visitor_hash", inserted[0].visitor_hash],
      ["eq", "path", "/shop"],
      ["eq", "engaged", false],
      ["gte", "viewed_at", "2026-10-27T13:00:00.000Z"],
    ]);
    // Not for admin pages or junk.
    await track({ t: "e", p: "/admin_dashboard" }, same);
    await track({ t: "e" }, same);
    expect(updates).toHaveLength(1);
  });

  it("records a shop search and how many cards it found, without the IP", async () => {
    const res = await track({ t: "s", q: "  Sheoldred,   the APOCALYPSE ", n: 0, f: false, d: true }, { "user-agent": IPHONE });
    expect(res.statusCode).toBe(204);
    expect(inserted).toHaveLength(0);
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      query: "sheoldred, the apocalypse",
      results: 0,
      filtered: false,
      deals: true,
      device: "mobile",
    });
    expect(searches[0].visitor_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(searches[0])).not.toContain("203.0.113");

    await track({ t: "s", q: "lightning bolt", n: 12, f: "yes" });
    expect(searches[1]).toMatchObject({ query: "lightning bolt", results: 12, filtered: false, deals: false, device: "desktop" });
  });

  it("never stores a search that looks like an email address or phone number, or a bad count", async () => {
    for (const body of [
      { t: "s", q: "me@example.com", n: 0 },
      { t: "s", q: "call 314 555 0199", n: 0 },
      { t: "s", q: "a", n: 0 },
      { t: "s", n: 0 },
      { t: "s", q: "lightning bolt", n: -1 },
      { t: "s", q: "lightning bolt", n: 1.5 },
      { t: "s", q: "lightning bolt", n: "3" },
      { t: "s", q: "lightning bolt" },
    ]) {
      const res = await track(body);
      expect(res.statusCode).toBe(204);
    }
    expect(searches).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it("keeps recording views the old way until the database update runs", async () => {
    missingNewerColumns = true;
    await track({ p: "/shop", e: true, u: { s: "facebook" } }, { "x-vercel-ip-country-region": "MO" });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ path: "/shop", country: "US", region: "MO", device: "desktop" });
    expect(Object.keys(inserted[0])).not.toEqual(expect.arrayContaining(["engaged"]));
    expect("utm_source" in inserted[0]).toBe(false);
    expect("engaged" in inserted[0]).toBe(false);
  });
});
