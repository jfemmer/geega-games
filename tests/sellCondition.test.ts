import { describe, expect, it } from "vitest";
import {
  cardPhotoRequirementMet,
  conditionDefaultExplanation,
  conditionNeedsPhotos,
  defaultConditionForReleaseDate,
  type SellPhoto,
} from "../src/store/lib/sellTypes";

function photo(overrides: Partial<SellPhoto>): SellPhoto {
  return {
    localId: overrides.localId ?? Math.random().toString(36),
    file: new File(["x"], "x.jpg", { type: "image/jpeg" }),
    previewUrl: "blob:test",
    status: "uploaded",
    originalFilename: "x.jpg",
    cardLocalId: null,
    side: null,
    ...overrides,
  };
}

describe("defaultConditionForReleaseDate", () => {
  it("defaults cards from 2005 or earlier to Heavily Played", () => {
    expect(defaultConditionForReleaseDate("2005-10-01")).toBe("HP");
    expect(defaultConditionForReleaseDate("1994-08-05")).toBe("HP");
  });

  it("defaults cards from 2006-2015 to Moderately Played", () => {
    expect(defaultConditionForReleaseDate("2006-01-01")).toBe("MP");
    expect(defaultConditionForReleaseDate("2015-12-31")).toBe("MP");
  });

  it("defaults everything from 2016 onward to Lightly Played", () => {
    expect(defaultConditionForReleaseDate("2016-01-01")).toBe("LP");
    expect(defaultConditionForReleaseDate("2024-06-14")).toBe("LP");
  });

  it("defaults an unknown release date to Lightly Played", () => {
    expect(defaultConditionForReleaseDate(null)).toBe("LP");
  });
});

describe("conditionDefaultExplanation", () => {
  it("explains the Heavily Played and Moderately Played defaults", () => {
    expect(conditionDefaultExplanation("HP")).toMatch(/2005 or earlier/);
    expect(conditionDefaultExplanation("MP")).toMatch(/2006–2015/);
  });

  it("has no explanation for the Lightly Played default", () => {
    expect(conditionDefaultExplanation("LP")).toBeNull();
  });
});

describe("conditionNeedsPhotos", () => {
  it("always requires photos for Near Mint, regardless of the default", () => {
    expect(conditionNeedsPhotos("NM", "HP")).toBe(true);
    expect(conditionNeedsPhotos("NM", "LP")).toBe(true);
  });

  it("requires photos when the claimed condition is better than the default", () => {
    expect(conditionNeedsPhotos("LP", "HP")).toBe(true);
    expect(conditionNeedsPhotos("MP", "HP")).toBe(true);
  });

  it("does not require photos when matching or worse than the default", () => {
    expect(conditionNeedsPhotos("HP", "HP")).toBe(false);
    expect(conditionNeedsPhotos("DMG", "HP")).toBe(false);
    expect(conditionNeedsPhotos("MP", "LP")).toBe(false);
  });

  it("never requires photos for an unset/'Unsure' condition", () => {
    expect(conditionNeedsPhotos(null, "HP")).toBe(false);
  });
});

describe("cardPhotoRequirementMet", () => {
  it("is not met with no photos at all", () => {
    expect(cardPhotoRequirementMet([], "card-1")).toBe(false);
  });

  it("is not met with only a front photo", () => {
    const photos = [photo({ cardLocalId: "card-1", side: "front" })];
    expect(cardPhotoRequirementMet(photos, "card-1")).toBe(false);
  });

  it("is not met with only a back photo", () => {
    const photos = [photo({ cardLocalId: "card-1", side: "back" })];
    expect(cardPhotoRequirementMet(photos, "card-1")).toBe(false);
  });

  it("is met once both a front and back photo have finished uploading", () => {
    const photos = [
      photo({ cardLocalId: "card-1", side: "front" }),
      photo({ cardLocalId: "card-1", side: "back" }),
    ];
    expect(cardPhotoRequirementMet(photos, "card-1")).toBe(true);
  });

  it("does not count a photo that is still uploading or failed", () => {
    const photos = [
      photo({ cardLocalId: "card-1", side: "front", status: "uploading" }),
      photo({ cardLocalId: "card-1", side: "back", status: "error" }),
    ];
    expect(cardPhotoRequirementMet(photos, "card-1")).toBe(false);
  });

  it("ignores photos belonging to a different card", () => {
    const photos = [
      photo({ cardLocalId: "card-2", side: "front" }),
      photo({ cardLocalId: "card-2", side: "back" }),
    ];
    expect(cardPhotoRequirementMet(photos, "card-1")).toBe(false);
  });

  it("ignores general collection photos not tied to any card", () => {
    const photos = [photo({ cardLocalId: null, side: null })];
    expect(cardPhotoRequirementMet(photos, "card-1")).toBe(false);
  });
});
