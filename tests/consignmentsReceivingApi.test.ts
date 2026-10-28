import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// /api/admin/consignments receiving actions: every line is matched to one
// exact printing in the local card database before anything is saved; the
// card's name, set, rarity and image come from that printing, never from the
// browser; a batch with any problem line is refused whole; inspection steps
// go to consignment_inspect_lot with the database's refusals passed on.
// (The database side is tested in tests/consignmentReceivingDb.test.ts.)

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const { default: handler } = await import("../api/admin/consignments.ts");

const STAFF = "staff-token";
const CONSIGNMENT = "11111111-1111-4111-8111-111111111111";
const LOT = "22222222-2222-4222-8222-222222222222";
const SOL_CMR = "aaaaaaaa-0000-4000-8000-000000000001";
const SOL_C21 = "aaaaaaaa-0000-4000-8000-000000000002";
const SIGNET = "aaaaaaaa-0000-4000-8000-000000000003";

async function post(body: Record<string, unknown>, token: string | null = STAFF) {
  const res = fakeResponse();
  await handler({ method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, query: {}, body } as never, res as never);
  return res as typeof res & { body: Record<string, unknown> & { message?: string } };
}

const printing = (id: string, name: string, set: string, cn: string, finishes: string[], usd: string | null, foil: string | null = null) => ({
  scryfall_id: id,
  oracle_id: "bbbbbbbb-0000-4000-8000-000000000001",
  card_name: name,
  set_code: set,
  set_name: set.toUpperCase() + " set",
  collector_number: cn,
  lang: "en",
  rarity: "uncommon",
  finishes,
  image_uris: { normal: `https://img.example/${id}.jpg` },
  card_faces: null,
  prices: { usd, usd_foil: foil, usd_etched: null },
});

let received: Record<string, unknown> | null;
let inspected: Record<string, unknown> | null;

beforeEach(() => {
  state = createFakeState();
  state.sessions[STAFF] = { id: "staff-1", email: "helper@example.com", app_metadata: { role: "staff" } };
  state.tables.admin_audit_log = [];
  state.tables.scryfall_bulk_cards = [
    printing(SOL_CMR, "Sol Ring", "cmr", "472", ["nonfoil", "foil"], "1.25", "4.10"),
    printing(SOL_C21, "Sol Ring", "c21", "263", ["nonfoil"], "1.10"),
    printing(SIGNET, "Arcane Signet", "cmr", "297", ["nonfoil", "foil"], "0.80", "2.00"),
  ];
  received = null;
  inspected = null;
  state.rpc.consignment_receive = (args) => {
    received = args;
    return { data: "batch-1", error: null };
  };
  state.rpc.consignment_inspect_lot = (args) => {
    inspected = args;
    return { data: args.p_action === "accept" ? "accepted" : "under_inspection", error: null };
  };
});

describe("previewReceive", () => {
  it("matches by set and collector number, by Scryfall ID, and by an unambiguous name", async () => {
    const res = await post({
      action: "previewReceive",
      lines: [
        { setCode: "CMR", collectorNumber: "472", finish: "foil", condition: "Near Mint", quantity: 2 },
        { scryfallId: SOL_C21, quantity: 1 },
        { name: "arcane signet", quantity: 3, listPriceCents: 100 },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.copies).toBe(6);
    const lines = res.body.lines as { printing: { scryfallId: string; cardName: string }; finish: string; declaredCondition: string; marketPriceCents: number }[];
    expect(lines.map((l) => l.printing.scryfallId)).toEqual([SOL_CMR, SOL_C21, SIGNET]);
    expect(lines[0]).toMatchObject({ finish: "foil", declaredCondition: "NM", marketPriceCents: 410 });
    expect(lines[2].printing.cardName).toBe("Arcane Signet");
    expect(state.writes).toHaveLength(0);
  });

  it("names each problem: ambiguous names, missing printings, finishes a printing doesn't come in, bad prices", async () => {
    const res = await post({
      action: "previewReceive",
      lines: [
        { name: "Sol Ring", quantity: 1 },
        { setCode: "CMR", collectorNumber: "999", quantity: 1 },
        { setCode: "C21", collectorNumber: "263", finish: "foil", quantity: 1 },
        { setCode: "CMR", collectorNumber: "297", quantity: 1, listPriceCents: 300, minPriceCents: 500 },
        { setCode: "CMR", collectorNumber: "472", name: "Arcane Signet", quantity: 0 },
      ],
    });
    expect(res.body.ok).toBe(false);
    const problems = (res.body.lines as { problems: string[] }[]).map((l) => l.problems.join(" "));
    expect(problems[0]).toMatch(/has 2 printings/);
    expect(problems[1]).toMatch(/No printing CMR #999/);
    expect(problems[2]).toMatch(/doesn't come in foil/);
    expect(problems[3]).toMatch(/minimum price is above the list price/);
    expect(problems[4]).toMatch(/is Sol Ring, not Arcane Signet/);
    expect(problems[4]).toMatch(/Quantity must be/);
  });

  it("narrows a name to the set given", async () => {
    const res = await post({ action: "previewReceive", lines: [{ name: "Sol Ring", setCode: "c21", quantity: 1 }] });
    expect(res.body.ok).toBe(true);
  });

  it("is for staff, and caps the batch size", async () => {
    expect((await post({ action: "previewReceive", lines: [{ name: "Sol Ring", quantity: 1 }] }, null)).statusCode).toBe(401);
    const big = await post({ action: "previewReceive", lines: Array.from({ length: 1001 }, () => ({ name: "Sol Ring", quantity: 1 })) });
    expect(big.statusCode).toBe(400);
    expect(big.body.message).toMatch(/up to 1000/);
  });
});

describe("receiveCards", () => {
  it("records the batch with the card data from the printing, not the browser, and audits it", async () => {
    const res = await post({
      action: "receiveCards",
      consignmentId: CONSIGNMENT,
      method: "mail",
      carrier: "USPS",
      trackingNumber: "9400 1",
      lines: [{ scryfallId: SOL_CMR, name: "Totally Different Card", finish: "nonfoil", condition: "LP", quantity: 2, listPriceCents: 150, minPriceCents: 100 }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ batchId: "batch-1", lines: 1 });
    expect(received).toMatchObject({ p_consignment_id: CONSIGNMENT, p_method: "mail", p_carrier: "USPS", p_tracking: "9400 1", p_actor: "helper@example.com" });
    expect((received!.p_lines as Record<string, unknown>[])[0]).toEqual({
      scryfallId: SOL_CMR,
      oracleId: "bbbbbbbb-0000-4000-8000-000000000001",
      cardName: "Sol Ring",
      setCode: "cmr",
      setName: "CMR set",
      collectorNumber: "472",
      rarity: "uncommon",
      imageUrl: `https://img.example/${SOL_CMR}.jpg`,
      language: "en",
      finish: "nonfoil",
      declaredCondition: "LP",
      quantity: 2,
      marketPriceCents: 125,
      listPriceCents: 150,
      minPriceCents: 100,
      notes: null,
    });
    expect(state.tables.admin_audit_log).toHaveLength(1);
  });

  it("refuses the whole batch when any line has a problem", async () => {
    const res = await post({
      action: "receiveCards",
      consignmentId: CONSIGNMENT,
      lines: [
        { scryfallId: SOL_CMR, quantity: 1 },
        { name: "Sol Ring", quantity: 1, sourceRow: 7 },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Fix 1 line first: row 7: "Sol Ring" has 2 printings/);
    expect(received).toBeNull();
  });

  it("passes on the database's refusal for an unsigned consignment", async () => {
    state.rpc.consignment_receive = () => ({ data: null, error: { code: "GC042", message: "Cards can be received only after the agreement is signed." } });
    const res = await post({ action: "receiveCards", consignmentId: CONSIGNMENT, lines: [{ scryfallId: SOL_CMR, quantity: 1 }] });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/only after the agreement is signed/);
  });
});

describe("inspectLot", () => {
  it("accepts with the graded condition, prices and count", async () => {
    const res = await post({
      action: "inspectLot",
      lotId: LOT,
      step: "accept",
      quantityAccepted: 2,
      condition: "MP",
      finish: "foil",
      listPriceCents: 400,
      minPriceCents: 300,
      reason: "One copy was a proxy",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("accepted");
    expect(inspected).toMatchObject({
      p_lot_id: LOT,
      p_action: "accept",
      p_quantity_accepted: 2,
      p_condition: "MP",
      p_finish: "foil",
      p_list_price_cents: 400,
      p_min_price_cents: 300,
      p_reason: "One copy was a proxy",
      p_allow_below_minimum: false,
      p_actor: "helper@example.com",
    });
    expect(state.tables.admin_audit_log).toHaveLength(1);
  });

  it("refuses an unknown step or bad numbers before reaching the database", async () => {
    expect((await post({ action: "inspectLot", lotId: LOT, step: "approve" })).statusCode).toBe(400);
    expect((await post({ action: "inspectLot", lotId: LOT, step: "accept", quantityAccepted: 1.5 })).statusCode).toBe(400);
    expect(inspected).toBeNull();
  });

  it("passes on the database's refusals", async () => {
    state.rpc.consignment_inspect_lot = () => ({ data: null, error: { code: "GC046", message: "This card is below the minimum accepted value of $5.00." } });
    const res = await post({ action: "inspectLot", lotId: LOT, step: "accept", quantityAccepted: 1, condition: "NM", listPriceCents: 100 });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/below the minimum accepted value/);
  });
});
