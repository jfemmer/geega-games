import { describe, expect, it } from "vitest";
import { parseScanMode } from "./config.js";

describe("parseScanMode", () => {
  it("accepts each valid mode", () => {
    expect(parseScanMode("card_matching")).toBe("card_matching");
    expect(parseScanMode("condition")).toBe("condition");
    expect(parseScanMode("both")).toBe("both");
  });

  it("rejects an unrecognized value rather than silently defaulting", () => {
    expect(() => parseScanMode("everything")).toThrow(/Invalid SCAN_MODE/);
  });
});
