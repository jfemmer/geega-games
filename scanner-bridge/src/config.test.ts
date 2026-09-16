import { describe, expect, it } from "vitest";
import { duplexForMode, parseScanMode } from "./config.js";

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

describe("duplexForMode", () => {
  it("card_matching needs only a front scan — no duplex pairing", () => {
    expect(duplexForMode("card_matching")).toBe(false);
  });

  it("condition and both need front+back — duplex pairing", () => {
    expect(duplexForMode("condition")).toBe(true);
    expect(duplexForMode("both")).toBe(true);
  });
});
