import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isPhotoRequestOverdue } from "../src/store/lib/photoRequestTypes";

// Photo requests: the public POST /api/photo-requests (card page) and the
// staff-only /api/admin/photo-requests/:id that uploads and sends photos.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.RESEND_API_KEY = "re_test";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
});

const ITEM = "11111111-2222-3333-4444-555555555555";
const REQ = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

type Item = { id: string; card_name: string; set_code: string; set_name: string; collector_number: string; condition: string; finish: string; status: string; quantity: number };

const state: {
  item: Item | null;
  existingOpen: { reference_number: string } | null;
  recentCount: number;
  inserted: Record<string, unknown> | null;
  // admin endpoint
  user: { id: string; app_metadata: Record<string, unknown> } | null;
  request: { id: string; status: string; photo_paths: string[]; send_count: number } | null;
  updated: Record<string, unknown> | null;
  stored: string[];
  sendResult: { status: string; error?: string };
  sentPaths: string[] | null;
} = {
  item: null,
  existingOpen: null,
  recentCount: 0,
  inserted: null,
  user: null,
  request: null,
  updated: null,
  stored: [],
  sendResult: { status: "sent" },
  sentPaths: null,
};

/** A tiny chainable stand-in for the Supabase query builder. */
function builder(table: string) {
  let mode: "select" | "count" = "select";
  const chain = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.head) mode = "count";
      return chain;
    },
    eq() {
      return chain;
    },
    limit() {
      return chain;
    },
    gte: async () => ({ count: state.recentCount, error: null }),
    maybeSingle: async () => {
      if (table === "inventory_items") return { data: state.item, error: null };
      if (table === "photo_requests" && state.request) return { data: state.request, error: null };
      if (table === "photo_requests") return { data: state.existingOpen, error: null };
      return { data: null, error: null };
    },
    insert(payload: Record<string, unknown>) {
      state.inserted = payload;
      return {
        select: () => ({
          single: async () => ({ data: { id: REQ, reference_number: "GG-P-1001" }, error: null }),
        }),
      };
    },
    update(patch: Record<string, unknown>) {
      state.updated = patch;
      return { eq: async () => ({ error: null }) };
    },
  };
  void mode;
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
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => ({
          data: { path, signedUrl: `https://storage.invalid/${path}`, token: "t" },
          error: null,
        }),
        list: async () => ({
          data: state.stored.map((p) => ({ name: p.split("/")[1], id: p })),
          error: null,
        }),
      }),
    },
  }),
}));

const pushes: string[] = [];
const confirmations: string[] = [];
vi.mock("../api/_lib/photoRequestEmails.js", () => ({
  PHOTO_REQUEST_BUCKET: "photo-request-photos",
  notifyStaffOfPhotoRequest: vi.fn(async (id: string) => {
    pushes.push(id);
  }),
  sendPhotoRequestConfirmation: vi.fn(async (id: string) => {
    confirmations.push(id);
    return { status: "sent" };
  }),
  sendPhotoRequestPhotos: vi.fn(async (_id: string, paths: string[]) => {
    state.sentPaths = paths;
    return state.sendResult;
  }),
}));
vi.mock("../api/_lib/auditLog.js", () => ({ logAdminAction: vi.fn(async () => undefined) }));

const { default: publicHandler } = await import("../api/photo-requests.ts");
const { default: adminHandler } = await import("../api/admin/photo-requests/[id].ts");

let ipCounter = 0;
function makeRes() {
  return {
    statusCode: 200,
    body: undefined as unknown as { ok: boolean; message?: string; referenceNumber?: string; uploads?: { path: string }[]; duplicate?: boolean },
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
}

async function postPublic(body: Record<string, unknown>, method = "POST") {
  ipCounter += 1;
  const ip = `203.0.113.${ipCounter}`;
  const req = { method, headers: { "x-forwarded-for": ip }, body, socket: { remoteAddress: ip } };
  const res = makeRes();
  await publicHandler(req as never, res as never);
  return res;
}

async function callAdmin(body: Record<string, unknown>, method = "POST", auth = true) {
  const req = { method, headers: auth ? { authorization: "Bearer t" } : {}, body, query: { id: REQ } };
  const res = makeRes();
  await adminHandler(req as never, res as never);
  return res;
}

const activeItem: Item = {
  id: ITEM,
  card_name: "Sol Ring",
  set_code: "cmm",
  set_name: "Commander Masters",
  collector_number: "395",
  condition: "NM",
  finish: "foil",
  status: "active",
  quantity: 2,
};

beforeEach(() => {
  state.item = { ...activeItem };
  state.existingOpen = null;
  state.recentCount = 0;
  state.inserted = null;
  state.user = null;
  state.request = null;
  state.updated = null;
  state.stored = [];
  state.sendResult = { status: "sent" };
  state.sentPaths = null;
  pushes.length = 0;
  confirmations.length = 0;
});

describe("POST /api/photo-requests", () => {
  const valid = {
    inventoryItemId: ITEM,
    firstName: "Sam",
    email: "Sam@Example.com",
    note: "back corners please",
    cardPath: "/shop/card/sol-ring",
  };

  it("rejects other methods", async () => {
    expect((await postPublic({}, "GET")).statusCode).toBe(405);
  });

  it("saves a request with card details from inventory, not the client, and notifies", async () => {
    const res = await postPublic({ ...valid, cardName: "Black Lotus" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, referenceNumber: "GG-P-1001" });
    expect(state.inserted).toMatchObject({
      inventory_item_id: ITEM,
      card_name: "Sol Ring",
      set_code: "cmm",
      condition: "NM",
      finish: "foil",
      first_name: "Sam",
      email: "sam@example.com",
      note: "back corners please",
      card_path: "/shop/card/sol-ring",
    });
    expect(pushes).toEqual([REQ]);
    expect(confirmations).toEqual([REQ]);
  });

  it("drops a card link that isn't one of our card pages", async () => {
    await postPublic({ ...valid, cardPath: "https://evil.example/phish" });
    expect(state.inserted?.card_path).toBeNull();
  });

  it("requires a name and a valid email", async () => {
    const res = await postPublic({ ...valid, email: "nope" });
    expect(res.statusCode).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it("refuses a sold-out or archived listing", async () => {
    state.item = { ...activeItem, quantity: 0 };
    const res = await postPublic(valid);
    expect(res.statusCode).toBe(404);
    expect(state.inserted).toBeNull();
  });

  it("returns the existing request instead of creating a duplicate", async () => {
    state.existingOpen = { reference_number: "GG-P-1000" };
    const res = await postPublic(valid);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ referenceNumber: "GG-P-1000", duplicate: true });
    expect(state.inserted).toBeNull();
    expect(pushes).toEqual([]);
  });

  it("limits how many requests one email can send per hour", async () => {
    state.recentCount = 5;
    const res = await postPublic(valid);
    expect(res.statusCode).toBe(429);
    expect(state.inserted).toBeNull();
  });

  it("silently accepts and discards bot submissions (honeypot)", async () => {
    const res = await postPublic({ ...valid, website: "http://spam" });
    expect(res.statusCode).toBe(200);
    expect(state.inserted).toBeNull();
  });
});

describe("/api/admin/photo-requests/:id", () => {
  beforeEach(() => {
    state.request = { id: REQ, status: "new", photo_paths: [], send_count: 0 };
  });

  it("requires a signed-in staff member", async () => {
    expect((await callAdmin({ action: "send", paths: [] }, "POST", false)).statusCode).toBe(401);
    state.user = { id: "u1", app_metadata: { role: "customer" } };
    expect((await callAdmin({ action: "send", paths: [] })).statusCode).toBe(403);
  });

  it("mints upload URLs inside the request's own folder, images only", async () => {
    state.user = { id: "u1", app_metadata: { role: "staff" } };
    const ok = await callAdmin({ action: "upload_urls", files: [{ mimeType: "image/jpeg", sizeBytes: 1000 }] });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.uploads?.[0].path.startsWith(`${REQ}/`)).toBe(true);
    const bad = await callAdmin({ action: "upload_urls", files: [{ mimeType: "application/pdf", sizeBytes: 1000 }] });
    expect(bad.statusCode).toBe(400);
  });

  it("sends only photos that were really uploaded for this request, then marks it sent", async () => {
    state.user = { id: "u1", app_metadata: { role: "staff" } };
    state.stored = [`${REQ}/a.jpg`, `${REQ}/b.jpg`];
    const res = await callAdmin({
      action: "send",
      paths: [`${REQ}/a.jpg`, `${REQ}/b.jpg`, "someone-else/x.jpg"],
      message: "Clean corners.",
    });
    expect(res.statusCode).toBe(200);
    expect(state.sentPaths).toEqual([`${REQ}/a.jpg`, `${REQ}/b.jpg`]);
    expect(state.updated).toMatchObject({ status: "sent", staff_message: "Clean corners.", sent_by: "u1", send_count: 1 });
  });

  it("refuses to send a photo that never finished uploading", async () => {
    state.user = { id: "u1", app_metadata: { role: "staff" } };
    state.stored = [`${REQ}/a.jpg`];
    const res = await callAdmin({ action: "send", paths: [`${REQ}/a.jpg`, `${REQ}/missing.jpg`] });
    expect(res.statusCode).toBe(400);
    expect(state.sentPaths).toBeNull();
    expect(state.updated).toBeNull();
  });

  it("keeps the request waiting if the email fails", async () => {
    state.user = { id: "u1", app_metadata: { role: "staff" } };
    state.stored = [`${REQ}/a.jpg`];
    state.sendResult = { status: "failed", error: "Resend down" };
    const res = await callAdmin({ action: "send", paths: [`${REQ}/a.jpg`] });
    expect(res.statusCode).toBe(502);
    expect(state.updated).toBeNull();
  });

  it("closes and reopens a request", async () => {
    state.user = { id: "u1", app_metadata: { role: "staff" } };
    const closed = await callAdmin({ status: "closed" }, "PATCH");
    expect(closed.statusCode).toBe(200);
    expect(state.updated?.status).toBe("closed");
    expect(typeof state.updated?.closed_at).toBe("string");
    const bad = await callAdmin({ status: "sent" }, "PATCH");
    expect(bad.statusCode).toBe(400);
  });
});

describe("isPhotoRequestOverdue", () => {
  it("flags requests older than the 24-hour promise", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    expect(isPhotoRequestOverdue("2026-09-25T13:00:00Z", now)).toBe(false);
    expect(isPhotoRequestOverdue("2026-09-25T11:00:00Z", now)).toBe(true);
  });
});
