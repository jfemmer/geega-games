import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Deleting buying leads and partner leads: owner-only, permanent, removes the
// seller's photos, never deletes a lead that store credit was issued for, and
// leaves an audit entry without the seller's personal details.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.RESEND_API_KEY = "re_test";
});

const SELL_ID = "11111111-1111-4111-8111-111111111111";
const LEAD_ID = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;

const state: {
  user: { id: string; email?: string; app_metadata: Record<string, unknown> } | null;
  rows: Record<string, Row | null>;
  photos: Row[];
  deleted: { table: string; id: string }[];
  forgotten: string[];
  removedPaths: string[][];
  storageError: boolean;
  audit: Row[];
} = { user: null, rows: {}, photos: [], deleted: [], forgotten: [], removedPaths: [], storageError: false, audit: [] };

function query(table: string) {
  let filterId: string | null = null;
  const result = () => {
    if (table === "sell_submission_photos") return { data: state.photos, error: null };
    return { data: null, error: null };
  };
  const chain = {
    select() {
      return chain;
    },
    eq(_col: string, value: string) {
      filterId = value;
      return chain;
    },
    maybeSingle: async () => {
      const row = state.rows[table];
      return { data: row && row.id === filterId ? row : null, error: null };
    },
    then<T>(resolve: (v: ReturnType<typeof result>) => T) {
      return Promise.resolve(result()).then(resolve);
    },
    delete() {
      return {
        eq: async (_col: string, id: string) => {
          state.deleted.push({ table, id });
          return { error: null };
        },
        like: async (_col: string, pattern: string) => {
          state.forgotten.push(pattern);
          return { error: null };
        },
      };
    },
    insert: async (row: Row) => {
      if (table === "admin_audit_log") state.audit.push(row);
      return { error: null };
    },
  };
  return chain;
}

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      getUser: async () => ({
        data: state.user ? { user: state.user } : null,
        error: state.user ? null : { message: "invalid token" },
      }),
    },
    from: (table: string) => query(table),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          if (state.storageError) return { data: null, error: { message: "storage down" } };
          state.removedPaths.push(paths);
          return { data: [], error: null };
        },
      }),
    },
  }),
}));

const { default: sellHandler } = await import("../api/admin/sell-submissions/[id].ts");
const { default: partnerHandler } = await import("../api/admin/referral-leads/[id].ts");

const OWNER = { id: "owner-1", email: "owner@example.com", app_metadata: { role: "admin" } };
const HELPER = { id: "staff-2", email: "helper@example.com", app_metadata: { role: "staff", staff_role: "inventory" } };

function call(handler: typeof sellHandler, id: string, auth = true) {
  const req = { method: "DELETE", headers: auth ? { authorization: "Bearer t" } : {}, query: { id }, body: {} };
  const res = {
    statusCode: 200,
    ended: false,
    body: undefined as unknown as { ok: boolean; message?: string } | undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload as typeof this.body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
    setHeader() {},
  };
  return handler(req as never, res as never).then(() => res);
}

beforeEach(() => {
  state.user = OWNER;
  state.rows = {
    sell_submissions: {
      id: SELL_ID,
      reference_number: "GG-S-100010",
      status: "new",
      created_at: "2026-09-26T12:00:00Z",
      total_cards: 12,
      offer_value_cents: null,
      purchase_amount_cents: null,
      payout_method: null,
      store_credit_issued_at: null,
      // Not selected by the handler, so it can't end up in the audit log.
      email: "seller@example.com",
    },
    referral_leads: {
      id: LEAD_ID,
      reference_number: "GG-R-100010",
      status: "new",
      categories: ["pokemon"],
      created_at: "2026-09-26T12:00:00Z",
      photo_paths: ["draft-1/a.jpg", "draft-1/b.jpg"],
    },
  };
  state.photos = [{ storage_path: "draft-9/front.jpg" }, { storage_path: "draft-9/back.jpg" }];
  state.deleted = [];
  state.forgotten = [];
  state.removedPaths = [];
  state.storageError = false;
  state.audit = [];
});

describe("DELETE /api/admin/sell-submissions/:id (buying leads)", () => {
  it("is only for the store owner", async () => {
    expect((await call(sellHandler, SELL_ID, false)).statusCode).toBe(401);
    state.user = { id: "c1", app_metadata: { role: "customer" } };
    expect((await call(sellHandler, SELL_ID)).statusCode).toBe(403);
    state.user = HELPER;
    const res = await call(sellHandler, SELL_ID);
    expect(res.statusCode).toBe(403);
    expect(res.body?.message).toMatch(/owner/i);
    expect(state.deleted).toEqual([]);
  });

  it("deletes the lead and the seller's photos, and logs it without personal details", async () => {
    const res = await call(sellHandler, SELL_ID);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(state.deleted).toEqual([{ table: "sell_submissions", id: SELL_ID }]);
    expect(state.removedPaths).toEqual([["draft-9/front.jpg", "draft-9/back.jpg"]]);
    expect(state.forgotten).toEqual([`buying_lead:%:${SELL_ID}`]);
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({
      action: "buying_lead.delete",
      resource_type: "sell_submission",
      resource_id: SELL_ID,
      actor_id: OWNER.id,
      before: { reference_number: "GG-S-100010", status: "new", photo_count: 2 },
      after: null,
    });
    expect(JSON.stringify(state.audit[0].before)).not.toContain("seller@example.com");
  });

  it("keeps a lead that store credit was issued for", async () => {
    state.rows.sell_submissions = { ...state.rows.sell_submissions!, store_credit_issued_at: "2026-09-20T12:00:00Z" };
    const res = await call(sellHandler, SELL_ID);
    expect(res.statusCode).toBe(409);
    expect(res.body?.message).toMatch(/store credit/i);
    expect(state.deleted).toEqual([]);
    expect(state.removedPaths).toEqual([]);
  });

  it("still deletes when the photos can't be removed from storage", async () => {
    state.storageError = true;
    const res = await call(sellHandler, SELL_ID);
    expect(res.statusCode).toBe(204);
    expect(state.deleted).toHaveLength(1);
  });

  it("returns 404 for a lead that doesn't exist, and 400 for a bad id", async () => {
    expect((await call(sellHandler, "33333333-3333-4333-8333-333333333333")).statusCode).toBe(404);
    expect((await call(sellHandler, "not-an-id")).statusCode).toBe(400);
    expect(state.deleted).toEqual([]);
  });
});

describe("DELETE /api/admin/referral-leads/:id (partner leads)", () => {
  it("is only for the store owner", async () => {
    state.user = HELPER;
    const res = await call(partnerHandler, LEAD_ID);
    expect(res.statusCode).toBe(403);
    expect(state.deleted).toEqual([]);
  });

  it("deletes the lead and its photos, and logs it", async () => {
    const res = await call(partnerHandler, LEAD_ID);
    expect(res.statusCode).toBe(204);
    expect(state.deleted).toEqual([{ table: "referral_leads", id: LEAD_ID }]);
    expect(state.removedPaths).toEqual([["draft-1/a.jpg", "draft-1/b.jpg"]]);
    expect(state.forgotten).toEqual([`partner_lead:%:${LEAD_ID}`]);
    expect(state.audit[0]).toMatchObject({
      action: "partner_lead.delete",
      resource_type: "referral_lead",
      resource_id: LEAD_ID,
      before: { reference_number: "GG-R-100010", categories: ["pokemon"], photo_count: 2 },
    });
  });

  it("returns 404 for a lead that doesn't exist", async () => {
    expect((await call(partnerHandler, "44444444-4444-4444-8444-444444444444")).statusCode).toBe(404);
    expect(state.deleted).toEqual([]);
  });
});
