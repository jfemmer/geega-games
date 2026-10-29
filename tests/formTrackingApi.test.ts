// Seller-form progress reports at /api/track (t: "f"): checked, cleaned and
// written through record_form_session — never anything the person typed,
// never an IP, and nothing that looks like an email address or phone number.

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.EMAIL_TOKEN_SECRET = "s".repeat(32);
});

/** record_form_session calls. */
const calls: Record<string, unknown>[] = [];

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "record_form_session") calls.push(args);
      return { error: null };
    },
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}));

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

let ipCounter = 0;
async function track(body: unknown, headers: Record<string, string> = {}) {
  const { default: handler } = await import("../api/track.ts");
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    headers: Record<string, string>;
    socket: { remoteAddress: string };
  };
  req.method = "POST";
  req.headers = {
    "user-agent": IPHONE,
    host: "geega-games.com",
    "x-forwarded-for": `198.51.100.${++ipCounter}`,
    "x-vercel-ip-country": "US",
    "x-vercel-ip-country-region": "MO",
    "x-vercel-ip-city": "St.%20Louis",
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
    req.emit("data", Buffer.from(JSON.stringify(body)));
    req.emit("end");
  });
  await handler(req as never, res as never);
  return res;
}

const report = (extra: Record<string, unknown> = {}) => ({
  t: "f",
  id: ID,
  f: "quick_quote",
  p: "/sell-my-collection?utm_source=facebook",
  s: 2,
  sl: "Where to send your offer",
  fl: "Email",
  ph: 3,
  a: 1,
  er: "Please enter your first name, last name and a valid email address.",
  ok: false,
  ...extra,
});

beforeEach(() => {
  calls.length = 0;
});

describe("seller form progress", () => {
  it("records how far a form start got, with location and device but no IP or query string", async () => {
    const res = await track(report());
    expect(res.statusCode).toBe(204);
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c).toMatchObject({
      p_id: ID,
      p_form: "quick_quote",
      p_path: "/sell-my-collection",
      p_device: "mobile",
      p_country: "US",
      p_region: "MO",
      p_city: "St. Louis",
      p_step: 2,
      p_step_label: "Where to send your offer",
      p_field: "Email",
      p_photos: 3,
      p_attempts: 1,
      p_error: "Please enter your first name, last name and a valid email address.",
      p_submitted: false,
    });
    expect(String(c.p_visitor_hash)).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(c)).not.toContain("198.51.100");
  });

  it("records a sent form", async () => {
    await track(report({ ok: true, er: undefined }));
    expect(calls[0]).toMatchObject({ p_submitted: true, p_error: null });
  });

  it("ignores reports with a bad id, an unknown form, a bad step or an admin page", async () => {
    for (const bad of [
      { id: "not-a-uuid" },
      { f: "checkout" },
      { s: 0 },
      { s: 11 },
      { s: 1.5 },
      { p: "/admin_dashboard/orders" },
      { p: "https://evil.example/" },
    ]) {
      expect((await track(report(bad))).statusCode).toBe(204);
    }
    expect(calls).toHaveLength(0);
  });

  it("never stores a field name, step name or message that looks like an email address or phone number", async () => {
    await track(report({ fl: "jane@example.com", sl: "call 314-555-0199", er: "Write to jane@example.com" }));
    expect(calls[0]).toMatchObject({ p_field: null, p_step_label: null, p_error: null });
  });

  it("caps text and counts, and strips control characters", async () => {
    await track(report({ fl: "E\u0000mail\n\n" + "x".repeat(200), er: "y".repeat(500), ph: 99999, a: -2 }));
    const c = calls[0];
    expect(String(c.p_field).length).toBeLessThanOrEqual(80);
    expect(String(c.p_field)).not.toMatch(/[\u0000-\u001f]/);
    expect(String(c.p_error).length).toBeLessThanOrEqual(300);
    expect(c.p_photos).toBe(1000);
    expect(c.p_attempts).toBe(0);
  });

  it("ignores bots", async () => {
    await track(report(), { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" });
    expect(calls).toHaveLength(0);
  });
});
