import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM_ORDERS = "Geega <orders@geega-games.com>";
  process.env.RESEND_REPLY_TO = "support@geega-games.com";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
});

const state: {
  recentCountForEmail: number;
  insertShouldFail: boolean;
  cardsInsertShouldFail: boolean;
  insertedSubmission: Record<string, unknown> | null;
  insertedCards: unknown[] | null;
  insertedPhotos: unknown[] | null;
  storageObjects: { name: string; id: string; metadata: { size: number; mimetype: string } }[];
  authUser: { id: string } | null;
} = {
  recentCountForEmail: 0,
  insertShouldFail: false,
  cardsInsertShouldFail: false,
  insertedSubmission: null,
  insertedCards: null,
  insertedPhotos: null,
  storageObjects: [],
  authUser: null,
};

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "sell_submissions") {
        return {
          select: () => ({
            eq: () => ({
              gte: async () => ({ count: state.recentCountForEmail, error: null }),
            }),
          }),
          insert: (payload: Record<string, unknown>) => {
            state.insertedSubmission = payload;
            return {
              select: () => ({
                single: async () => {
                  if (state.insertShouldFail) {
                    return { data: null, error: { message: "insert failed" } };
                  }
                  return {
                    data: { id: "11111111-1111-1111-1111-111111111111", reference_number: "GG-S-100001" },
                    error: null,
                  };
                },
              }),
            };
          },
        };
      }
      if (table === "sell_submission_cards") {
        return {
          insert: async (rows: unknown[]) => {
            if (state.cardsInsertShouldFail) {
              return { error: { message: "cards insert failed" } };
            }
            state.insertedCards = rows;
            return { error: null };
          },
        };
      }
      if (table === "sell_submission_photos") {
        return {
          insert: async (rows: unknown[]) => {
            state.insertedPhotos = rows;
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    storage: {
      from: () => ({
        list: async () => ({ data: state.storageObjects, error: null }),
      }),
    },
    auth: {
      getUser: async () => ({ data: { user: state.authUser } }),
    },
  }),
}));

const emailCalls: { confirmation: string[]; admin: string[] } = { confirmation: [], admin: [] };
vi.mock("../api/_lib/sellSubmissionEmails.js", () => ({
  sendSellSubmissionConfirmation: vi.fn(async (id: string) => {
    emailCalls.confirmation.push(id);
    return { status: "sent" };
  }),
  sendSellSubmissionAdminNotification: vi.fn(async (id: string) => {
    emailCalls.admin.push(id);
    return { status: "sent" };
  }),
}));

const { default: handler } = await import("../api/sell/submit.ts");

// Each call gets its own IP by default so the real, module-level, per-IP
// rate limiter in api/_lib/rateLimit.ts never causes one test's calls to
// count against another's budget. Tests that specifically exercise rate
// limiting pass a shared IP explicitly.
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function makeReqRes(body: Record<string, unknown>, ip?: string) {
  const resolvedIp = ip ?? nextIp();
  const req = {
    method: "POST",
    headers: { "x-forwarded-for": resolvedIp, "content-type": "application/json" },
    body,
    socket: { remoteAddress: resolvedIp },
  };
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader() {},
  };
  return { req, res };
}

async function invoke(body: Record<string, unknown>, ip?: string) {
  const { req, res } = makeReqRes(body, ip);
  await handler(req as never, res as never);
  return res;
}

const validContact = {
  firstName: "Jordan",
  lastName: "Vega",
  email: "seller@example.com",
  preferredContactMethod: "email",
  transactionPreference: "ship",
};

const validCollection = { collectionTypes: [], collectionEras: [] };

const validCard = {
  cardName: "Lightning Bolt",
  scryfallId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  quantity: 4,
  matchStatus: "matched",
  finish: "nonfoil",
};

beforeEach(() => {
  state.recentCountForEmail = 0;
  state.insertShouldFail = false;
  state.cardsInsertShouldFail = false;
  state.insertedSubmission = null;
  state.insertedCards = null;
  state.insertedPhotos = null;
  state.storageObjects = [];
  state.authUser = null;
  emailCalls.confirmation = [];
  emailCalls.admin = [];
});

describe("POST /api/sell/submit", () => {
  it("rejects a non-POST method", async () => {
    const { req, res } = makeReqRes({});
    req.method = "GET";
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(405);
  });

  it("silently 'succeeds' without writing anything when the honeypot is filled", async () => {
    const res = await invoke({
      hp_ref: "i-am-a-bot",
      contact: validContact,
      collection: validCollection,
      cards: [validCard],
      agreedToTerms: true,
    });
    expect(res.statusCode).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    expect(state.insertedSubmission).toBeNull();
  });

  it("rejects when the seller agreement checkbox isn't confirmed", async () => {
    const res = await invoke({
      contact: validContact,
      collection: validCollection,
      cards: [validCard],
      agreedToTerms: false,
    });
    expect(res.statusCode).toBe(400);
    expect(state.insertedSubmission).toBeNull();
  });

  it("rejects missing/invalid contact fields", async () => {
    const res = await invoke({
      contact: { ...validContact, email: "not-an-email" },
      collection: validCollection,
      cards: [validCard],
      agreedToTerms: true,
    });
    expect(res.statusCode).toBe(400);
    expect(state.insertedSubmission).toBeNull();
  });

  it("rejects a submission with nothing to sell (no cards, no photos, no notes)", async () => {
    const res = await invoke({
      contact: validContact,
      collection: validCollection,
      cards: [],
      agreedToTerms: true,
    });
    expect(res.statusCode).toBe(400);
    expect(state.insertedSubmission).toBeNull();
  });

  it("accepts a photos-only submission with no identified cards", async () => {
    const res = await invoke({
      contact: validContact,
      collection: { ...validCollection, notes: "A big binder of commons and uncommons" },
      cards: [],
      agreedToTerms: true,
    });
    expect(res.statusCode).toBe(200);
    expect(state.insertedSubmission).not.toBeNull();
  });

  it("creates a submission and its cards, and returns the reference number", async () => {
    const res = await invoke({
      contact: validContact,
      collection: validCollection,
      cards: [validCard, { cardName: "Some unparsed line", matchStatus: "unmatched", rawInput: "Some unparsed line" }],
      agreedToTerms: true,
    });
    expect(res.statusCode).toBe(200);
    expect((res.body as { referenceNumber: string }).referenceNumber).toBe("GG-S-100001");
    expect(state.insertedSubmission).toMatchObject({
      first_name: "Jordan",
      last_name: "Vega",
      email: "seller@example.com",
      total_cards: 5, // sum of every card line's quantity, matched or not (4 + 1)
    });
    expect(state.insertedCards).toHaveLength(2);
    expect(emailCalls.confirmation).toEqual(["11111111-1111-1111-1111-111111111111"]);
    expect(emailCalls.admin).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });

  it("never trusts a client-supplied user id — only a server-verified access token", async () => {
    state.authUser = { id: "real-user-id" };
    const { req, res } = makeReqRes({
      contact: validContact,
      collection: validCollection,
      cards: [validCard],
      agreedToTerms: true,
    });
    (req.headers as Record<string, string>).authorization = "Bearer sometoken";
    await handler(req as never, res as never);
    expect(state.insertedSubmission?.user_id).toBe("real-user-id");
  });

  it("does not attach a photo whose path was never actually confirmed in Storage", async () => {
    state.storageObjects = []; // nothing was really uploaded
    const res = await invoke({
      draftId: "22222222-2222-2222-2222-222222222222",
      contact: validContact,
      collection: validCollection,
      cards: [validCard],
      photos: [{ path: "22222222-2222-2222-2222-222222222222/fake.jpg", originalFilename: "fake.jpg" }],
      agreedToTerms: true,
    });
    expect(res.statusCode).toBe(200);
    expect(state.insertedPhotos).toBeNull();
  });

  it("attaches a photo confirmed present in Storage, using Storage's own size/mimetype", async () => {
    state.storageObjects = [
      { name: "real.jpg", id: "obj-1", metadata: { size: 123456, mimetype: "image/jpeg" } },
    ];
    const draftId = "22222222-2222-2222-2222-222222222222";
    const res = await invoke({
      draftId,
      contact: validContact,
      collection: validCollection,
      cards: [validCard],
      photos: [{ path: `${draftId}/real.jpg`, originalFilename: "IMG_0001.jpg" }],
      agreedToTerms: true,
    });
    expect(res.statusCode).toBe(200);
    expect(state.insertedPhotos).toHaveLength(1);
    expect(state.insertedPhotos?.[0]).toMatchObject({
      storage_path: `${draftId}/real.jpg`,
      mime_type: "image/jpeg",
      size_bytes: 123456,
      original_filename: "IMG_0001.jpg",
    });
  });

  it("threads a photo's cardLocalId through as client_card_id, correlating it to the matching card", async () => {
    state.storageObjects = [
      { name: "real.jpg", id: "obj-1", metadata: { size: 123456, mimetype: "image/jpeg" } },
    ];
    const draftId = "22222222-2222-2222-2222-222222222222";
    const res = await invoke({
      draftId,
      contact: validContact,
      collection: validCollection,
      cards: [{ ...validCard, clientCardId: "local-card-1" }],
      photos: [{ path: `${draftId}/real.jpg`, originalFilename: "IMG_0001.jpg", cardLocalId: "local-card-1" }],
      agreedToTerms: true,
    });
    expect(res.statusCode).toBe(200);
    expect(state.insertedCards?.[0]).toMatchObject({ client_card_id: "local-card-1" });
    expect(state.insertedPhotos?.[0]).toMatchObject({ client_card_id: "local-card-1" });
  });

  it("stores a valid front/back side and rejects an unrecognized one", async () => {
    state.storageObjects = [
      { name: "front.jpg", id: "obj-1", metadata: { size: 1000, mimetype: "image/jpeg" } },
      { name: "back.jpg", id: "obj-2", metadata: { size: 1000, mimetype: "image/jpeg" } },
      { name: "weird.jpg", id: "obj-3", metadata: { size: 1000, mimetype: "image/jpeg" } },
    ];
    const draftId = "22222222-2222-2222-2222-222222222222";
    const res = await invoke({
      draftId,
      contact: validContact,
      collection: validCollection,
      cards: [{ ...validCard, clientCardId: "local-card-1" }],
      photos: [
        { path: `${draftId}/front.jpg`, originalFilename: "front.jpg", cardLocalId: "local-card-1", side: "front" },
        { path: `${draftId}/back.jpg`, originalFilename: "back.jpg", cardLocalId: "local-card-1", side: "back" },
        { path: `${draftId}/weird.jpg`, originalFilename: "weird.jpg", cardLocalId: "local-card-1", side: "sideways" },
      ],
      agreedToTerms: true,
    });
    expect(res.statusCode).toBe(200);
    expect(state.insertedPhotos).toHaveLength(3);
    expect(state.insertedPhotos?.[0]).toMatchObject({ side: "front" });
    expect(state.insertedPhotos?.[1]).toMatchObject({ side: "back" });
    expect(state.insertedPhotos?.[2]).toMatchObject({ side: null });
  });

  it("leaves client_card_id null for a general collection photo not tied to any card", async () => {
    state.storageObjects = [
      { name: "real.jpg", id: "obj-1", metadata: { size: 123456, mimetype: "image/jpeg" } },
    ];
    const draftId = "22222222-2222-2222-2222-222222222222";
    const res = await invoke({
      draftId,
      contact: validContact,
      collection: validCollection,
      cards: [validCard],
      photos: [{ path: `${draftId}/real.jpg`, originalFilename: "IMG_0001.jpg" }],
      agreedToTerms: true,
    });
    expect(res.statusCode).toBe(200);
    expect(state.insertedPhotos?.[0]).toMatchObject({ client_card_id: null, side: null });
  });

  it("rejects further submissions from the same email once the recent cap is hit", async () => {
    state.recentCountForEmail = 3;
    const res = await invoke({
      contact: validContact,
      collection: validCollection,
      cards: [validCard],
      agreedToTerms: true,
    });
    expect(res.statusCode).toBe(429);
    expect(state.insertedSubmission).toBeNull();
  });

  it("preserves the submission even if the DB insert of cards fails", async () => {
    state.cardsInsertShouldFail = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await invoke({
      contact: validContact,
      collection: validCollection,
      cards: [validCard],
      agreedToTerms: true,
    });
    expect(res.statusCode).toBe(200);
    expect(state.insertedSubmission).not.toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("a failing confirmation email does not fail the submission", async () => {
    const { sendSellSubmissionConfirmation } = await import("../api/_lib/sellSubmissionEmails.js");
    vi.mocked(sendSellSubmissionConfirmation).mockRejectedValueOnce(new Error("resend down"));
    const res = await invoke({
      contact: validContact,
      collection: validCollection,
      cards: [validCard],
      agreedToTerms: true,
    });
    expect(res.statusCode).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });
});
