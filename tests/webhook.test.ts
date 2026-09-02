import { describe, it, expect, beforeAll, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_WEBHOOK_SECRET = "whsec_test";
});

// --- state for the fake DB ---
const db = {
  deliveries: [] as Record<string, unknown>[],
  subscriberUpdates: [] as { id: string; status: string }[],
};

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "email_deliveries") {
        return {
          update: (_patch: Record<string, unknown>) => ({
            eq: (_col: string, val: string) => ({
              select: () => ({
                maybeSingle: async () => {
                  const row = db.deliveries.find(
                    (d) => d.resend_email_id === val,
                  );
                  return { data: row ?? null };
                },
              }),
            }),
          }),
        };
      }
      // newsletter_subscribers
      return {
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            db.subscriberUpdates.push({
              id,
              status: String(patch.status),
            });
            return { error: null };
          },
        }),
      };
    },
  }),
}));

// Controllable signature verification.
const verifyMock = vi.fn();
vi.mock("../api/_lib/resend.js", () => ({
  getResend: () => ({ webhooks: { verify: verifyMock } }),
}));

const handler = (await import("../api/webhooks/resend.js")).default;

// Build a fake VercelRequest that streams a raw body.
function makeReq(method: string, body: string) {
  const req = new EventEmitter() as unknown as {
    method: string;
    headers: Record<string, string>;
    on: EventEmitter["on"];
  };
  req.method = method;
  req.headers = {
    "svix-id": "msg_1",
    "svix-timestamp": "1",
    "svix-signature": "v1,sig",
  };
  // emit body on next tick
  setImmediate(() => {
    (req as unknown as EventEmitter).emit("data", Buffer.from(body));
    (req as unknown as EventEmitter).emit("end");
  });
  return req;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(obj: unknown) {
      this.body = obj;
      return this;
    },
    send(obj: unknown) {
      this.body = obj;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  db.deliveries = [];
  db.subscriberUpdates = [];
  verifyMock.mockReset();
});

describe("resend webhook", () => {
  it("rejects non-POST", async () => {
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler(makeReq("GET", "") as any, res as any);
    expect(res.statusCode).toBe(405);
  });

  it("rejects an invalid signature", async () => {
    verifyMock.mockImplementation(() => {
      throw new Error("bad signature");
    });
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler(makeReq("POST", "{}") as any, res as any);
    expect(res.statusCode).toBe(400);
    expect((res.body as { message?: string }).message).toMatch(/signature/i);
  });

  it("flips a marketing subscriber to bounced on email.bounced", async () => {
    db.deliveries.push({
      id: "d1",
      email_type: "confirm_subscription",
      subscriber_id: "sub-1",
      resend_email_id: "re_abc",
    });
    verifyMock.mockReturnValue({
      type: "email.bounced",
      data: { email_id: "re_abc", bounce: { message: "550" } },
    });
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler(makeReq("POST", "{}") as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(db.subscriberUpdates).toContainEqual({
      id: "sub-1",
      status: "bounced",
    });
  });

  it("does NOT unsubscribe on a transactional order email bounce", async () => {
    db.deliveries.push({
      id: "d2",
      email_type: "order_confirmation",
      subscriber_id: null,
      resend_email_id: "re_order",
    });
    verifyMock.mockReturnValue({
      type: "email.bounced",
      data: { email_id: "re_order", bounce: { message: "550" } },
    });
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler(makeReq("POST", "{}") as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(db.subscriberUpdates).toHaveLength(0);
  });

  it("handles repeated deliveries idempotently (same result each time)", async () => {
    db.deliveries.push({
      id: "d3",
      email_type: "confirm_subscription",
      subscriber_id: "sub-3",
      resend_email_id: "re_rep",
    });
    verifyMock.mockReturnValue({
      type: "email.complained",
      data: { email_id: "re_rep" },
    });
    const res1 = makeRes();
    const res2 = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler(makeReq("POST", "{}") as any, res1 as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler(makeReq("POST", "{}") as any, res2 as any);
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    // Both deliveries produce the same subscriber status.
    const statuses = db.subscriberUpdates
      .filter((u) => u.id === "sub-3")
      .map((u) => u.status);
    expect(statuses.every((s) => s === "complained")).toBe(true);
  });

  it("ignores unrelated event types without error", async () => {
    verifyMock.mockReturnValue({
      type: "email.opened",
      data: { email_id: "re_x" },
    });
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler(makeReq("POST", "{}") as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(db.subscriberUpdates).toHaveLength(0);
  });
});
