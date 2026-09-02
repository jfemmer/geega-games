import { describe, it, expect, beforeAll, vi, beforeEach } from "vitest";
import * as React from "react";

beforeAll(() => {
  process.env.EMAIL_TOKEN_SECRET = "test-secret";
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.RESEND_API_KEY = "re_test";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
});

// --- Mocks -----------------------------------------------------------------
// A tiny fake for the fluent supabase query builder used by emailService.
type Row = Record<string, unknown>;
const store: { deliveries: Row[]; failNextInsertWith?: string } = {
  deliveries: [],
};

const insertMock = vi.fn(async (row: Row) => {
  if (store.failNextInsertWith) {
    const code = store.failNextInsertWith;
    store.failNextInsertWith = undefined;
    return { error: { code, message: "insert failed" } };
  }
  // Enforce unique idempotency_key like the DB constraint.
  if (
    store.deliveries.some(
      (d) => d.idempotency_key === row.idempotency_key,
    )
  ) {
    return { error: { code: "23505", message: "duplicate key" } };
  }
  store.deliveries.push({ ...row });
  return { error: null };
});

const updateMock = vi.fn(() => ({
  eq: vi.fn(async () => ({ error: null })),
}));

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    from: (_table: string) => ({
      insert: insertMock,
      update: updateMock,
    }),
  }),
}));

const sendMock = vi.fn(async () => ({
  data: { id: "resend_123" },
  error: null,
}));

vi.mock("../api/_lib/resend.js", () => ({
  getResend: () => ({ emails: { send: sendMock } }),
}));

// Avoid heavy react-email render; stub to a string.
vi.mock("@react-email/render", () => ({
  render: async () => "<html>ok</html>",
}));

const { sendTrackedEmail } = await import("../api/_lib/emailService.js");

const baseArgs = () => ({
  emailType: "test_email",
  idempotencyKey: "key-" + Math.random().toString(36).slice(2),
  to: "user@example.com",
  from: "Geega <updates@geega-games.com>",
  subject: "Hi",
  react: React.createElement("div", null, "hi"),
  text: "hi",
});

beforeEach(() => {
  store.deliveries = [];
  store.failNextInsertWith = undefined;
  insertMock.mockClear();
  sendMock.mockClear();
});

describe("sendTrackedEmail", () => {
  it("sends once and records the resend id", async () => {
    const args = baseArgs();
    const r = await sendTrackedEmail(args);
    expect(r.status).toBe("sent");
    expect(sendMock).toHaveBeenCalledTimes(1);
    // Idempotency key is forwarded to Resend.
    expect(sendMock.mock.calls[0][1]).toEqual({
      idempotencyKey: args.idempotencyKey,
    });
  });

  it("dedupes on repeated idempotency key without re-sending", async () => {
    const args = baseArgs();
    const first = await sendTrackedEmail(args);
    const second = await sendTrackedEmail(args); // same key
    expect(first.status).toBe("sent");
    expect(second.status).toBe("deduped");
    // Resend called only once total.
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("does not send if the delivery row cannot be reserved", async () => {
    store.failNextInsertWith = "500"; // non-unique DB error
    const r = await sendTrackedEmail(baseArgs());
    expect(r.status).toBe("failed");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("is safe to retry after a transient failure (new key sends)", async () => {
    const r1 = await sendTrackedEmail(baseArgs());
    const r2 = await sendTrackedEmail(baseArgs());
    expect(r1.status).toBe("sent");
    expect(r2.status).toBe("sent");
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});
