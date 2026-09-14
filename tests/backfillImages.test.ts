import { describe, expect, it } from "vitest";
import {
  BACKFILL_CANDIDATE_OR_FILTER,
  hasRealImage,
  isLowResScryfallImage,
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

  it("flags a row whose Scryfall image is low-resolution (small/normal)", () => {
    // A stored /normal/ or /small/ Scryfall URL is upgradable to /large/, so it
    // is a repair candidate even though it's a valid http image.
    expect(
      needsImageRepair({
        scryfall_id: "abc",
        image_url: "https://cards.scryfall.io/normal/front/a/b/u.jpg",
      }),
    ).toBe(true);
    expect(
      needsImageRepair({
        scryfall_id: "abc",
        image_url: "https://cards.scryfall.io/small/front/a/b/u.jpg",
      }),
    ).toBe(true);
  });

  it("does NOT flag a row that already has a scryfall_id AND a high-quality image", () => {
    expect(
      needsImageRepair({
        scryfall_id: "abc",
        image_url: "https://cards.scryfall.io/large/front/a/b/u.jpg",
      }),
    ).toBe(false);
    // Non-Scryfall http image with an id is left alone (not our CDN to upgrade).
    expect(
      needsImageRepair({
        scryfall_id: "abc",
        image_url: "https://example.com/card.jpg",
      }),
    ).toBe(false);
  });
});

describe("isLowResScryfallImage", () => {
  it("detects small/normal Scryfall CDN URLs as low-res", () => {
    expect(
      isLowResScryfallImage("https://cards.scryfall.io/small/front/a/b/u.jpg"),
    ).toBe(true);
    expect(
      isLowResScryfallImage("https://cards.scryfall.io/normal/front/a/b/u.jpg"),
    ).toBe(true);
  });

  it("does not flag large/png Scryfall URLs or non-Scryfall URLs", () => {
    expect(
      isLowResScryfallImage("https://cards.scryfall.io/large/front/a/b/u.jpg"),
    ).toBe(false);
    expect(
      isLowResScryfallImage("https://cards.scryfall.io/png/front/a/b/u.png"),
    ).toBe(false);
    expect(isLowResScryfallImage("https://example.com/normal/x.jpg")).toBe(false);
    expect(isLowResScryfallImage(null)).toBe(false);
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