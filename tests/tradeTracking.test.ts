import { describe, expect, it } from "vitest";
import {
  checkTrackingNumber,
  deliveredScanAt,
  detectCarrier,
  firstAcceptanceAt,
  isAcceptanceScan,
  lastScanAt,
  normalizeTracking,
  readScans,
  scanStatusLabel,
  type TrackingScan,
} from "../src/store/lib/tradeTracking";
import { scansFromTracker } from "../api/_lib/tradeTracking";

// Tracking numbers and carrier scans for a customer's trade package. Only
// the carrier's first acceptance scan counts as shipped: a label, or a
// tracking number typed in, doesn't.

const USPS = "9400111899223197428490";
const UPS = "1Z999AA10123456784";
const scan = (over: Partial<TrackingScan>): TrackingScan => ({ status: "in_transit", detail: null, message: null, at: "2026-10-26T15:00:00.000Z", location: null, ...over });

describe("tracking numbers", () => {
  it("are compared without spaces, dashes or case, and without USPS's 420 + ZIP routing prefix", () => {
    expect(normalizeTracking(" 9400 1118-9922 3197 4284 90 ")).toBe(USPS);
    expect(normalizeTracking("1z999aa10123456784")).toBe(UPS);
    expect(normalizeTracking(`42063011${USPS}`)).toBe(USPS);
    expect(normalizeTracking(`420630111234${USPS}`)).toBe(USPS);
  });

  it("belong to a carrier when the format says so clearly", () => {
    expect(detectCarrier(USPS)).toBe("USPS");
    expect(detectCarrier("EA123456789US")).toBe("USPS");
    expect(detectCarrier(UPS)).toBe("UPS");
    expect(detectCarrier("123456789012")).toBe("FedEx");
    expect(detectCarrier("123456789012345")).toBe("FedEx");
    // 20 digits starting 92 could be USPS or FedEx: not clear.
    expect(detectCarrier("92001901234567890123")).toBeNull();
    expect(detectCarrier("hello")).toBeNull();
  });

  it("are checked against the carrier chosen", () => {
    expect(checkTrackingNumber("USPS", USPS)).toEqual({ ok: true, tracking: USPS, carrier: "USPS", detected: "USPS" });
    expect(checkTrackingNumber("UPS", UPS)).toMatchObject({ ok: true, carrier: "UPS" });
    expect(checkTrackingNumber("USPS", UPS)).toEqual({
      ok: false,
      message: "That looks like a UPS tracking number. Choose UPS, or check the number.",
      suggestion: "UPS",
    });
    expect(checkTrackingNumber("FedEx", "1234567")).toMatchObject({ ok: false, message: "That tracking number doesn't look right. Check it and try again." });
    expect(checkTrackingNumber("FedEx", "ABCDEFGHIJ")).toMatchObject({ ok: false, message: "That doesn't look like a FedEx tracking number. Check it and try again." });
    expect(checkTrackingNumber("DHL", USPS)).toMatchObject({ ok: false, message: "Choose the carrier." });
  });

  it("take any 8 to 40 letters and digits for another carrier (staff verify those by hand)", () => {
    expect(checkTrackingNumber("Other", "localcourier-123")).toEqual({ ok: true, tracking: "LOCALCOURIER123", carrier: "Other", detected: null });
    expect(checkTrackingNumber("Other", "abc").ok).toBe(false);
    expect(checkTrackingNumber("Other", "x".repeat(41)).ok).toBe(false);
  });
});

describe("carrier scans", () => {
  it("a label being made, or the carrier being told about the package, isn't a scan", () => {
    expect(isAcceptanceScan(scan({ status: "pre_transit", message: "Shipping Label Created" }))).toBe(false);
    expect(isAcceptanceScan(scan({ status: "in_transit", detail: "label_created" }))).toBe(false);
    expect(isAcceptanceScan(scan({ status: "in_transit", message: "Shipping Label Created, USPS Awaiting Item" }))).toBe(false);
    expect(isAcceptanceScan(scan({ status: "in_transit", message: "Shipment information sent to FedEx" }))).toBe(false);
    expect(isAcceptanceScan(scan({ status: "in_transit", message: "Order Processed: Ready for UPS" }))).toBe(false);
    expect(isAcceptanceScan(scan({ status: "unknown" }))).toBe(false);
  });

  it("the carrier picking it up, or any later movement, is", () => {
    expect(isAcceptanceScan(scan({ message: "USPS picked up item" }))).toBe(true);
    expect(isAcceptanceScan(scan({ message: "Origin Scan" }))).toBe(true);
    expect(isAcceptanceScan(scan({ status: "out_for_delivery" }))).toBe(true);
    expect(isAcceptanceScan(scan({ status: "delivered" }))).toBe(true);
    // Not without a time to compare with the deadline.
    expect(isAcceptanceScan(scan({ at: null }))).toBe(false);
    expect(isAcceptanceScan(scan({ at: "soon" }))).toBe(false);
  });

  it("finds the first acceptance, the delivery and the latest scan, whatever order they come in", () => {
    const scans = [
      scan({ message: "Arrived at USPS Regional Facility", at: "2026-10-27T10:00:00Z" }),
      scan({ status: "pre_transit", message: "Shipping Label Created", at: "2026-10-25T10:00:00Z" }),
      scan({ status: "delivered", message: "Delivered", at: "2026-10-28T16:00:00Z" }),
      scan({ message: "USPS picked up item", at: "2026-10-26T20:00:00Z" }),
    ];
    expect(firstAcceptanceAt(scans)).toBe("2026-10-26T20:00:00.000Z");
    expect(deliveredScanAt(scans)).toBe("2026-10-28T16:00:00.000Z");
    expect(lastScanAt(scans)).toBe("2026-10-28T16:00:00.000Z");
    expect(firstAcceptanceAt([scans[1]])).toBeNull();
    expect(deliveredScanAt([scans[0]])).toBeNull();
  });

  it("reads stored scans, skipping anything odd", () => {
    expect(readScans(null)).toEqual([]);
    expect(readScans([null, 4, { message: "no status" }, { status: " in_transit ", at: "2026-10-26T20:00:00Z", location: "" }])).toEqual([
      { status: "in_transit", detail: null, message: null, at: "2026-10-26T20:00:00Z", location: null },
    ]);
  });

  it("says what a status means in plain words", () => {
    expect(scanStatusLabel("pre_transit")).toBe("Label created: not scanned yet");
    expect(scanStatusLabel("in_transit")).toBe("In transit");
    expect(scanStatusLabel(null)).toBe("No carrier scans yet");
  });
});

describe("EasyPost's tracking details as scans", () => {
  it("oldest first, with the place, a scan without a time first of all", () => {
    const scans = scansFromTracker({
      id: "trk_1",
      status: "in_transit",
      tracking_details: [
        { status: "in_transit", datetime: "2026-10-27T10:00:00Z", message: "Arrived", tracking_location: { city: "ST LOUIS", state: "MO" } },
        { status: "pre_transit", datetime: null, message: "Label" },
        { status: "in_transit", datetime: "2026-10-26T20:00:00Z", message: "Picked up", status_detail: "arrived_at_facility" },
        { datetime: "2026-10-26T21:00:00Z", message: "No status: skipped" },
      ] as never,
    });
    expect(scans.map((s) => [s.status, s.at, s.location])).toEqual([
      ["pre_transit", null, null],
      ["in_transit", "2026-10-26T20:00:00.000Z", null],
      ["in_transit", "2026-10-27T10:00:00.000Z", "ST LOUIS, MO"],
    ]);
    expect(scans[1].detail).toBe("arrived_at_facility");
  });

  it("keeps the latest 100, and messages to 300 characters", () => {
    const details = Array.from({ length: 120 }, (_, i) => ({
      status: "in_transit",
      datetime: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
      message: i === 119 ? "x".repeat(400) : `Scan ${i}`,
    }));
    const scans = scansFromTracker({ id: "trk_2", status: "in_transit", tracking_details: details } as never);
    expect(scans).toHaveLength(100);
    expect(scans[0].message).toBe("Scan 20");
    expect(scans[99].message).toHaveLength(300);
  });
});
