import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.RESEND_API_KEY = "re_test";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
});

const DRAFT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const state: {
  recentCountForEmail: number;
  insertShouldFail: boolean;
  inserted: Record<string, unknown> | null;
  storageObjects: { name: string; id: string; metadata: { size: number; mimetype: string } }[];
  /** referral_codes rows, for crediting ?ref= codes. */
  codes: { code: string; user_id: string | null; partner_id: string | null }[];
  partners: { id: string; kind: string; status: string; email: string }[];
  users: Record<string, { id: string; email: string }>;
} = {
  recentCountForEmail: 0,
  insertShouldFail: false,
  inserted: null,
  storageObjects: [],
  codes: [],
  partners: [],
  users: {},
};

/** `.select().eq(col, value).maybeSingle()` over an array. */
function lookup<T extends Record<string, unknown>>(rows: T[]) {
  return {
    select: () => ({
      eq: (col: string, value: unknown) => ({
        maybeSingle: async () => ({ data: rows.find((r) => r[col] === value) ?? null, error: null }),
      }),
    }),
  };
}

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: state.users[id] ?? null }, error: null }),
      },
    },
    from: (table: string) => {
      if (table === "referral_codes") return lookup(state.codes);
      if (table === "partners") return lookup(state.partners);
      if (table !== "referral_leads") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            gte: async () => ({ count: state.recentCountForEmail, error: null }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          state.inserted = payload;
          return {
            select: () => ({
              single: async () =>
                state.insertShouldFail
                  ? { data: null, error: { message: "insert failed" } }
                  : { data: { id: "lead-1", reference_number: "GG-R-100001" }, error: null },
            }),
          };
        },
      };
    },
    storage: {
      from: () => ({
        list: async () => ({ data: state.storageObjects, error: null }),
      }),
    },
  }),
}));

const emailCalls: { admin: string[]; confirmation: string[] } = { admin: [], confirmation: [] };
vi.mock("../api/_lib/referralLeadEmails.js", () => ({
  sendReferralLeadAdminNotification: vi.fn(async (id: string) => {
    emailCalls.admin.push(id);
    return { status: "sent" };
  }),
  sendReferralLeadConfirmation: vi.fn(async (id: string) => {
    emailCalls.confirmation.push(id);
    return { status: "sent" };
  }),
}));

const { default: handler } = await import("../api/referral-leads.ts");

let ipCounter = 0;
async function invoke(body: Record<string, unknown>, opts: { method?: string; ip?: string } = {}) {
  ipCounter += 1;
  const ip = opts.ip ?? `198.51.100.${ipCounter}`;
  const req = {
    method: opts.method ?? "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body,
    socket: { remoteAddress: ip },
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
  await handler(req as never, res as never);
  return res as typeof res & { body: { ok: boolean; message?: string; referenceNumber?: string } };
}

const valid = {
  categories: ["pokemon"],
  description: "A binder of Base Set cards and two sealed booster boxes.",
  size: "small",
  handoff: "local",
  contact: { firstName: "Sam", email: "Sam@Example.com", preferredContactMethod: "email" },
  consent: true,
  sourcePath: "/sell-pokemon-cards",
};

beforeEach(() => {
  state.recentCountForEmail = 0;
  state.insertShouldFail = false;
  state.inserted = null;
  state.storageObjects = [];
  state.codes = [];
  state.partners = [];
  state.users = {};
  emailCalls.admin = [];
  emailCalls.confirmation = [];
});

describe("POST /api/referral-leads", () => {
  it("rejects other methods", async () => {
    const res = await invoke({}, { method: "GET" });
    expect(res.statusCode).toBe(405);
  });

  it("saves a valid lead, records consent, and sends both emails", async () => {
    const res = await invoke(valid);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, referenceNumber: "GG-R-100001" });
    expect(state.inserted).toMatchObject({
      categories: ["pokemon"],
      description: valid.description,
      collection_size: "small",
      handoff: "local",
      first_name: "Sam",
      email: "sam@example.com",
      preferred_contact_method: "email",
      source_path: "/sell-pokemon-cards",
      photo_paths: [],
    });
    expect(typeof state.inserted?.consent_to_share_at).toBe("string");
    expect(emailCalls.admin).toEqual(["lead-1"]);
    expect(emailCalls.confirmation).toEqual(["lead-1"]);
  });

  it("refuses a lead without consent to share with a partner store", async () => {
    const res = await invoke({ ...valid, consent: false });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/partner store/);
    expect(state.inserted).toBeNull();
  });

  it("stores where the seller came from and what they said, cleaned", async () => {
    await invoke({
      ...valid,
      referralSource: "Card show or event",
      attribution: {
        utmSource: "Card Show",
        utmMedium: "QR",
        utmCampaign: "Nov 1",
        landingPath: "/sell-pokemon-cards?utm_source=card_show",
        referrerHost: "L.Facebook.com",
      },
    });
    expect(state.inserted).toMatchObject({
      referral_source: "Card show or event",
      utm_source: "card-show",
      utm_medium: "qr",
      utm_campaign: "nov-1",
      landing_path: "/sell-pokemon-cards",
      referrer_host: "l.facebook.com",
      ref_code: null,
    });
  });

  it("drops a 'how did you hear about us' answer that isn't one of the choices", async () => {
    await invoke({ ...valid, referralSource: "<script>alert(1)</script>" });
    expect(state.inserted?.referral_source).toBeNull();
  });

  it("credits an active referral partner's code, but not the partner referring themselves", async () => {
    state.partners = [{ id: "p1", kind: "referrer", status: "active", email: "jo@heirloom.example" }];
    state.codes = [{ code: "heirloom", user_id: null, partner_id: "p1" }];
    await invoke({ ...valid, attribution: { ref: "HEIRLOOM" } });
    expect(state.inserted?.ref_code).toBe("heirloom");

    await invoke({ ...valid, contact: { ...valid.contact, email: "Jo@Heirloom.example" }, attribution: { ref: "heirloom" } });
    expect(state.inserted?.ref_code).toBeNull();

    state.partners[0].status = "paused";
    await invoke({ ...valid, attribution: { ref: "heirloom" } });
    expect(state.inserted?.ref_code).toBeNull();
  });

  it("credits a customer's code unless it's the seller's own, and ignores unknown codes", async () => {
    state.users = { u1: { id: "u1", email: "friend@example.com" } };
    state.codes = [{ code: "friend22", user_id: "u1", partner_id: null }];
    await invoke({ ...valid, attribution: { ref: "friend22" } });
    expect(state.inserted?.ref_code).toBe("friend22");

    await invoke({ ...valid, contact: { ...valid.contact, email: "friend@example.com" }, attribution: { ref: "friend22" } });
    expect(state.inserted?.ref_code).toBeNull();

    await invoke({ ...valid, attribution: { ref: "nobody99" } });
    expect(state.inserted?.ref_code).toBeNull();
    // A malformed code never reaches the database lookup.
    await invoke({ ...valid, attribution: { ref: "x'; drop table--" } });
    expect(state.inserted?.ref_code).toBeNull();
  });

  it("pretends to succeed for bots that fill the honeypot, and stores nothing", async () => {
    const res = await invoke({ ...valid, website: "http://spam.example" });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(state.inserted).toBeNull();
    expect(emailCalls.admin).toEqual([]);
  });

  it("requires a known category, a description, a first name and a valid email", async () => {
    expect((await invoke({ ...valid, categories: ["baseball"] })).statusCode).toBe(400);
    expect((await invoke({ ...valid, description: "   " })).statusCode).toBe(400);
    expect((await invoke({ ...valid, contact: { email: "sam@example.com" } })).statusCode).toBe(400);
    expect((await invoke({ ...valid, contact: { firstName: "Sam", email: "nope" } })).statusCode).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it("needs a phone number when the seller asks for a call or text", async () => {
    const res = await invoke({
      ...valid,
      contact: { firstName: "Sam", email: "sam@example.com", preferredContactMethod: "text" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/phone/);
  });

  it("de-duplicates categories and ignores unknown size/handoff values", async () => {
    await invoke({
      ...valid,
      categories: ["video_games", "pokemon", "video_games", "nope"],
      size: "gigantic",
      handoff: "teleport",
    });
    expect(state.inserted).toMatchObject({
      categories: ["video_games", "pokemon"],
      collection_size: null,
      handoff: "not_sure",
    });
  });

  it("keeps only photos Storage confirms exist under the submitted draft", async () => {
    state.storageObjects = [
      { name: "real.jpg", id: "1", metadata: { size: 100, mimetype: "image/jpeg" } },
    ];
    await invoke({
      ...valid,
      draftId: DRAFT,
      photos: [
        { path: `${DRAFT}/real.jpg` },
        { path: `${DRAFT}/never-uploaded.jpg` },
        { path: "someone-elses-draft/real.jpg" },
      ],
    });
    expect(state.inserted?.photo_paths).toEqual([`${DRAFT}/real.jpg`]);
  });

  it("throttles repeat leads from the same email", async () => {
    state.recentCountForEmail = 3;
    const res = await invoke(valid);
    expect(res.statusCode).toBe(429);
    expect(state.inserted).toBeNull();
  });

  it("returns a clean 500 when the insert fails, without sending emails", async () => {
    state.insertShouldFail = true;
    const res = await invoke(valid);
    expect(res.statusCode).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(emailCalls.admin).toEqual([]);
  });
});
