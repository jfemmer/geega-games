import { describe, expect, it } from "vitest";
import {
  centsInput,
  defaultShipByInput,
  finalOfferPreview,
  formatDateInput,
  inspectChanged,
  inspectDraftOf,
  inspectInput,
  parseUnitCents,
  pendingAdjustment,
  quantityOptions,
  reviewChanged,
  reviewDraftOf,
  reviewInput,
  reviewTally,
  shipByBounds,
  storeDateInput,
  tradeMoney,
  unitForCondition,
  updateInspectDraft,
} from "../src/admin/pages/trades/tradeMath";
import { formOf, settingsInputOf } from "../src/admin/pages/trades/tradeSettingsForm";
import { customerEmailNote, eventDetail, eventLabel, waitingOnStaff } from "../src/admin/pages/trades/tradeLabels";
import { copiesToReturn } from "../src/store/lib/tradeCenter";
import { PERCENTS, TRADE_SETTINGS, staffCard, staffTrade } from "./helpers/tradeFixtures";

// The arithmetic and forms behind admin Trades: what staff see before they
// act has to match what the database will work out.

const card = staffCard;
const trade = (over: Parameters<typeof staffTrade>[0] = {}) => staffTrade({ wanted: [], ...over });
const SETTINGS = TRADE_SETTINGS;

describe("dates and money inputs", () => {
  it("gives St. Louis dates for date inputs, and the server's default ship-by date", () => {
    // 11:30 pm in St. Louis on Thursday Oct 22 is already Friday in UTC.
    expect(storeDateInput(Date.parse("2026-10-23T04:30:00Z"))).toBe("2026-10-22");
    // From a Friday, five business days is the next Friday.
    expect(defaultShipByInput({ shipBusinessDays: 5 }, Date.parse("2026-10-23T15:00:00Z"))).toBe("2026-10-30");
    expect(shipByBounds(Date.parse("2026-10-23T15:00:00Z"))).toEqual({ min: "2026-10-23", max: "2026-12-21" });
    expect(formatDateInput("2026-10-30")).toBe("Fri, Oct 30");
  });

  it("reads typed dollars within what a trade allows", () => {
    expect(parseUnitCents("12.5")).toBe(1250);
    expect(parseUnitCents("$1,234.56")).toBe(123456);
    expect(parseUnitCents("abc")).toBeNull();
    expect(parseUnitCents("100001")).toBeNull();
    expect(centsInput(1250)).toBe("12.50");
    expect(centsInput(null)).toBe("");
    expect(quantityOptions(0, 3)).toEqual([0, 1, 2, 3]);
  });
});

describe("what a trade adds up to", () => {
  it("uses the latest value: estimate, then approved, then final", () => {
    // $88.99 of our cards ships free (from $75).
    expect(tradeMoney(trade())).toMatchObject({ valueStage: "estimated", valueCents: 16000, creditCents: 12800, shippingCents: 0, dueCents: 0, excessCents: 3901 });
    expect(tradeMoney(trade({ approvedValueCents: 10000 }))).toMatchObject({ valueStage: "approved", creditCents: 8000, dueCents: 899, excessCents: 0 });
    expect(tradeMoney(trade({ wantedTotalCents: 5000 }))).toMatchObject({ shippingCents: 550, excessCents: 7250 });
    // Once settled, the trade's own numbers.
    const settled = trade({ finalValueCents: 15000, finalCreditCents: 12000, shippingCents: 0, amountDueCents: 0, excessCents: 3101, excessHandling: "cash", cashPayoutCents: 2326 });
    expect(tradeMoney(settled)).toMatchObject({ valueStage: "final", creditCents: 12000, shippingCents: 0, excessCents: 3101, cashCents: 2326 });
  });

  it("takes the processing fee off the credit", () => {
    expect(tradeMoney(trade({ processingFeeCents: 300 })).creditCents).toBe(12500);
  });
});

describe("review", () => {
  it("starts from the estimate and only counts real changes", () => {
    const c = card();
    const draft = reviewDraftOf(c);
    expect(draft).toEqual({ decision: "pending", quantity: 2, unit: "80.00", reviewNote: "", internalNote: "" });
    expect(reviewChanged(c, draft)).toBe(false);
    expect(reviewChanged(c, { ...draft, unit: "80" })).toBe(false); // the same amount, typed differently
    expect(reviewChanged(c, { ...draft, decision: "approved" })).toBe(true);
    const saved = card({ reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 7000 });
    expect(reviewDraftOf(saved)).toMatchObject({ decision: "approved", quantity: 1, unit: "70.00" });
  });

  it("sends a decision only when it's complete", () => {
    const c = card();
    expect(reviewInput(c, { ...reviewDraftOf(c), decision: "approved", quantity: 3 })).toEqual({ problem: "Sheoldred, the Apocalypse: approve 1 to 2." });
    expect(reviewInput(c, { ...reviewDraftOf(c), decision: "approved", unit: "" })).toEqual({ problem: "Sheoldred, the Apocalypse: enter a value for each copy." });
    expect(reviewInput(c, { ...reviewDraftOf(c), decision: "approved", quantity: 1, unit: "75", reviewNote: " Nice " })).toEqual({
      id: "c1",
      reviewStatus: "approved",
      approvedQuantity: 1,
      approvedUnitCents: 7500,
      reviewNote: "Nice",
      internalNote: null,
    });
    expect(reviewInput(c, { ...reviewDraftOf(c), decision: "rejected" })).toMatchObject({ reviewStatus: "rejected", approvedQuantity: null, approvedUnitCents: null });
  });

  it("tallies decisions and the approved value as the drafts stand", () => {
    const a = card({ id: "a" });
    const b = card({ id: "b", estimatedUnitCents: null, referencePriceCents: null });
    const tally = reviewTally([a, b], { a: { ...reviewDraftOf(a), decision: "approved", quantity: 1 } });
    expect(tally).toEqual({ approved: 1, rejected: 0, pending: 1, approvedValueCents: 8000 });
  });
});

describe("inspection", () => {
  const approved = card({ reviewStatus: "approved", approvedQuantity: 2, approvedUnitCents: 7600 });

  it("starts as approved for a card not inspected yet, or from what was saved", () => {
    expect(inspectDraftOf(approved)).toEqual({ received: 2, authenticity: "authentic", condition: "NM", accept: 2, unit: "76.00", flags: [], note: "", internalNote: "" });
    const saved = card({ ...approved, inspected: true, receivedQuantity: 1, authenticity: "unsure", verifiedCondition: "LP", finalQuantity: 1, finalUnitCents: 6840, flags: ["damaged", "weird"] });
    expect(inspectDraftOf(saved)).toMatchObject({ received: 1, authenticity: "unsure", condition: "LP", accept: 1, unit: "68.40", flags: ["damaged"] });
  });

  it("rescales the value for a different condition by the trade's percentages", () => {
    expect(unitForCondition(approved, "LP", PERCENTS)).toBe(6840); // 7600 × 90 / 100
    const lp = card({ reportedCondition: "LP", approvedUnitCents: 4680 });
    expect(unitForCondition(lp, "MP", PERCENTS)).toBe(3900); // 4680 × 75 / 90
    expect(unitForCondition(card({ approvedUnitCents: null }), "HP", PERCENTS)).toBe(4800); // reference 8000 × 60%
  });

  it("keeps the draft consistent: never takes more than arrived, nor a counterfeit", () => {
    let d = inspectDraftOf(approved);
    d = updateInspectDraft(approved, d, { condition: "MP" }, PERCENTS);
    expect(d.unit).toBe("57.00");
    d = updateInspectDraft(approved, d, { received: 1 }, PERCENTS);
    expect(d.accept).toBe(1);
    d = updateInspectDraft(approved, d, { authenticity: "counterfeit" }, PERCENTS);
    expect(d).toMatchObject({ accept: 0, flags: ["counterfeit"] });
    expect(inspectChanged(approved, d)).toBe(true);
    expect(inspectInput(approved, d)).toMatchObject({ finalQuantity: 0, authenticity: "counterfeit", verifiedCondition: "MP", flags: ["counterfeit"] });
  });

  it("asks for a value for copies being taken", () => {
    const d = { ...inspectDraftOf(approved), unit: "" };
    expect(inspectInput(approved, d)).toEqual({ problem: "Sheoldred, the Apocalypse: enter a value for each copy you're accepting." });
    expect(inspectInput(approved, { ...d, accept: 0 })).toMatchObject({ finalQuantity: 0, finalUnitCents: 0 });
  });

  it("previews the final offer from what's saved, with the cash option at the cash rate", () => {
    const t = trade({
      status: "under_inspection",
      wantedTotalCents: 5000,
      offered: [
        card({ id: "a", reviewStatus: "approved", approvedQuantity: 1, inspected: true, finalQuantity: 1, finalUnitCents: 10000 }),
        card({ id: "b", reviewStatus: "rejected" }),
      ],
    });
    // $100 of cards → $80 credit; $50 of ours + $5.50 shipping; $24.50 left; cash at 60/80.
    expect(finalOfferPreview(t, SETTINGS)).toEqual({
      valueCents: 10000,
      creditCents: 8000,
      wantedCents: 5000,
      shippingCents: 550,
      dueCents: 0,
      excessCents: 2450,
      cashOptionCents: 1838,
      uninspected: 0,
    });
    expect(finalOfferPreview(t, { ...SETTINGS, cashPayoutEnabled: false }).cashOptionCents).toBe(0);
    const waiting = trade({ offered: [card({ reviewStatus: "approved", approvedQuantity: 1 })] });
    expect(finalOfferPreview(waiting, SETTINGS).uninspected).toBe(1);
  });

  it("knows what goes back to the customer", () => {
    expect(copiesToReturn(card({ inspected: true, receivedQuantity: 3, finalQuantity: 2 }))).toBe(1);
    expect(copiesToReturn(card({ inspected: false, receivedQuantity: 3 }))).toBe(0);
    expect(copiesToReturn({ inspected_at: "2026-10-25T00:00:00Z", received_quantity: 1, final_quantity: 0 })).toBe(1);
  });

  it("finds an adjustment the customer asked for after the final offer went out", () => {
    const t = trade({
      status: "awaiting_final_approval",
      finalOfferAt: "2026-10-25T12:00:00Z",
      messages: [{ id: "m1", authorType: "customer", authorLabel: null, body: "Look again?", createdAt: "2026-10-25T13:00:00Z", visibleToCustomer: true }],
      events: [
        { id: "e0", actorType: "customer", actorLabel: null, event: "adjustment_requested", fromStatus: null, toStatus: null, detail: { message_id: "old" }, createdAt: "2026-10-24T12:00:00Z" },
        { id: "e1", actorType: "customer", actorLabel: null, event: "adjustment_requested", fromStatus: null, toStatus: null, detail: { message_id: "m1" }, createdAt: "2026-10-25T13:00:00Z" },
      ],
    });
    expect(pendingAdjustment(t)).toEqual({ at: "2026-10-25T13:00:00Z", message: "Look again?" });
    expect(pendingAdjustment({ ...t, finalOfferAt: "2026-10-25T14:00:00Z" })).toBeNull();
    expect(pendingAdjustment({ ...t, status: "under_inspection" })).toBeNull();
  });
});

describe("history and badges", () => {
  it("words events for staff, with the useful detail", () => {
    expect(eventLabel("final_offer_sent")).toBe("Final offer sent");
    expect(eventLabel("something_new")).toBe("something new");
    const base = { id: "e", actorType: "staff" as const, actorLabel: "pat", fromStatus: null, toStatus: null, createdAt: "" };
    expect(eventDetail({ ...base, event: "approved", detail: { approved_value_cents: 12345, conditions: "NM only" } })).toBe("Approved value $123.45 · Conditions: NM only");
    expect(eventDetail({ ...base, event: "hold_extended", detail: { hours: 48 } })).toBe("48 more hours");
    expect(eventDetail({ ...base, event: "reminder_sent", detail: { kind: "ship_by" } })).toBe("ship their cards");
    expect(eventDetail({ ...base, event: "rejected", detail: { reason: "Mostly bulk" } })).toBe("Mostly bulk");
    expect(customerEmailNote({ status: "sent" })).toBe(" The customer was emailed.");
    expect(customerEmailNote({ status: "failed" })).toBe(" The email to the customer didn't go out: let them know another way.");
    expect(customerEmailNote({ status: "skipped", reason: "customer-emails-off" })).toBe(" Customer emails are off (Settings), so no email went out.");
    expect(customerEmailNote(null)).toBe("");
    expect(waitingOnStaff("received")).toBe(true);
    expect(waitingOnStaff("in_transit")).toBe(false);
  });
});

describe("the settings form", () => {
  it("round-trips the saved settings", () => {
    const input = settingsInputOf(formOf(SETTINGS));
    expect(input).toMatchObject({
      enabled: true,
      creditRatePercent: 80,
      minCardValueCents: 1500,
      maxTradeValueCents: null,
      conditionPercents: PERCENTS,
      excludedSetCodes: ["30A"],
      excludedCardNames: ["Black Lotus"],
      shipTo: { name: "Geega Games", line1: "100 Test Ave", line2: null, city: "Ballwin", state: "MO", postalCode: "63011" },
    });
  });

  it("normalizes lists and refuses what the server would", () => {
    const form = formOf(SETTINGS);
    expect(settingsInputOf({ ...form, excludedSetCodes: "mh3, lci  MH3" })).toMatchObject({ excludedSetCodes: ["MH3", "LCI"] });
    expect(settingsInputOf({ ...form, numbers: { ...form.numbers, creditRatePercent: "0" } })).toEqual({
      problem: "Store credit rate: enter a whole number from 1 to 100.",
    });
    expect(settingsInputOf({ ...form, conditions: { ...form.conditions, LP: "120" } })).toEqual({ problem: "Lightly Played: enter a percentage from 0 to 100." });
    expect(settingsInputOf({ ...form, money: { ...form.money, minTradeValueCents: "50", maxTradeValueCents: "20" } })).toEqual({
      problem: "The largest trade can't be smaller than the smallest.",
    });
    const noAddress = { ...form, shipTo: { name: "", line1: "", line2: "", city: "", state: "", postalCode: "" } };
    expect(settingsInputOf(noAddress)).toEqual({ problem: "Add the address customers mail their cards to before turning trading on." });
    expect(settingsInputOf({ ...noAddress, enabled: false })).toMatchObject({ enabled: false, shipTo: null });
    expect(settingsInputOf({ ...form, shipTo: { ...form.shipTo, postalCode: "6301" } })).toEqual({ problem: "Mailing address: enter a 5-digit ZIP code." });
  });
});
