import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";
import { SORTING_SHIPPING_TERMS } from "../src/store/lib/sortingService";
import { US_STATE_MESSAGE } from "../src/store/lib/usAddress";

// POST /api/sorting-requests — the collection sorting request form. Prices
// come from the database, never the browser; shipped collections need a US
// return address and the shipping-terms checkbox, stored word for word.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const emails = vi.hoisted(() => ({ received: [] as string[], staff: [] as { id: string; kind: string }[] }));
vi.mock("../api/_lib/sortingEmails.js", () => ({
  sendSortingRequestReceived: async (id: string) => {
    emails.received.push(id);
    return { status: "sent" };
  },
  notifySortingStaff: async (id: string, event: { kind: string }) => {
    emails.staff.push({ id, kind: event.kind });
  },
}));

const { default: handler } = await import("../api/sorting-requests.ts");

const OPTION = "11111111-1111-4111-8111-111111111111";
const HIDDEN = "22222222-2222-4222-8222-222222222222";
const MY_ADDRESS = "33333333-3333-4333-8333-333333333333";
const THEIR_ADDRESS = "44444444-4444-4444-8444-444444444444";
const TOKEN = "member-token";

let ipCounter = 0;

beforeEach(() => {
  state = createFakeState();
  emails.received = [];
  emails.staff = [];
  state.tables.sorting_service_options = [
    { id: OPTION, name: "Sort by set", rate_per_thousand_cents: 2000, active: true },
    { id: HIDDEN, name: "Old rate", rate_per_thousand_cents: 1000, active: false },
  ];
  state.tables.sorting_requests = [];
  let seq = 1000;
  state.defaults.sorting_requests = () => ({ reference_number: `GG-SR-${++seq}`, status: "new" });
  state.tables.addresses = [
    { id: MY_ADDRESS, user_id: "member-1", recipient: "Ann Lee", line1: "1 Main St", line2: null, city: "Ballwin", state: "Missouri", postal_code: "63011", country: "US" },
    { id: THEIR_ADDRESS, user_id: "someone-else", recipient: "Bo", line1: "2 Elm", line2: null, city: "Town", state: "IL", postal_code: "62001", country: "US" },
  ];
  state.sessions[TOKEN] = { id: "member-1", email: "ann@example.com", app_metadata: {} };
});

const BASE = {
  optionId: OPTION,
  estimatedCards: 2500,
  deliveryMethod: "drop_off",
  firstName: " Ann ",
  lastName: "Lee",
  email: "ANN@Example.com",
  phone: "",
  notes: "",
  shippingTermsAccepted: false,
  website: "",
};

const TYPED_ADDRESS = { recipient: "", line1: "9 Oak Ave", line2: "", city: "St. Louis", state: "missouri", postalCode: "63101 1234" };

async function post(body: Record<string, unknown>, token?: string) {
  const res = fakeResponse();
  ipCounter++;
  await handler(
    {
      method: "POST",
      headers: { "x-forwarded-for": `10.0.0.${ipCounter}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body,
    } as never,
    res as never,
  );
  return res as typeof res & { body: Record<string, unknown> };
}

const saved = () => state.tables.sorting_requests as Record<string, unknown>[];

describe("POST /api/sorting-requests", () => {
  it("stores a drop-off request with the rate and estimate from the database", async () => {
    const res = await post({ ...BASE, ratePerThousandCents: 1 /* ignored */ });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, referenceNumber: "GG-SR-1001" });
    expect(saved()).toHaveLength(1);
    expect(saved()[0]).toMatchObject({
      first_name: "Ann",
      email: "ann@example.com",
      option_id: OPTION,
      option_name: "Sort by set",
      rate_per_thousand_cents: 2000,
      estimated_cards: 2500,
      estimated_sorting_cents: 5000,
      delivery_method: "drop_off",
      shipping_terms_accepted_at: null,
      shipping_terms_text: null,
      user_id: null,
    });
    expect(saved()[0].return_line1).toBeUndefined();
    expect(emails.received).toHaveLength(1);
    expect(emails.staff).toEqual([{ id: saved()[0].id, kind: "new_request" }]);
  });

  it("needs the shipping checkbox for a shipped collection", async () => {
    const res = await post({ ...BASE, deliveryMethod: "ship", returnAddress: TYPED_ADDRESS });
    expect(res.statusCode).toBe(400);
    expect(String(res.body.message)).toMatch(/shipping terms/);
    expect(saved()).toHaveLength(0);
  });

  it("stores a typed US return address, tidied, with the exact shipping terms", async () => {
    const res = await post({ ...BASE, deliveryMethod: "ship", returnAddress: TYPED_ADDRESS, shippingTermsAccepted: true });
    expect(res.statusCode).toBe(200);
    expect(saved()[0]).toMatchObject({
      delivery_method: "ship",
      return_address_id: null,
      return_recipient: "Ann Lee",
      return_line1: "9 Oak Ave",
      return_line2: null,
      return_city: "St. Louis",
      return_state: "MO",
      return_postal_code: "63101-1234",
      return_country: "US",
      shipping_terms_text: SORTING_SHIPPING_TERMS,
    });
    expect(typeof saved()[0].shipping_terms_accepted_at).toBe("string");
  });

  it("refuses a return address outside the US", async () => {
    const res = await post({
      ...BASE,
      deliveryMethod: "ship",
      shippingTermsAccepted: true,
      returnAddress: { ...TYPED_ADDRESS, state: "Ontario" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe(US_STATE_MESSAGE);
  });

  it("copies a saved address from the signed-in customer's own address book, and links the account", async () => {
    const res = await post(
      { ...BASE, deliveryMethod: "ship", shippingTermsAccepted: true, returnAddressId: MY_ADDRESS },
      TOKEN,
    );
    expect(res.statusCode).toBe(200);
    expect(saved()[0]).toMatchObject({
      user_id: "member-1",
      return_address_id: MY_ADDRESS,
      return_recipient: "Ann Lee",
      return_line1: "1 Main St",
      return_state: "MO",
      return_postal_code: "63011",
    });
  });

  it("won't use someone else's saved address, or a saved address without a session", async () => {
    const theirs = await post(
      { ...BASE, deliveryMethod: "ship", shippingTermsAccepted: true, returnAddressId: THEIR_ADDRESS },
      TOKEN,
    );
    expect(theirs.statusCode).toBe(404);
    const signedOut = await post({ ...BASE, deliveryMethod: "ship", shippingTermsAccepted: true, returnAddressId: MY_ADDRESS });
    expect(signedOut.statusCode).toBe(401);
    expect(saved()).toHaveLength(0);
  });

  it("only offers options staff have shown", async () => {
    expect((await post({ ...BASE, optionId: HIDDEN })).statusCode).toBe(409);
    expect((await post({ ...BASE, optionId: "55555555-5555-4555-8555-555555555555" })).statusCode).toBe(409);
    expect((await post({ ...BASE, optionId: "nope" })).statusCode).toBe(400);
  });

  it("checks the card count and the contact details", async () => {
    for (const estimatedCards of [0, 1.5, 1_000_001, "lots"]) {
      expect((await post({ ...BASE, estimatedCards })).statusCode, String(estimatedCards)).toBe(400);
    }
    expect((await post({ ...BASE, estimatedCards: "12,000" })).statusCode).toBe(200);
    expect((await post({ ...BASE, email: "not-an-email" })).statusCode).toBe(400);
    expect((await post({ ...BASE, deliveryMethod: "teleport" })).statusCode).toBe(400);
  });

  it("answers a double-submit with the first request, and caps requests per email", async () => {
    await post(BASE);
    const again = await post(BASE);
    expect(again.body).toMatchObject({ ok: true, referenceNumber: "GG-SR-1001", duplicate: true });
    expect(saved()).toHaveLength(1);

    await post({ ...BASE, estimatedCards: 3000 });
    await post({ ...BASE, estimatedCards: 4000 });
    const fourth = await post({ ...BASE, estimatedCards: 5000 });
    expect(fourth.statusCode).toBe(429);
    expect(saved()).toHaveLength(3);
  });

  it("stores nothing when the honeypot is filled", async () => {
    const res = await post({ ...BASE, website: "http://spam.example" });
    expect(res.body).toMatchObject({ ok: true, referenceNumber: "GG-SR-0000" });
    expect(saved()).toHaveLength(0);
    expect(emails.received).toHaveLength(0);
  });

  it("is POST only", async () => {
    const res = fakeResponse();
    await handler({ method: "GET", headers: {} } as never, res as never);
    expect(res.statusCode).toBe(405);
  });
});
