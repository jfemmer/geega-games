import { describe, expect, it } from "vitest";
import { approvalPatch, defaultFinish, isSureMatch, matchDefaults, suggestedPrice } from "../src/admin/utils/scanApproval";
import type { CardPrinting, CardRecognitionResult, InventoryPriceFloor } from "../src/admin/types";

// The defaults a confirmed match gets — shared by picking a match, Enter,
// and "Approve sure matches" — and what approving requires.

function printing(overrides: Partial<CardPrinting> = {}): CardPrinting {
  return {
    id: "p",
    cardName: "Lightning Bolt",
    setName: "Magic 2010",
    setCode: "M10",
    collectorNumber: "146",
    rarity: "common",
    cardType: "Instant",
    imageUrl: null,
    availableFinishes: ["nonfoil", "foil"],
    scryfallPriceCents: 150,
    scryfallId: "p",
    oracleId: "o",
    images: { small: null, normal: null, large: null, png: null, artCrop: null },
    faces: [],
    layout: "normal",
    artist: null,
    releasedAt: null,
    language: "en",
    frame: null,
    frameEffects: [],
    borderColor: null,
    fullArt: false,
    textless: false,
    promo: false,
    promoTypes: [],
    treatments: [],
    prices: { usd: 150, usdFoil: 400, usdEtched: null },
    ...overrides,
  } as CardPrinting;
}

function recognition(finishGuess: CardRecognitionResult["finishGuess"]): CardRecognitionResult {
  return { detectedName: null, detectedSetCode: null, detectedCollectorNumber: null, detectedLanguage: null, finishGuess, candidatePrintings: [], confidence: 0.95, fieldConfidence: {}, warnings: [] };
}

const scan = (overrides: Record<string, unknown> = {}) => ({
  selectedFinish: null,
  priceCents: null,
  confirmedCondition: null,
  recognitionData: null,
  ...overrides,
});

const floors: InventoryPriceFloor[] = [{ rarity: "common", minPriceCents: 25 } as InventoryPriceFloor, { rarity: "rare", minPriceCents: 300 } as InventoryPriceFloor];

describe("defaultFinish", () => {
  it("keeps a valid finish staff chose, else follows the batch's foil switch, else the first finish", () => {
    expect(defaultFinish(scan({ selectedFinish: "nonfoil", recognitionData: recognition("foil") }), printing())).toBe("nonfoil");
    expect(defaultFinish(scan({ recognitionData: recognition("foil") }), printing())).toBe("foil");
    expect(defaultFinish(scan({ recognitionData: recognition("foil") }), printing({ availableFinishes: ["nonfoil", "etched"] }))).toBe("etched");
    expect(defaultFinish(scan(), printing())).toBe("nonfoil");
    expect(defaultFinish(scan({ selectedFinish: "etched" }), printing())).toBe("nonfoil");
  });
});

describe("suggestedPrice", () => {
  it("uses the price for that finish, raised to the rarity's floor", () => {
    expect(suggestedPrice(printing(), "foil", floors)).toBe(400);
    expect(suggestedPrice(printing(), "nonfoil", floors)).toBe(150);
    expect(suggestedPrice(printing({ prices: { usd: 10, usdFoil: null, usdEtched: null }, scryfallPriceCents: 10 }), "foil", floors)).toBe(25);
    expect(suggestedPrice(printing({ prices: { usd: null, usdFoil: null, usdEtched: null }, scryfallPriceCents: null }), "nonfoil", floors)).toBeNull();
  });
});

describe("matchDefaults", () => {
  it("never overwrites a price staff typed", () => {
    expect(matchDefaults(scan({ priceCents: 999, recognitionData: recognition("foil") }), printing(), floors)).toEqual({ selectedFinish: "foil", priceCents: 999 });
    expect(matchDefaults(scan({ recognitionData: recognition("foil") }), printing(), floors)).toEqual({ selectedFinish: "foil", priceCents: 400 });
  });
});

describe("approvalPatch", () => {
  it("fills what's missing and marks the card ready", () => {
    expect(approvalPatch(scan({ confirmedCondition: "NM" }), printing(), floors)).toEqual({
      ok: true,
      patch: { reviewStatus: "ready", selectedFinish: "nonfoil", priceCents: 150 },
    });
    // Nothing missing → just the status.
    expect(approvalPatch(scan({ confirmedCondition: "LP", selectedFinish: "foil", priceCents: 375 }), printing(), floors)).toEqual({
      ok: true,
      patch: { reviewStatus: "ready" },
    });
  });

  it("uses the bulk condition only for cards nobody graded", () => {
    expect(approvalPatch(scan(), printing(), floors, "NM")).toMatchObject({ ok: true, patch: { confirmedCondition: "NM" } });
    const graded = approvalPatch(scan({ confirmedCondition: "MP" }), printing(), floors, "NM");
    expect(graded.ok && graded.patch.confirmedCondition).toBeFalsy();
  });

  it("explains what's missing instead of approving", () => {
    expect(approvalPatch(scan(), printing(), floors)).toEqual({ ok: false, reason: expect.stringMatching(/condition/) });
    expect(approvalPatch(scan({ confirmedCondition: "NM" }), printing({ availableFinishes: [] }), floors)).toEqual({ ok: false, reason: expect.stringMatching(/finish/) });
    const noPrice = printing({ prices: { usd: null, usdFoil: null, usdEtched: null }, scryfallPriceCents: null, rarity: "special" });
    expect(approvalPatch(scan({ confirmedCondition: "NM" }), noPrice, floors)).toEqual({ ok: false, reason: expect.stringMatching(/price/) });
  });
});

describe("isSureMatch", () => {
  it("is an auto-matched card nobody has reviewed yet", () => {
    expect(isSureMatch({ recognitionStatus: "recognized", reviewStatus: "matched", selectedScryfallId: "p" })).toBe(true);
    expect(isSureMatch({ recognitionStatus: "low_confidence", reviewStatus: "matched", selectedScryfallId: "p" })).toBe(false);
    expect(isSureMatch({ recognitionStatus: "recognized", reviewStatus: "ready", selectedScryfallId: "p" })).toBe(false);
  });
});
