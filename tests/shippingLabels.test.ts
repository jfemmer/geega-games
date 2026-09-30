// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PWE_LABEL_FORMAT,
  hasPrintableAddress,
  isImageLabel,
  isTrackingProblem,
  loadPweLabelFormat,
  recipientLines,
  savePweLabelFormat,
  trackingStatusLabel,
} from "../src/admin/utils/shippingLabels";
import { shipFromLines } from "../src/store/lib/shipFrom";

const address = {
  shipRecipient: "  Jordan   Vega ",
  customerName: "Jordan Vega",
  shipLine1: "123 Main St",
  shipLine2: null,
  shipCity: "Ballwin",
  shipState: "MO",
  shipPostalCode: "63011",
  shipCountry: "US",
};

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("label address lines", () => {
  it("prints name, street and city line for a US address", () => {
    expect(recipientLines(address)).toEqual(["Jordan Vega", "123 Main St", "Ballwin, MO 63011"]);
  });

  it("adds the country, in capitals, only for mail leaving the US", () => {
    expect(recipientLines({ ...address, shipCountry: "Canada", shipState: "ON", shipPostalCode: "K1A 0B1" }).at(-1)).toBe(
      "CANADA",
    );
    expect(recipientLines({ ...address, shipCountry: "United States" })).toHaveLength(3);
  });

  it("falls back to the customer's name and keeps a unit line", () => {
    expect(recipientLines({ ...address, shipRecipient: "", shipLine2: "Apt 4" })).toEqual([
      "Jordan Vega",
      "123 Main St",
      "Apt 4",
      "Ballwin, MO 63011",
    ]);
  });

  it("knows when there's no address to print", () => {
    expect(hasPrintableAddress(address)).toBe(true);
    expect(hasPrintableAddress({ ...address, shipLine1: " " })).toBe(false);
    expect(hasPrintableAddress({ ...address, shipPostalCode: "" })).toBe(false);
  });

  it("uses the store's return address", () => {
    expect(shipFromLines()).toEqual(["Geega Games", "390 Newbury Dr.", "Ballwin, MO 63011"]);
  });
});

describe("label files", () => {
  it("prints image labels from the page, and treats PDFs as files to open", () => {
    expect(isImageLabel("https://easypost-files.s3.amazonaws.com/files/postage_label/abc.png")).toBe(true);
    expect(isImageLabel("https://example.com/label.PNG?X-Amz=1")).toBe(true);
    expect(isImageLabel("https://example.com/label.pdf")).toBe(false);
    expect(isImageLabel(null)).toBe(false);
    expect(isImageLabel("not a url")).toBe(false);
  });
});

describe("envelope format preference", () => {
  it("remembers the choice on this device", () => {
    expect(loadPweLabelFormat()).toBe(DEFAULT_PWE_LABEL_FORMAT);
    savePweLabelFormat("envelope-10");
    expect(loadPweLabelFormat()).toBe("envelope-10");
  });

  it("ignores junk and blocked storage", () => {
    window.localStorage.setItem("gg-admin:pwe-label-format", "poster");
    expect(loadPweLabelFormat()).toBe(DEFAULT_PWE_LABEL_FORMAT);

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => savePweLabelFormat("envelope-10")).not.toThrow();
    expect(loadPweLabelFormat()).toBe(DEFAULT_PWE_LABEL_FORMAT);
  });
});

describe("tracking status", () => {
  it("puts the carrier's status in words and flags the ones to act on", () => {
    expect(trackingStatusLabel("in_transit")).toBe("In transit");
    expect(trackingStatusLabel("out_for_delivery")).toBe("Out for delivery");
    expect(trackingStatusLabel(null)).toBeNull();
    expect(trackingStatusLabel("unknown")).toBe("Tracking not available yet");
    expect(isTrackingProblem("return_to_sender")).toBe(true);
    expect(isTrackingProblem("error")).toBe(true);
    expect(isTrackingProblem("in_transit")).toBe(false);
  });
});
