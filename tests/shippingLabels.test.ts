import { describe, expect, it } from "vitest";
import {
  ADDRESS_BLOCK,
  DEFAULT_PWE_LABEL_FORMAT,
  PAGE_SIZE_IN,
  PWE_LABEL_FORMATS,
  addressFontSizePt,
  hasPrintableAddress,
  isImageLabel,
  isTrackingProblem,
  recipientLines,
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

describe("address type size", () => {
  const usual = ["Jordan Vega", "123 Main St", "Ballwin, MO 63011"];
  const longish = ["Jordan Vega", "1234 Longwood Terrace Dr Apt 1204", "Saint Charles, MO 63303-1234"];
  // 40 characters, the most USPS expects on an address line.
  const long = ["Jordan Vega", "12345 North Lindbergh Boulevard Apt 1204", "Saint Charles, MO 63303-1234"];

  it("prints a usual address at full size", () => {
    expect(addressFontSizePt(usual, "envelope-6-3-4")).toBe(16);
    expect(addressFontSizePt(usual, "envelope-10")).toBe(16);
  });

  it("shrinks so the longest line still fits on one line", () => {
    expect(addressFontSizePt(longish, "envelope-6-3-4")).toBe(14);
    expect(addressFontSizePt(longish, "envelope-10")).toBe(10.5);
    expect(addressFontSizePt(long, "envelope-6-3-4")).toBe(11.5);
  });

  it("never goes below the 10 pt USPS recommends", () => {
    expect(addressFontSizePt(long, "envelope-10")).toBe(10);
    expect(addressFontSizePt(["X".repeat(90)], "envelope-6-3-4")).toBe(10);
  });
});

describe("envelope choices", () => {
  it("offers the two envelopes, the usual 3⅝ × 6½ first and by default", () => {
    expect(PWE_LABEL_FORMATS.map((f) => f.label)).toEqual(["3⅝ × 6½", "4⅛ × 9½ (#10)"]);
    expect(DEFAULT_PWE_LABEL_FORMAT).toBe("envelope-6-3-4");
  });

  it("always prints a standard 4×6 label", () => {
    expect(PAGE_SIZE_IN["pwe-4x6"]).toEqual({ width: 4, height: 6 });
    expect(PAGE_SIZE_IN["postage-4x6"]).toEqual({ width: 4, height: 6 });
  });

  it("moves the address farther right for the #10 envelope, still on the label", () => {
    const small = ADDRESS_BLOCK["envelope-6-3-4"];
    const large = ADDRESS_BLOCK["envelope-10"];
    expect(large.leftIn).toBeGreaterThanOrEqual(small.leftIn + 1);
    expect(large.topIn).toBe(small.topIn);
    // The label reads 6 in wide: keep the address off its edge.
    for (const block of [small, large]) expect(block.leftIn + block.widthIn).toBeLessThanOrEqual(5.8);
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
