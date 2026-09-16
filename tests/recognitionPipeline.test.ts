import { describe, expect, it } from "vitest";
import { scoreAndRank, combineAndDecide, runRecognitionPipeline } from "../api/_lib/recognition/pipeline";
import { parseCollectorLine } from "../api/_lib/recognition/ocrFields";
import { gradeFromFindings, type DefectFinding } from "../api/_lib/recognition/condition";
import {
  computeImageHash,
  hashDistance,
  hashSimilarity,
} from "../api/_lib/recognition/imageHash";
import type { CardPrinting } from "../src/admin/types";
import type { VisualVerification } from "../api/_lib/recognition/verification";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import sharp from "sharp";

// The pipeline's core promise: precision over recall. These tests exercise
// the DECISION logic (never the network/OCR calls) across the representative
// metadata scenarios Part 17 calls for — a difficult/ambiguous card must
// come back as "needs manual review", never a confident wrong guess.

function printing(overrides: Partial<CardPrinting> = {}): CardPrinting {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    cardName: "Lightning Bolt",
    setName: "Modern Horizons 2",
    setCode: "MH2",
    collectorNumber: "138",
    rarity: "uncommon",
    cardType: "Instant",
    imageUrl: "https://cards.scryfall.io/large/x.jpg",
    availableFinishes: ["nonfoil"],
    scryfallPriceCents: 500,
    scryfallId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    oracleId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    images: {
      small: null,
      normal: null,
      large: "https://cards.scryfall.io/large/x.jpg",
      png: null,
      artCrop: "https://cards.scryfall.io/art_crop/x.jpg",
    },
    faces: [],
    layout: "normal",
    artist: "Christopher Rush",
    releasedAt: "2021-06-18",
    language: "en",
    frame: "2015",
    frameEffects: [],
    borderColor: "black",
    fullArt: false,
    textless: false,
    promo: false,
    promoTypes: [],
    treatments: [],
    prices: { usd: 500, usdFoil: null, usdEtched: null },
    ...overrides,
  };
}

function visual(p: CardPrinting, combinedSimilarity: number): VisualVerification {
  return {
    printing: p,
    fullCardSimilarity: combinedSimilarity,
    artSimilarity: combinedSimilarity,
    combinedSimilarity,
  };
}

describe("parseCollectorLine (Part 7 era signals)", () => {
  it("parses a standard modern collector line", () => {
    expect(parseCollectorLine("138/281 M MH2 EN")).toEqual({
      collectorNumber: "138",
      rarity: "mythic",
      setCode: "MH2",
      language: "en",
    });
  });

  it("parses a common-rarity line with a leading zero", () => {
    expect(parseCollectorLine("0059/281 C MH2 EN").collectorNumber).toBe("59");
  });

  it("handles a promo card's line", () => {
    const r = parseCollectorLine("012/999 R PLST EN");
    expect(r.collectorNumber).toBe("12");
    expect(r.rarity).toBe("rare");
  });

  it("returns nulls for an unreadable/empty line (pre-M15 cards have none)", () => {
    expect(parseCollectorLine("")).toEqual({
      collectorNumber: null,
      rarity: null,
      setCode: null,
      language: null,
    });
  });

  it("returns nulls for garbage OCR noise rather than a false match", () => {
    const r = parseCollectorLine("   ");
    expect(r.collectorNumber).toBeNull();
  });

  it("extracts a bare collector number with no set-code token (a partial/damaged OCR crop) rather than guessing a set", () => {
    const r = parseCollectorLine("138/281");
    expect(r.collectorNumber).toBe("138");
    expect(r.setCode).toBeNull();
    expect(r.rarity).toBeNull();
    expect(r.language).toBeNull();
  });
});

describe("scoreAndRank + combineAndDecide (Part 10 precision-over-recall)", () => {
  it("auto-matches a standard modern card: one strong candidate, high visual agreement", () => {
    const bolt = printing();
    const ranked = scoreAndRank([bolt], [visual(bolt, 0.97)], "Lightning Bolt");
    const { autoMatch, reason } = combineAndDecide(ranked);
    expect(autoMatch?.printing.scryfallId).toBe(bolt.scryfallId);
    expect(reason).toMatch(/auto-matched/i);
  });

  it("does NOT auto-match a showcase/borderless treatment with only weak visual signal", () => {
    const showcase = printing({
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      scryfallId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      treatments: ["showcase", "borderless"],
      borderColor: "borderless",
    });
    const ranked = scoreAndRank([showcase], [visual(showcase, 0.5)], "Lightning Bolt");
    const { autoMatch } = combineAndDecide(ranked);
    expect(autoMatch).toBeNull();
  });

  it("does NOT auto-match when two candidates are close (ambiguous — conflicting signals)", () => {
    const a = printing({ id: "a", scryfallId: "a", setCode: "MH2" });
    const b = printing({
      id: "b",
      scryfallId: "b",
      setCode: "MH1",
      cardName: "Lightning Bolt", // same name, different set — genuinely ambiguous
    });
    const ranked = scoreAndRank([a, b], [visual(a, 0.92), visual(b, 0.9)], "Lightning Bolt");
    const { autoMatch, reason } = combineAndDecide(ranked);
    expect(autoMatch).toBeNull();
    expect(reason).toMatch(/ambiguous/i);
  });

  it("sends a DFC (double-faced card) with only front-face visual data to review when visual similarity is inconclusive", () => {
    const dfc = printing({
      cardName: "Delver of Secrets // Insectile Aberration",
      layout: "transform",
      treatments: [],
    });
    // A DFC's back-face art won't match the front scan at all — this
    // simulates a weak/inconclusive combined score, which must not
    // auto-match just because it's the only candidate.
    const ranked = scoreAndRank([dfc], [visual(dfc, 0.6)], "Delver of Secrets");
    const { autoMatch } = combineAndDecide(ranked);
    expect(autoMatch).toBeNull();
  });

  it("sends an alternate-language printing to review when the name doesn't textually agree", () => {
    const jpPrinting = printing({ language: "ja", cardName: "稲妻" });
    // OCR read the ENGLISH oracle name (or garbled text) because the
    // pipeline doesn't have Japanese OCR tuned — name won't match, but
    // visual could still be strong. Combined score should still reflect the
    // missing name-agreement signal.
    const ranked = scoreAndRank([jpPrinting], [visual(jpPrinting, 0.88)], "Lightning Bolt");
    const { autoMatch } = combineAndDecide(ranked);
    // 0.88 visual alone (no name match) should NOT clear the 0.9 bar.
    expect(autoMatch).toBeNull();
  });

  it("never auto-matches with zero candidates (vintage/no readable signal)", () => {
    const { autoMatch, reason } = combineAndDecide([]);
    expect(autoMatch).toBeNull();
    expect(reason).toMatch(/no candidates/i);
  });

  it("auto-matches a full-art / retro-frame / promo card when signals genuinely agree", () => {
    const fullArt = printing({
      treatments: ["full_art", "retro_frame", "promo"],
      fullArt: true,
      promo: true,
    });
    const ranked = scoreAndRank([fullArt], [visual(fullArt, 0.99)], "Lightning Bolt");
    const { autoMatch } = combineAndDecide(ranked);
    expect(autoMatch?.printing.treatments).toContain("full_art");
  });

  it("auto-matches an extended-art treatment on strong visual agreement, same as a normal printing", () => {
    const extendedArt = printing({
      id: "extended-art-id",
      scryfallId: "extended-art-id",
      treatments: ["extended_art"],
    });
    const ranked = scoreAndRank([extendedArt], [visual(extendedArt, 0.97)], "Lightning Bolt");
    const { autoMatch } = combineAndDecide(ranked);
    expect(autoMatch?.printing.treatments).toContain("extended_art");
  });

  it("a card without a collector number (pre-Exodus) still needs strong agreement to auto-match", () => {
    const vintage = printing({
      collectorNumber: "",
      setCode: "LEA",
      setName: "Limited Edition Alpha",
      releasedAt: "1993-08-05",
    });
    // Weak evidence (no name match, moderate visual) for a valuable vintage
    // card — must stay conservative per Part 7's explicit "be extremely
    // conservative" for Alpha/Beta/Unlimited-era cards.
    const ranked = scoreAndRank([vintage], [visual(vintage, 0.7)], "");
    const { autoMatch } = combineAndDecide(ranked);
    expect(autoMatch).toBeNull();
  });
});

describe("gradeFromFindings (Part 9 condition mapping)", () => {
  const finding = (overrides: Partial<DefectFinding>): DefectFinding => ({
    region: "front surface",
    kind: "surface_wear",
    severity: "light",
    note: "light wear",
    ...overrides,
  });

  it("grades NM with no findings", () => {
    expect(gradeFromFindings([])).toBe("NM");
  });

  it("grades LP with one or two light findings", () => {
    expect(gradeFromFindings([finding({ severity: "light" })])).toBe("LP");
  });

  it("grades MP with a moderate finding", () => {
    expect(gradeFromFindings([finding({ severity: "moderate" })])).toBe("MP");
  });

  it("grades HP with a heavy finding", () => {
    expect(gradeFromFindings([finding({ severity: "heavy" })])).toBe("HP");
  });

  it("grades HP with several moderate findings even without a heavy one", () => {
    const findings = Array.from({ length: 4 }, () => finding({ severity: "moderate" }));
    expect(gradeFromFindings(findings)).toBe("HP");
  });

  it("grades DMG for any structural/writing/liquid finding regardless of other findings", () => {
    expect(
      gradeFromFindings([finding({ kind: "writing_or_ink", severity: "light" })]),
    ).toBe("DMG");
    expect(
      gradeFromFindings([finding({ kind: "stain_or_liquid", severity: "light" })]),
    ).toBe("DMG");
  });
});

describe("imageHash (Part 6.4 visual verification primitive)", () => {
  it("gives distance 0 / similarity 1 for the identical image", async () => {
    const img = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 200, b: 50 } },
    })
      .png()
      .toBuffer();
    const a = await computeImageHash(img);
    const b = await computeImageHash(img);
    expect(hashDistance(a, b)).toBe(0);
    expect(hashSimilarity(hashDistance(a, b))).toBe(1);
  });

  it("gives a real (non-zero) distance for visibly different images", async () => {
    const solid = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();
    const checkered = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 16, height: 16, channels: 3, background: { r: 255, g: 255, b: 255 } },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const a = await computeImageHash(solid);
    const b = await computeImageHash(checkered);
    expect(hashDistance(a, b)).toBeGreaterThan(0);
    expect(hashSimilarity(hashDistance(a, b))).toBeLessThan(1);
  });

  it("similarity is bounded between 0 and 1", () => {
    expect(hashSimilarity(0)).toBe(1);
    expect(hashSimilarity(64)).toBe(0);
    expect(hashSimilarity(32)).toBeCloseTo(0.5);
  });
});

describe("runRecognitionPipeline scan modes (pick card matching / condition / both)", () => {
  // Never actually queried: OCR runs for real here (the free local
  // tesseract provider, no API key needed), but a solid-color image with no
  // text on it reads back empty, so identity never reaches a readable
  // collector line or name and the DB-querying candidate-generation
  // branches are never entered — proven by these tests passing with a
  // client that would throw on any real call.
  const fakeAdmin = {} as unknown as SupabaseClient<Database>;

  async function fakeCardImage(): Promise<Buffer> {
    return sharp({
      create: { width: 200, height: 280, channels: 3, background: { r: 20, g: 20, b: 40 } },
    })
      .jpeg()
      .toBuffer();
  }

  it('mode "condition": skips identity entirely (never a false "failed") and still grades condition', async () => {
    const front = await fakeCardImage();
    const back = await fakeCardImage();
    const result = await runRecognitionPipeline(fakeAdmin, front, back, "condition");
    expect(result.recognitionResult.candidatePrintings).toEqual([]);
    expect(result.autoMatchedPrinting).toBeNull();
    expect(result.recognitionResult.decisionReason).toMatch(/condition-only/i);
    expect(result.condition).not.toBeNull();
    expect(result.condition?.suggestedCondition).toBeTruthy();
  });

  it('mode "card_matching": runs identity normally but never computes a condition suggestion', async () => {
    const front = await fakeCardImage();
    const back = await fakeCardImage();
    const result = await runRecognitionPipeline(fakeAdmin, front, back, "card_matching");
    expect(result.condition).toBeNull();
    // Identity was genuinely attempted (the normal no-readable-text path),
    // not the condition-only skip stub.
    expect(result.recognitionResult.decisionReason).not.toMatch(/condition-only/i);
    expect(
      result.recognitionResult.warnings.some((w) => /no readable identity signal/i.test(w)),
    ).toBe(true);
  });

  it('mode "both" (default): runs identity and grades condition', async () => {
    const front = await fakeCardImage();
    const back = await fakeCardImage();
    const result = await runRecognitionPipeline(fakeAdmin, front, back);
    expect(result.condition).not.toBeNull();
    expect(
      result.recognitionResult.warnings.some((w) => /no readable identity signal/i.test(w)),
    ).toBe(true);
  });
});
