import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// Results identified ON THE SCANNER PC (scanner-bridge/src/recognizer) and
// posted to /api/admin/scans/:id/recognize as { local }. The server checks
// every field, re-loads every printing from its own Scryfall index, only
// pre-selects a printing when its own auto-match bar agrees, applies the
// batch's foil switch, and still grades condition (previews only for sides
// that went up as the raw scan).

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const { default: handler } = await import("../api/admin/scans/[scanId]/recognize.ts");
const { parseLocalRecognition, chooseFinish, buildLocalIdentity } = await import("../api/_lib/recognition/localResult.ts");

const TOKEN = "staff-token";
const BOLT = "11111111-1111-4111-8111-111111111111";
const BOLT_SLD = "22222222-2222-4222-8222-222222222222";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";
const SCAN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function scryfallCard(id: string, overrides: Record<string, unknown> = {}) {
  return {
    object: "card",
    id,
    oracle_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    name: "Lightning Bolt",
    set: "m10",
    set_name: "Magic 2010",
    collector_number: "146",
    rarity: "common",
    layout: "normal",
    lang: "en",
    type_line: "Instant",
    artist: "Christopher Moeller",
    released_at: "2009-07-17",
    image_uris: {
      small: `https://cards.scryfall.io/small/front/${id}.jpg`,
      normal: `https://cards.scryfall.io/normal/front/${id}.jpg`,
      large: `https://cards.scryfall.io/large/front/${id}.jpg`,
      png: `https://cards.scryfall.io/png/front/${id}.png`,
      art_crop: `https://cards.scryfall.io/art_crop/front/${id}.jpg`,
    },
    finishes: ["nonfoil", "foil"],
    prices: { usd: "1.50", usd_foil: "4.00", usd_etched: null },
    ...overrides,
  };
}

function bulkRow(card: ReturnType<typeof scryfallCard>) {
  return { scryfall_id: card.id, set_code: String(card.set).toUpperCase(), collector_number: card.collector_number, raw: card };
}

function local(overrides: Record<string, unknown> = {}) {
  return {
    engine: "scanner_pc",
    engineVersion: "1.0.0",
    decision: "sure",
    candidates: [
      { scryfallId: BOLT, confidence: 0.96, reason: "Picture match 97%, look-alikes ruled out", visual: 0.97, similarity: 0.91, face: 0 },
      { scryfallId: BOLT_SLD, confidence: 0.79, reason: "Picture match 74%", visual: 0.74, similarity: 0.88, face: 0 },
    ],
    decisionReason: "Matched Lightning Bolt (M10 #146) — picture match 97%.",
    warnings: [],
    visualSimilarity: 0.97,
    finish: "foil",
    orientation: 180,
    sidesSwapped: true,
    straightened: { front: true, back: true },
    ocrText: null,
    timingsMs: { total: 512, find: 150 },
    library: { builtAt: "2026-10-12T05:00:00.000Z", entries: 108000, model: "dinov2-small@8b1f705" },
    ...overrides,
  };
}

async function cardImage(border = 30): Promise<Buffer> {
  // A black-bordered "card" filling the whole image, the way the scanner PC uploads it.
  const inner = await sharp({ create: { width: 744 - border * 2, height: 1039 - border * 2, channels: 3, background: { r: 180, g: 150, b: 110 } } })
    .png()
    .toBuffer();
  return sharp({ create: { width: 744, height: 1039, channels: 3, background: { r: 15, g: 15, b: 15 } } })
    .composite([{ input: inner, left: border, top: border }])
    .jpeg()
    .toBuffer();
}

let image: Buffer;
beforeAll(async () => {
  image = await cardImage();
});

beforeEach(() => {
  state = createFakeState();
  state.sessions[TOKEN] = { id: "staff-1", email: "scanner@example.com", app_metadata: { role: "staff" } };
  state.rpc.recompute_scan_session = () => ({ data: {}, error: null });
  state.tables.scryfall_bulk_cards = [
    bulkRow(scryfallCard(BOLT)),
    bulkRow(scryfallCard(BOLT_SLD, { set: "sld", set_name: "Secret Lair Drop", collector_number: "999" })),
  ];
  state.tables.card_scans = [
    {
      id: SCAN,
      scan_session_id: "session-1",
      front_image_path: "session-1/1-front-x-scan_1.jpg",
      back_image_path: "session-1/1-back-x-scan_2.jpg",
      review_status: "unreviewed",
      recognition_status: "none",
      selected_finish: null,
      selected_scryfall_id: null,
    },
  ];
  state.files["session-1/1-front-x-scan_1.jpg"] = { data: image };
  state.files["session-1/1-back-x-scan_2.jpg"] = { data: image };
});

async function post(body?: unknown) {
  const res = fakeResponse();
  await handler(
    { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, query: { scanId: SCAN }, body } as never,
    res as never,
  );
  return res as typeof res & { body: Record<string, unknown> };
}

const scan = () => state.tables.card_scans[0] as Record<string, unknown>;

describe("POST /api/admin/scans/:id/recognize with a scanner-PC result", () => {
  it("pre-matches a sure result, applies the foil switch, and records how the PC decided", async () => {
    const res = await post({ local: local() });
    expect(res.statusCode).toBe(200);
    expect(scan()).toMatchObject({
      recognition_status: "recognized",
      selected_scryfall_id: BOLT,
      review_status: "matched",
      selected_finish: "foil",
      recognition_confidence: 0.96,
    });
    const data = scan().recognition_data as Record<string, unknown>;
    expect(data).toMatchObject({
      engine: "scanner_pc",
      finishGuess: "foil",
      detectedName: "Lightning Bolt",
      detectedSetCode: "M10",
      visualSimilarity: 0.97,
      scannerPc: {
        version: "1.0.0",
        decision: "sure",
        orientation: 180,
        sidesSwapped: true,
        timingsMs: { total: 512, find: 150 },
        // Remembered so a later re-run on the PC treats the stored images the same way.
        straightened: { front: true, back: true },
      },
    });
    expect((data.candidatePrintings as Record<string, unknown>[]).map((c) => [c.scryfallId, c.imageUrl])).toEqual([
      [BOLT, `https://cards.scryfall.io/normal/front/${BOLT}.jpg`],
      [BOLT_SLD, `https://cards.scryfall.io/normal/front/${BOLT_SLD}.jpg`],
    ]);
    // Condition grading still ran here.
    expect(scan().suggested_condition).toBeTruthy();
    // The straightened JPEGs show in the browser as they are — no PNG copies.
    expect(scan().front_preview_path ?? null).toBeNull();
    expect(state.files["session-1/1-front-x-scan_1.jpg.preview.png"]).toBeUndefined();
    expect(state.files["session-1/1-back-x-scan_2.jpg.preview.png"]).toBeUndefined();
    // The printing is cached for the review UI.
    expect(state.tables.card_printings).toHaveLength(1);
  });

  it("uses the pre-straightened image as it is — no trimming into the card's black border", async () => {
    await post({ local: local() });
    expect((scan().recognition_data as Record<string, unknown>).normalizedDimensions).toEqual({ width: 744, height: 1039 });
    await post({ local: local({ straightened: { front: false, back: false } }) });
    const trimmed = (scan().recognition_data as { normalizedDimensions: { width: number } }).normalizedDimensions;
    expect(trimmed.width).toBeLessThan(744);
    // A side that went up as the raw scan still gets a browser-viewable preview.
    expect(scan().front_preview_path).toBe("session-1/1-front-x-scan_1.jpg.preview.png");
    expect(state.files["session-1/1-front-x-scan_1.jpg.preview.png"]).toBeDefined();
  });

  it("never overwrites a cached printing's prices with the bulk index's", async () => {
    state.tables.card_printings = [{ scryfall_id: BOLT, price_usd_cents: 175, prices_updated_at: "2026-10-12T01:00:00.000Z" }];
    await post({ local: local() });
    expect(state.tables.card_printings).toEqual([{ scryfall_id: BOLT, price_usd_cents: 175, prices_updated_at: "2026-10-12T01:00:00.000Z" }]);
  });

  it("sends a 'check' result to review with the candidates, remembering the batch finish for later", async () => {
    await post({ local: local({ decision: "check", candidates: local().candidates.map((c) => ({ ...c, confidence: 0.8 })) }) });
    expect(scan()).toMatchObject({ recognition_status: "low_confidence", review_status: "needs_manual_match", selected_scryfall_id: null, selected_finish: null });
    expect((scan().recognition_data as Record<string, unknown>).finishGuess).toBe("foil");
  });

  it("won't pre-select when the server's own bar disagrees with the PC's 'sure'", async () => {
    const tooClose = local({
      candidates: [
        { scryfallId: BOLT, confidence: 0.95, reason: "a", visual: 0.9, similarity: 0.9, face: 0 },
        { scryfallId: BOLT_SLD, confidence: 0.9, reason: "b", visual: 0.9, similarity: 0.9, face: 0 },
      ],
    });
    await post({ local: tooClose });
    expect(scan()).toMatchObject({ recognition_status: "low_confidence", selected_scryfall_id: null });
    expect(((scan().recognition_data as { warnings: string[] }).warnings).join(" ")).toMatch(/auto-match bar/);
  });

  it("drops printings this server doesn't know", async () => {
    await post({ local: local({ candidates: [{ scryfallId: UNKNOWN, confidence: 0.97, reason: "x", visual: 0.9, similarity: 0.9, face: 0 }] }) });
    expect(scan()).toMatchObject({ recognition_status: "failed", review_status: "pending_match", selected_scryfall_id: null });
    expect(((scan().recognition_data as { warnings: string[] }).warnings).join(" ")).toMatch(/card list/);
  });

  it("accepts a full-size result — every candidate, long reasons and warnings", async () => {
    const longReason = "Picture match 97%, collector number read, set code read, look-alikes ruled out ".repeat(3).trim();
    const big = local({
      candidates: Array.from({ length: 10 }, (_, i) => ({
        scryfallId: i === 0 ? BOLT : i === 1 ? BOLT_SLD : `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        confidence: i === 0 ? 0.96 : 0.6,
        reason: longReason,
        visual: 0.9,
        similarity: 0.9,
        face: 0,
      })),
      decisionReason: `${"Matched Fable of the Mirror-Breaker // Reflection of Kiki-Rikki (NEO #141) — picture match 97%; told apart from the same art in ".repeat(3)}…`,
      warnings: Array.from({ length: 6 }, () =>
        "The card's corner reads \"XYZ\", but the closest printing in the card library is NEO #141. If that set is newer than the shop's Scryfall card list, refresh the list, update the card library, and re-run this card.",
      ),
      ocrText: "0141 R / NEO • EN  Artist Name",
    });
    expect(JSON.stringify(big).length).toBeGreaterThan(4096);
    const res = await post({ local: big });
    expect(res.statusCode).toBe(200);
    expect(scan().recognition_status).toBe("recognized");
  });

  it("refuses a malformed result and leaves the scan alone", async () => {
    const res = await post({ local: local({ candidates: [{ scryfallId: "not-an-id", confidence: 1, reason: "", face: 0 }] }) });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Invalid scanner result/);
    expect(scan().recognition_status).toBe("none");
  });

  it("never changes a scan a person already reviewed", async () => {
    Object.assign(scan(), { review_status: "ready", selected_scryfall_id: BOLT_SLD, selected_finish: "nonfoil" });
    await post({ local: local() });
    expect(scan()).toMatchObject({ review_status: "ready", selected_scryfall_id: BOLT_SLD, selected_finish: "nonfoil" });
    expect((scan().recognition_data as Record<string, unknown>).engine).toBe("scanner_pc");
  });

  it("still saves the identification when the front image didn't make it to Storage", async () => {
    delete state.files["session-1/1-front-x-scan_1.jpg"];
    await post({ local: local() });
    expect(scan()).toMatchObject({ recognition_status: "recognized", selected_scryfall_id: BOLT });
  });
});

describe("parseLocalRecognition", () => {
  it("accepts a well-formed result and clamps out-of-range numbers", () => {
    const parsed = parseLocalRecognition(local({ visualSimilarity: 1.7, candidates: [{ scryfallId: BOLT.toUpperCase(), confidence: 2, reason: "x", visual: -1, similarity: 0.5, face: 0 }] }));
    expect(parsed.visualSimilarity).toBe(1);
    expect(parsed.candidates[0]).toMatchObject({ scryfallId: BOLT, confidence: 1, visual: 0 });
  });

  it("rejects the wrong engine, decision, finish or shape", () => {
    expect(() => parseLocalRecognition(local({ engine: "other" }))).toThrow(/engine/);
    expect(() => parseLocalRecognition(local({ decision: "maybe" }))).toThrow(/decision/);
    expect(() => parseLocalRecognition(local({ finish: "etched" }))).toThrow(/finish/);
    expect(() => parseLocalRecognition(local({ candidates: Array.from({ length: 11 }, () => local().candidates[0]) }))).toThrow(/at most/);
    expect(() => parseLocalRecognition("nope")).toThrow(/object/);
  });

  it("truncates long text instead of storing it whole", () => {
    expect(parseLocalRecognition(local({ decisionReason: "x".repeat(5000) })).decisionReason).toHaveLength(600);
  });
});

describe("chooseFinish", () => {
  it("follows the batch switch when the printing comes that way", () => {
    expect(chooseFinish("foil", ["nonfoil", "foil"])).toEqual({ finish: "foil", warning: null });
    expect(chooseFinish("nonfoil", ["nonfoil", "foil"])).toEqual({ finish: "nonfoil", warning: null });
  });

  it("uses the only finish a printing has, and says so when it differs from the batch", () => {
    expect(chooseFinish("nonfoil", ["foil"])).toMatchObject({ finish: "foil", warning: expect.stringMatching(/only comes as foil/) });
    expect(chooseFinish("foil", ["foil"])).toEqual({ finish: "foil", warning: null });
  });

  it("treats etched as foil-type, and leaves the finish alone with no batch setting", () => {
    expect(chooseFinish("foil", ["nonfoil", "etched"])).toEqual({ finish: "etched", warning: null });
    expect(chooseFinish(null, ["nonfoil", "foil"])).toEqual({ finish: null, warning: null });
  });
});

describe("buildLocalIdentity", () => {
  it("keeps the PC's order and reasons, with each printing's image", async () => {
    const identity = await buildLocalIdentity(createFakeSupabase(state) as never, parseLocalRecognition(local()));
    expect(identity.autoMatchedPrinting?.scryfallId).toBe(BOLT);
    expect(identity.recognitionResult.candidatePrintings[1]).toMatchObject({ scryfallId: BOLT_SLD, setCode: "SLD", reason: "Picture match 74%" });
  });
});
