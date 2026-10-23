import { describe, expect, it } from "vitest";
import {
  approvalPatch,
  carriedPrice,
  defaultFinish,
  inQuickApprove,
  isSureMatch,
  listTieOriginal,
  matchDefaults,
  quickProposal,
  suggestedPrice,
} from "../src/admin/utils/scanApproval";
import type { CardPrinting, CardRecognitionResult, CardScan, InventoryPriceFloor, RecognitionCandidate } from "../src/admin/types";

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

describe("carriedPrice", () => {
  it("brings a card's price to its own printing, or to any printing when it had no match yet", () => {
    expect(carriedPrice({ selectedScryfallId: "m10", priceCents: 500 }, "m10")).toBe(500);
    // Typed before there was a match: it goes with whichever printing is approved.
    expect(carriedPrice({ selectedScryfallId: null, priceCents: 500 }, "m11")).toBe(500);
    // Priced for another printing: priced afresh.
    expect(carriedPrice({ selectedScryfallId: "m10", priceCents: 500 }, "m11")).toBeNull();
    expect(carriedPrice({ selectedScryfallId: null, priceCents: null }, "m11")).toBeNull();
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

const candidate = (scryfallId: string, setCode: string, collectorNumber: string, confidence: number, reason?: string): RecognitionCandidate => ({
  scryfallId,
  cardName: "Lightning Javelin",
  setCode,
  collectorNumber,
  confidence,
  reason,
  imageUrl: `https://img/${scryfallId}.jpg`,
});
const ORI = candidate("ori", "ORI", "153", 0.79, "Picture match 87%");
const LIST = candidate("plst", "PLST", "ORI-153", 0.94, "Picture match 87%, look-alikes ruled out");
const J25 = candidate("j25", "J25", "594", 0.68, "Picture match 50%");

function pcResult(decision: "sure" | "check", candidates: RecognitionCandidate[], extra: Partial<CardRecognitionResult> = {}): CardRecognitionResult {
  return {
    ...recognition("nonfoil"),
    candidatePrintings: candidates,
    engine: "scanner_pc",
    decisionReason: "x",
    scannerPc: { version: "1.0.0", decision, orientation: 0, sidesSwapped: false, ocrText: null, timingsMs: {}, library: { builtAt: null, entries: 1, model: "m" } },
    ...extra,
  };
}

type ProposalScan = Parameters<typeof quickProposal>[0];
const reviewScan = (overrides: Partial<CardScan> = {}): ProposalScan => ({
  selectedScryfallId: null,
  selectedPrinting: null,
  recognitionData: null,
  reviewStatus: "needs_manual_match",
  recognitionStatus: "low_confidence",
  ...overrides,
});
const listPrinting = printing({ scryfallId: "plst", id: "plst", cardName: "Lightning Javelin", setCode: "PLST", setName: "The List", collectorNumber: "ORI-153" });

describe("isSureMatch", () => {
  it("is an auto-matched card nobody has reviewed yet", () => {
    expect(isSureMatch({ recognitionStatus: "recognized", reviewStatus: "matched", selectedScryfallId: "p" })).toBe(true);
    expect(isSureMatch({ recognitionStatus: "low_confidence", reviewStatus: "matched", selectedScryfallId: "p" })).toBe(false);
    expect(isSureMatch({ recognitionStatus: "recognized", reviewStatus: "ready", selectedScryfallId: "p" })).toBe(false);
  });

  it("isn't a card matched to The List's copy when the original was suggested too", () => {
    const tie = { recognitionStatus: "recognized" as const, reviewStatus: "matched" as const, selectedScryfallId: "plst", selectedPrinting: listPrinting };
    expect(isSureMatch({ ...tie, recognitionData: pcResult("sure", [LIST, ORI, J25]) })).toBe(false);
    expect(listTieOriginal({ selectedPrinting: listPrinting, recognitionData: pcResult("sure", [LIST, ORI]) })?.scryfallId).toBe("ori");
    // No original among the suggestions: nothing to doubt.
    expect(isSureMatch({ ...tie, recognitionData: pcResult("sure", [LIST, J25]) })).toBe(true);
  });
});

describe("quickProposal", () => {
  it("proposes a match as it is, pre-ticked", () => {
    const p = quickProposal(reviewScan({ selectedScryfallId: "p", selectedPrinting: printing(), reviewStatus: "matched", recognitionStatus: "recognized", recognitionData: pcResult("sure", [candidate("p", "M10", "146", 0.96), J25]) }));
    expect(p).toMatchObject({ kind: "sure", scryfallId: "p", setName: "Magic 2010", preselect: true, note: null });
    expect(p.alternatives.map((c) => c.scryfallId)).toEqual(["j25"]);
  });

  it("proposes the original over The List's copy it was matched to, pre-ticked, with what to look for", () => {
    const p = quickProposal(reviewScan({ selectedScryfallId: "plst", selectedPrinting: listPrinting, reviewStatus: "matched", recognitionStatus: "recognized", recognitionData: pcResult("sure", [LIST, ORI, J25]) }));
    expect(p).toMatchObject({ kind: "listTie", scryfallId: "ori", setCode: "ORI", preselect: true });
    expect(p.note).toMatch(/planeswalker symbol/);
    // The List's copy stays one tap away.
    expect(p.alternatives.map((c) => c.scryfallId)).toEqual(["plst", "j25"]);
  });

  it("puts the original first in suggestions stored the old way, too", () => {
    const p = quickProposal(reviewScan({ recognitionData: pcResult("sure", [LIST, ORI, J25]) }));
    expect(p).toMatchObject({ kind: "listTie", scryfallId: "ori", preselect: true });
  });

  it("pre-ticks the scanner PC's sure pick that the website only asked to confirm", () => {
    const p = quickProposal(reviewScan({ recognitionData: pcResult("sure", [candidate("a", "ORI", "149", 0.94), candidate("b", "DDU", "46", 0.79)]) }));
    expect(p).toMatchObject({ kind: "confirm", scryfallId: "a", preselect: true });
  });

  it("shows a close call's best guess unticked", () => {
    const p = quickProposal(
      reviewScan({ recognitionData: pcResult("check", [candidate("a", "M10", "146", 0.88), candidate("b", "M11", "149", 0.87)], { decisionReason: "Close call: Lightning Bolt (M10 #146) looks the same as M11 #149." }) }),
    );
    expect(p).toMatchObject({ kind: "closeCall", scryfallId: "a", preselect: false });
    expect(p.note).toMatch(/^Close call/);
  });

  it("shows an unsure match unticked, saying why", () => {
    const p = quickProposal(
      reviewScan({ recognitionData: pcResult("check", [candidate("a", "ORI", "152", 0.86)], { warnings: ["The card touches the edge of the scan — part of it may be cut off."] }) }),
    );
    expect(p).toMatchObject({ kind: "check", preselect: false, note: "The card touches the edge of the scan — part of it may be cut off." });
  });

  it("has nothing to propose without suggestions", () => {
    expect(quickProposal(reviewScan({ recognitionData: pcResult("check", []) }))).toMatchObject({ kind: "noMatch", scryfallId: null, preselect: false });
    expect(quickProposal(reviewScan())).toMatchObject({ kind: "noMatch" });
  });
});

describe("inQuickApprove", () => {
  it("lists every card not yet in inventory or rejected", () => {
    expect(inQuickApprove({ reviewStatus: "ready", inventoryItemId: null })).toBe(true);
    expect(inQuickApprove({ reviewStatus: "matched", inventoryItemId: null })).toBe(true);
    expect(inQuickApprove({ reviewStatus: "added", inventoryItemId: "i" })).toBe(false);
    expect(inQuickApprove({ reviewStatus: "rejected", inventoryItemId: null })).toBe(false);
  });
});
