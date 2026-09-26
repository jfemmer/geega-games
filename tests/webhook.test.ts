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
          update: (patch: Record<string, unknown>) => ({
            eq: (col: string, val: string) => {
              const rows = () => db.deliveries.filter((d) => d[col] === val);
              return {
                // Step 1: stamp the event's timestamp, return the row.
                select: () => ({
                  maybeSingle: async () => {
                    const row = rows()[0];
                    if (row) Object.assign(row, patch);
                    return { data: row ?? null, error: null };
                  },
                }),
                // Step 2: move the status, only from the allowed statuses.
                in: async (inCol: string, allowed: string[]) => {
                  for (const row of rows()) {
                    if (allowed.includes(String(row[inCol]))) Object.assign(row, patch);
                  }
                  return { error: null };
                },
              };
            },
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

// Resend doesn't send webhooks in order; a late event must never move an
// email's status backwards (a late "email.sent" used to hide bounces).
describe("resend webhook: out-of-order events", () => {
  async function deliver(type: string, emailId: string, data: Record<string, unknown> = {}) {
    verifyMock.mockReturnValue({ type, data: { email_id: emailId, ...data } });
    const res = makeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler(makeReq("POST", "{}") as any, res as any);
    expect(res.statusCode).toBe(200);
  }

  function row(status: string) {
    const r: Record<string, unknown> = {
      id: "d-order",
      email_type: "sell_submission_admin_notification",
      subscriber_id: null,
      resend_email_id: "re_seq",
      status,
      error_detail: null,
    };
    db.deliveries.push(r);
    return r;
  }

  it("keeps a bounce when a late 'sent' arrives, and keeps its reason", async () => {
    const r = row("sent");
    await deliver("email.bounced", "re_seq", { bounce: { message: "550 No such user" } });
    await deliver("email.sent", "re_seq");
    expect(r.status).toBe("bounced");
    expect(r.error_detail).toBe("550 No such user");
    expect(typeof r.bounced_at).toBe("string");
    expect(typeof r.sent_at).toBe("string");
  });

  it("moves forward to delivered, and a late 'delivery_delayed' doesn't undo it", async () => {
    const r = row("queued");
    await deliver("email.delivered", "re_seq");
    await deliver("email.delivery_delayed", "re_seq");
    await deliver("email.sent", "re_seq");
    expect(r.status).toBe("delivered");
    expect(typeof r.delivered_at).toBe("string");
  });

  it("records a bounce that comes after delivery (a forwarding inbox that can't pass it on)", async () => {
    const r = row("delivered");
    await deliver("email.bounced", "re_seq", { bounce: { message: "forward failed" } });
    expect(r.status).toBe("bounced");
  });

  it("ranks statuses so only later ones can replace earlier ones", async () => {
    const { statusesBefore } = await import("../api/webhooks/resend.js");
    expect(statusesBefore("sent")).toEqual(["queued"]);
    expect(statusesBefore("delivered").sort()).toEqual(["delivery_delayed", "queued", "sent"]);
    expect(statusesBefore("bounced")).toContain("delivered");
    expect(statusesBefore("bounced")).not.toContain("complained");
    expect(statusesBefore("complained")).toContain("bounced");
  });
});
