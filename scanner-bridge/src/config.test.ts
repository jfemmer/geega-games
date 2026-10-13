import { describe, expect, it } from "vitest";
import {
  defaultDpiForMode,
  duplexForMode,
  parseRecognizerSwitch,
  parseScanDpi,
  parseScanMode,
  parseScannerDriver,
} from "./config.js";

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

describe("parseScannerDriver", () => {
  it("accepts each driver NAPS2 supports", () => {
    expect(parseScannerDriver("twain")).toBe("twain");
    expect(parseScannerDriver("wia")).toBe("wia");
    expect(parseScannerDriver("escl")).toBe("escl");
    expect(parseScannerDriver("sane")).toBe("sane");
    expect(parseScannerDriver("apple")).toBe("apple");
  });

  it("rejects an unrecognized value rather than silently defaulting", () => {
    expect(() => parseScannerDriver("magic")).toThrow(/Invalid SCANNER_DRIVER/);
  });
});

describe("scan resolution", () => {
  it("defaults to 300 dpi (the fi-8170's full speed), 600 for condition-only sessions", () => {
    expect(defaultDpiForMode("both")).toBe(300);
    expect(defaultDpiForMode("card_matching")).toBe(300);
    expect(defaultDpiForMode("condition")).toBe(600);
    expect(parseScanDpi(undefined, "both")).toBe(300);
    expect(parseScanDpi("", "condition")).toBe(600);
  });

  it("accepts the resolutions the scanner offers and rejects anything else", () => {
    expect(parseScanDpi("600", "both")).toBe(600);
    expect(parseScanDpi("400", "both")).toBe(400);
    expect(() => parseScanDpi("1200", "both")).toThrow(/Invalid SCAN_DPI/);
    expect(() => parseScanDpi("high", "both")).toThrow(/Invalid SCAN_DPI/);
  });
});

describe("parseRecognizerSwitch", () => {
  it("is on unless turned off", () => {
    expect(parseRecognizerSwitch(undefined)).toBe(true);
    expect(parseRecognizerSwitch("on")).toBe(true);
    expect(parseRecognizerSwitch("OFF")).toBe(false);
    expect(() => parseRecognizerSwitch("sometimes")).toThrow(/Invalid RECOGNIZER/);
  });
});
