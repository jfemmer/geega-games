import { describe, expect, it } from "vitest";
import {
  cardPhotoRequirementMet,
  conditionDefaultExplanation,
  ageConditionTiers,
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

// Pin "now" so the rolling Near Mint cutoff is deterministic: in 2026,
// 2024 and newer start at Near Mint.
const NOW = new Date("2026-09-26T12:00:00Z");

describe("defaultConditionForReleaseDate", () => {
  it("defaults cards from 2005 or earlier to Heavily Played", () => {
    expect(defaultConditionForReleaseDate("2005-10-01")).toBe("HP");
    expect(defaultConditionForReleaseDate("1994-08-05")).toBe("HP");
  });

  it("defaults cards from 2006-2015 to Moderately Played", () => {
    expect(defaultConditionForReleaseDate("2006-01-01")).toBe("MP");
    expect(defaultConditionForReleaseDate("2015-12-31")).toBe("MP");
  });

  it("defaults cards from 2016 up to three years ago to Lightly Played", () => {
    expect(defaultConditionForReleaseDate("2016-01-01", NOW)).toBe("LP");
    expect(defaultConditionForReleaseDate("2023-12-31", NOW)).toBe("LP");
  });

  it("defaults brand-new cards (the last ~2 years) to Near Mint", () => {
    expect(defaultConditionForReleaseDate("2024-01-01", NOW)).toBe("NM");
    expect(defaultConditionForReleaseDate("2026-09-01", NOW)).toBe("NM");
  });

  it("rolls the Near Mint cutoff forward each year", () => {
    const next = new Date("2027-03-01T12:00:00Z");
    expect(defaultConditionForReleaseDate("2024-06-14", next)).toBe("LP");
    expect(defaultConditionForReleaseDate("2025-06-14", next)).toBe("NM");
  });

  it("defaults an unknown release date to Lightly Played", () => {
    expect(defaultConditionForReleaseDate(null)).toBe("LP");
  });
});

describe("conditionDefaultExplanation", () => {
  it("explains the Heavily, Moderately and Lightly Played defaults", () => {
    expect(conditionDefaultExplanation("HP", NOW)).toMatch(/2005 or earlier/);
    expect(conditionDefaultExplanation("MP", NOW)).toMatch(/2006–2015/);
    expect(conditionDefaultExplanation("LP", NOW)).toMatch(/2016–2023/);
  });

  it("tells sellers the offer can go up or down after inspection", () => {
    for (const c of ["HP", "MP", "LP"] as const) {
      expect(conditionDefaultExplanation(c, NOW)).toMatch(/up or down/);
    }
  });

  it("has no explanation for the Near Mint default", () => {
    expect(conditionDefaultExplanation("NM", NOW)).toBeNull();
  });
});

describe("ageConditionTiers", () => {
  it("lists all four tiers oldest first, with matching year ranges", () => {
    expect(ageConditionTiers(NOW)).toEqual([
      { condition: "HP", years: "2005 or earlier" },
      { condition: "MP", years: "2006–2015" },
      { condition: "LP", years: "2016–2023" },
      { condition: "NM", years: "2024 and newer" },
    ]);
  });
});

describe("conditionNeedsPhotos", () => {
  it("requires photos for Near Mint on any card that doesn't start at Near Mint", () => {
    expect(conditionNeedsPhotos("NM", "HP")).toBe(true);
    expect(conditionNeedsPhotos("NM", "LP")).toBe(true);
  });

  it("does not require photos for Near Mint on brand-new cards (NM is the default)", () => {
    expect(conditionNeedsPhotos("NM", "NM")).toBe(false);
    expect(conditionNeedsPhotos("LP", "NM")).toBe(false);
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
