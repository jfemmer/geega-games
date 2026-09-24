import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.EMAIL_TOKEN_SECRET = "s".repeat(32);
});

const inserted: Record<string, unknown>[] = [];

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error: null };
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
});
