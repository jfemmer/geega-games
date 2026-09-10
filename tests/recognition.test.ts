import { describe, expect, it } from "vitest";
import {
  stubRecognitionProvider,
  emptyRecognition,
} from "../src/admin/repositories/recognition.stub";
import type { CardScan } from "../src/admin/types";

function fakeScan(): CardScan {
  return {
    id: "scan_1",
    scanSessionId: "ses_1",
    sequenceNumber: 1,
    frontImagePath: "scans/x/1f.jpg",
    backImagePath: null,
    frontImageUrl: null,
    backImageUrl: null,
    selectedScryfallId: null,
    selectedPrinting: null,
    recognitionStatus: "none",
    recognitionConfidence: null,
    recognitionData: null,
    suggestedCondition: null,
    suggestedConditionConfidence: null,
    confirmedCondition: null,
    selectedFinish: null,
    quantity: 1,
    priceCents: null,
    costCents: null,
    storageLocation: null,
    notes: null,
    reviewStatus: "unreviewed",
    reviewedBy: null,
    reviewedAt: null,
    inventoryItemId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("stub recognition provider", () => {
  it("declares itself unimplemented", () => {
    expect(stubRecognitionProvider.name).toBe("stub");
    expect(stubRecognitionProvider.implemented).toBe(false);
  });

  it("returns an empty, low-confidence result without fabricating a match", async () => {
    const result = await stubRecognitionProvider.recognize(fakeScan());
    expect(result.confidence).toBe(0);
    expect(result.candidatePrintings).toHaveLength(0);
    expect(result.detectedName).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("queueRecognition is a safe no-op", async () => {
    await expect(
      stubRecognitionProvider.queueRecognition("scan_1"),
    ).resolves.toBeUndefined();
  });

  it("emptyRecognition is reusable", () => {
    const r = emptyRecognition();
    expect(r.candidatePrintings).toEqual([]);
    expect(r.fieldConfidence).toEqual({});
  });
});
