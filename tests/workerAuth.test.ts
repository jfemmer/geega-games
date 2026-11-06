import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowWorkerRequest, WORKER_SECRET_HEADER } from "../api/_lib/cronAuth.ts";

// The background workers pg_cron calls (public.call_worker in
// supabase/migrations/20261105230000_worker_secret_header.sql) refuse anyone
// without the shared secret, and do nothing on preview deployments.

const SECRET = "test-worker-secret-0123456789abcdef";

// Nothing below should ever reach the database or the email service: the
// gate answers first. These mocks make any slip-through loud.
const touched = vi.fn();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => {
    touched("supabase");
    throw new Error("worker ran without passing the gate");
  },
}));
vi.mock("../api/_lib/emailService.js", () => ({
  sendTrackedEmail: () => {
    touched("email");
    throw new Error("worker emailed without passing the gate");
  },
}));

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function fakeReq(method: string, headers: Record<string, string> = {}) {
  return { method, headers } as unknown as VercelRequest;
}

beforeEach(() => {
  touched.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("allowWorkerRequest", () => {
  it("lets the right secret through in production", () => {
    vi.stubEnv("WORKER_SECRET", SECRET);
    vi.stubEnv("VERCEL_ENV", "production");
    const res = fakeRes();
    expect(allowWorkerRequest(fakeReq("POST", { [WORKER_SECRET_HEADER]: SECRET }), res as unknown as VercelResponse)).toBe(true);
    expect(res.statusCode).toBe(0);
  });

  it("runs locally, where VERCEL_ENV isn't set", () => {
    vi.stubEnv("WORKER_SECRET", SECRET);
    vi.stubEnv("VERCEL_ENV", "");
    const res = fakeRes();
    expect(allowWorkerRequest(fakeReq("GET", { [WORKER_SECRET_HEADER]: SECRET }), res as unknown as VercelResponse)).toBe(true);
  });

  it("refuses a request with no secret", () => {
    vi.stubEnv("WORKER_SECRET", SECRET);
    vi.stubEnv("VERCEL_ENV", "production");
    const res = fakeRes();
    expect(allowWorkerRequest(fakeReq("POST"), res as unknown as VercelResponse)).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("refuses a wrong or partial secret", () => {
    vi.stubEnv("WORKER_SECRET", SECRET);
    vi.stubEnv("VERCEL_ENV", "production");
    for (const wrong of ["nope", SECRET.slice(0, -1), `${SECRET}x`, ` ${SECRET}`, `Bearer ${SECRET}`]) {
      const res = fakeRes();
      expect(allowWorkerRequest(fakeReq("POST", { [WORKER_SECRET_HEADER]: wrong }), res as unknown as VercelResponse)).toBe(false);
      expect(res.statusCode).toBe(401);
    }
  });

  it("fails closed when WORKER_SECRET isn't configured", () => {
    vi.stubEnv("WORKER_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "production");
    const res = fakeRes();
    expect(allowWorkerRequest(fakeReq("POST", { [WORKER_SECRET_HEADER]: "" }), res as unknown as VercelResponse)).toBe(false);
    expect(res.statusCode).toBe(503);
  });

  it("does nothing on a preview deployment, even with the secret", () => {
    vi.stubEnv("WORKER_SECRET", SECRET);
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = fakeRes();
    expect(allowWorkerRequest(fakeReq("POST", { [WORKER_SECRET_HEADER]: SECRET }), res as unknown as VercelResponse)).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, skipped: "not production" });
  });

  it("checks the secret before the preview skip, so outsiders learn nothing", () => {
    vi.stubEnv("WORKER_SECRET", SECRET);
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = fakeRes();
    expect(allowWorkerRequest(fakeReq("POST"), res as unknown as VercelResponse)).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("only takes GET and POST", () => {
    vi.stubEnv("WORKER_SECRET", SECRET);
    const res = fakeRes();
    expect(allowWorkerRequest(fakeReq("DELETE", { [WORKER_SECRET_HEADER]: SECRET }), res as unknown as VercelResponse)).toBe(false);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe("GET, POST");
  });
});

const WORKERS = [
  "../api/checkout/expire-holds.ts",
  "../api/stock-alerts/process.ts",
  "../api/deck-alerts/process.ts",
  "../api/wishlist-alerts/process.ts",
  "../api/staff-digest/process.ts",
  "../api/checkout-recovery/process.ts",
  "../api/shipping-updates/process.ts",
  "../api/partner-referrals/process.ts",
] as const;

describe.each(WORKERS)("%s", (path) => {
  async function call(req: VercelRequest) {
    const { default: handler } = (await import(path)) as {
      default: (req: VercelRequest, res: VercelResponse) => Promise<unknown>;
    };
    const res = fakeRes();
    await handler(req, res as unknown as VercelResponse);
    return res;
  }

  it("refuses a caller without the worker secret and touches nothing", async () => {
    vi.stubEnv("WORKER_SECRET", SECRET);
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await call(fakeReq("POST"));
    expect(res.statusCode).toBe(401);
    expect(touched).not.toHaveBeenCalled();
  });

  it("does nothing on a preview deployment", async () => {
    vi.stubEnv("WORKER_SECRET", SECRET);
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await call(fakeReq("POST", { [WORKER_SECRET_HEADER]: SECRET }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ skipped: "not production" });
    expect(touched).not.toHaveBeenCalled();
  });
});
