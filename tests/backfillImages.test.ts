import { describe, expect, it } from "vitest";
import {
  BACKFILL_CANDIDATE_OR_FILTER,
  hasRealImage,
  needsImageRepair,
} from "../api/admin/inventory/backfill-images";

// Unit tests for the backfill candidate-detection rule. The key fix is that a
// row with a NON-NULL placeholder/data-URI/malformed image_url must be
// discoverable — the old query only looked for NULLs and silently skipped these.

describe("hasRealImage", () => {
  it("accepts http(s) URLs", () => {
    expect(hasRealImage("https://cards.scryfall.io/normal/x.jpg")).toBe(true);
    expect(hasRealImage("http://example.com/a.png")).toBe(true);
  });
  it("rejects null, empty, data-URIs, blobs, and relative paths", () => {
    expect(hasRealImage(null)).toBe(false);
    expect(hasRealImage("")).toBe(false);
    expect(hasRealImage("data:image/png;base64,AAAA")).toBe(false);
    expect(hasRealImage("blob:https://app/uuid")).toBe(false);
    expect(hasRealImage("/assets/placeholder.png")).toBe(false);
    expect(hasRealImage("placeholder")).toBe(false);
  });
});

describe("needsImageRepair", () => {
  it("flags a row missing a scryfall_id", () => {
    expect(
      needsImageRepair({
        scryfall_id: null,
        image_url: "https://cards.scryfall.io/normal/x.jpg",
      }),
    ).toBe(true);
  });

  it("flags a row with a null image_url", () => {
    expect(needsImageRepair({ scryfall_id: "abc", image_url: null })).toBe(true);
  });

  it("flags a row with a NON-NULL placeholder image (the previously-missed case)", () => {
    expect(
      needsImageRepair({
        scryfall_id: "abc",
        image_url: "data:image/svg+xml;base64,PHN2Zy8+",
      }),
    ).toBe(true);
    expect(
      needsImageRepair({ scryfall_id: "abc", image_url: "/img/placeholder.png" }),
    ).toBe(true);
  });

  it("does NOT flag a row that already has a scryfall_id AND a real image", () => {
    expect(
      needsImageRepair({
        scryfall_id: "abc",
        image_url: "https://cards.scryfall.io/normal/x.jpg",
      }),
    ).toBe(false);
  });
});

describe("BACKFILL_CANDIDATE_OR_FILTER", () => {
  it("includes the placeholder-catching NOT ILIKE http clause", () => {
    // Without this clause, non-null placeholder image_url rows are excluded at
    // the DB level before the JS guard can inspect them.
    expect(BACKFILL_CANDIDATE_OR_FILTER).toContain("image_url.not.ilike.http%");
    expect(BACKFILL_CANDIDATE_OR_FILTER).toContain("scryfall_id.is.null");
    expect(BACKFILL_CANDIDATE_OR_FILTER).toContain("image_url.is.null");
  });
});