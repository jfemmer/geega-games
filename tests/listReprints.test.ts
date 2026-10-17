import { describe, expect, it } from "vitest";
import { isListReprintOf, listReprintOriginal, listTieAdvice, preferOriginals } from "../src/admin/utils/listReprints";

// The List copies a printing down to its set symbol; only a small
// planeswalker symbol in the corner differs, so a scan can't tell them apart.

const ORI_153 = { setCode: "ORI", collectorNumber: "153" };
const PLST_ORI_153 = { setCode: "PLST", collectorNumber: "ORI-153" };

describe("isListReprintOf", () => {
  it("pairs The List's copy with the printing its collector number names", () => {
    expect(listReprintOriginal(PLST_ORI_153)).toEqual(ORI_153);
    expect(isListReprintOf(PLST_ORI_153, ORI_153)).toBe(true);
    expect(isListReprintOf({ setCode: "plst", collectorNumber: "ori-153" }, { setCode: "ori", collectorNumber: "153" })).toBe(true);
    expect(isListReprintOf(PLST_ORI_153, { setCode: "ORI", collectorNumber: "152" })).toBe(false);
    expect(isListReprintOf(PLST_ORI_153, { setCode: "DTK", collectorNumber: "153" })).toBe(false);
    expect(isListReprintOf(ORI_153, PLST_ORI_153)).toBe(false);
    expect(listReprintOriginal({ setCode: "SLD", collectorNumber: "1001" })).toBeNull();
  });
});

describe("preferOriginals", () => {
  const c = (setCode: string, collectorNumber: string, confidence: number) => ({ setCode, collectorNumber, confidence });

  it("puts the original ahead of its List copy, at the same confidence, so neither clears a margin", () => {
    const { ranked, ties } = preferOriginals(
      [c("PLST", "ORI-153", 0.94), c("ORI", "153", 0.79), c("J25", "594", 0.68)],
      (x) => x,
    );
    expect(ranked.map((x) => `${x.setCode} ${x.confidence}`)).toEqual(["ORI 0.94", "PLST 0.94", "J25 0.68"]);
    expect(ties).toHaveLength(1);
    expect(ties[0].original.setCode).toBe("ORI");
  });

  it("leaves a List copy that already ranks below its original alone", () => {
    const input = [c("ORI", "153", 0.99), c("PLST", "ORI-153", 0.84), c("PLST", "DTK-153", 0.7)];
    const { ranked, ties } = preferOriginals(input, (x) => x);
    expect(ranked).toEqual(input);
    expect(ties).toEqual([]);
  });

  it("says what to look for", () => {
    expect(listTieAdvice(ORI_153, PLST_ORI_153)).toMatch(/planeswalker symbol in the bottom-left corner; without one, it's ORI #153/);
  });
});
