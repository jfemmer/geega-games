import { describe, expect, it } from "vitest";
import {
  centsInput,
  confirmByPreview,
  depositPreview,
  extendedDeadline,
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
  shipByPreview,
  storeDateInput,
  tradeMoney,
  unitForCondition,
  updateInspectDraft,
} from "../src/admin/pages/trades/tradeMath";
import { formOf, readExcludedDates, settingsInputOf, shippingTiersPreview } from "../src/admin/pages/trades/tradeSettingsForm";
import { actorLabel, customerEmailNote, eventDetail, eventLabel, waitingOnStaff } from "../src/admin/pages/trades/tradeLabels";
import { copiesToReturn } from "../src/store/lib/tradeCenter";
import { PERCENTS, TRADE_SETTINGS, privileges, record, staffCard, staffTrade } from "./helpers/tradeFixtures";

// The arithmetic and forms behind admin Trades: what staff see before they
// act has to match what the database will work out.

const card = staffCard;
const trade = (over: Parameters<typeof staffTrade>[0] = {}) => staffTrade({ wanted: [], ...over });
const SETTINGS = TRADE_SETTINGS;

const iso = (ms: number) => new Date(ms).toISOString();
// 2:00 PM in St. Louis (CDT, UTC-5) on these October 2026 days.
const SAT_2PM = Date.parse("2026-10-24T19:00:00Z");
const FRI_2PM = Date.parse("2026-10-23T19:00:00Z");
const THU_2PM = Date.parse("2026-10-22T19:00:00Z");

describe("dates and money inputs", () => {
  it("gives St. Louis dates for date inputs", () => {
    // 11:30 pm in St. Louis on Thursday Oct 22 is already Friday in UTC.
    expect(storeDateInput(Date.parse("2026-10-23T04:30:00Z"))).toBe("2026-10-22");
    expect(formatDateInput("2026-10-30")).toBe("Fri, Oct 30");
  });

  it("previews the deadlines the server will set, in qualifying time (Sundays and excluded days don't count)", () => {
    // 48 hours to confirm: Saturday 2 PM → Tuesday 2 PM; Friday 2 PM → Monday 2 PM.
    expect(iso(confirmByPreview(SETTINGS, SAT_2PM))).toBe("2026-10-27T19:00:00.000Z");
    expect(iso(confirmByPreview(SETTINGS, FRI_2PM))).toBe("2026-10-26T19:00:00.000Z");
    // Across the end of daylight saving (Sunday, November 1): still 2 PM in St. Louis, now UTC-6.
    expect(iso(confirmByPreview(SETTINGS, Date.parse("2026-10-31T19:00:00Z")))).toBe("2026-11-03T20:00:00.000Z");
    // 3 days to ship: Thursday 2 PM → Monday 2 PM; with that Monday excluded, Tuesday.
    expect(iso(shipByPreview(3, SETTINGS, THU_2PM))).toBe("2026-10-26T19:00:00.000Z");
    expect(iso(shipByPreview(3, { excludedDates: ["2026-10-26"] }, THU_2PM))).toBe("2026-10-27T19:00:00.000Z");
  });

  it("extends confirmation and shipping deadlines in qualifying hours, the others in plain hours, never from the past", () => {
    const now = Date.parse("2026-10-24T12:00:00Z");
    expect(iso(extendedDeadline("shipping", iso(SAT_2PM), 24, SETTINGS, now))).toBe("2026-10-26T19:00:00.000Z");
    expect(iso(extendedDeadline("payment", iso(SAT_2PM), 24, SETTINGS, now))).toBe("2026-10-25T19:00:00.000Z");
    // Already past: a day from now (Monday 9 AM CDT → Tuesday 9 AM).
    const monday = Date.parse("2026-10-26T14:00:00Z");
    expect(iso(extendedDeadline("confirmation", iso(SAT_2PM), 24, SETTINGS, monday))).toBe("2026-10-27T14:00:00.000Z");
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
    // $88.99 of our cards: $3.99 shipping (free from $200), paid by card even with credit to spare.
    expect(tradeMoney(trade())).toMatchObject({
      valueStage: "estimated",
      valueCents: 16000,
      creditCents: 12800,
      shippingCents: 399,
      cardBalanceCents: 0,
      dueCents: 399,
      excessCents: 3901,
    });
    // Credit short of our cards: the rest of our cards plus shipping.
    expect(tradeMoney(trade({ approvedValueCents: 10000 }))).toMatchObject({
      valueStage: "approved",
      creditCents: 8000,
      cardBalanceCents: 899,
      dueCents: 1298,
      excessCents: 0,
    });
    expect(tradeMoney(trade({ wantedTotalCents: 5000 }))).toMatchObject({ shippingCents: 399, dueCents: 399, excessCents: 7800 });
    // $200 or more of our cards ships free.
    expect(tradeMoney(trade({ wantedTotalCents: 20000, estimatedValueCents: 25000 }))).toMatchObject({
      creditCents: 20000,
      shippingCents: 0,
      dueCents: 0,
      excessCents: 0,
    });
    // Each trade keeps the shipping it started on.
    expect(tradeMoney(trade({ shipFeeCents: 599 })).shippingCents).toBe(599);
    // Once settled, the trade's own numbers.
    const settled = trade({
      finalValueCents: 15000,
      finalCreditCents: 12000,
      shippingCents: 399,
      amountDueCents: 399,
      excessCents: 3101,
      excessHandling: "cash",
      cashPayoutCents: 2326,
    });
    expect(tradeMoney(settled)).toMatchObject({ valueStage: "final", creditCents: 12000, shippingCents: 399, dueCents: 399, excessCents: 3101, cashCents: 2326 });
  });

  it("takes the processing fee off the credit", () => {
    expect(tradeMoney(trade({ processingFeeCents: 300 })).creditCents).toBe(12500);
  });
});

describe("the deposit an approval would set", () => {
  it("follows the bands from the threshold up, the override, and the customer's record", () => {
    expect(depositPreview(trade({ wantedTotalCents: 32000 }), SETTINGS, "auto")).toEqual({ cents: 2000, reason: "threshold" });
    expect(depositPreview(trade({ wantedTotalCents: 60000 }), SETTINGS, "auto")).toEqual({ cents: 3000, reason: "threshold" });
    expect(depositPreview(trade({ wantedTotalCents: 29999 }), SETTINGS, "auto")).toEqual({ cents: 0, reason: null });
    // Staff can require one on a small trade (its band), or waive one.
    expect(depositPreview(trade({ wantedTotalCents: 8899 }), SETTINGS, "required")).toEqual({ cents: 500, reason: "trade" });
    expect(depositPreview(trade({ wantedTotalCents: 32000 }), SETTINGS, "waived")).toEqual({ cents: 0, reason: null });
    // Per customer, and after repeated abandoned reservations.
    expect(depositPreview(trade({ wantedTotalCents: 15000, customerRecord: record({ depositRequired: true }) }), SETTINGS, "auto")).toEqual({ cents: 1000, reason: "customer" });
    expect(depositPreview(trade({ wantedTotalCents: 15000, privileges: privileges({ reliabilityDeposit: true }) }), SETTINGS, "auto")).toEqual({ cents: 1000, reason: "reliability" });
    // Switched off: none, whatever else.
    expect(depositPreview(trade({ wantedTotalCents: 90000 }), { ...SETTINGS, depositsEnabled: false }, "required")).toEqual({ cents: 0, reason: null });
  });
});

describe("review", () => {
  it("starts with the value empty for staff to type its TCG low (not the market estimate), and only counts real changes", () => {
    const c = card();
    const draft = reviewDraftOf(c);
    expect(draft).toEqual({ decision: "pending", quantity: 2, unit: "", reviewNote: "", internalNote: "" });
    expect(reviewChanged(c, draft)).toBe(false);
    expect(reviewChanged(c, { ...draft, unit: "80" })).toBe(false); // a value only counts once the card is approved
    expect(reviewChanged(c, { ...draft, decision: "approved" })).toBe(true);
    const saved = card({ reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 7000 });
    expect(reviewDraftOf(saved)).toMatchObject({ decision: "approved", quantity: 1, unit: "70.00" });
    expect(reviewChanged(saved, { ...reviewDraftOf(saved), unit: "70" })).toBe(false); // the same amount, typed differently
    expect(reviewChanged(saved, { ...reviewDraftOf(saved), unit: "72.50" })).toBe(true);
  });

  it("sends a decision only when it's complete", () => {
    const c = card();
    expect(reviewInput(c, { ...reviewDraftOf(c), decision: "approved", quantity: 3 })).toEqual({ problem: "Sheoldred, the Apocalypse: approve 1 to 2." });
    // Approving needs its TCG low typed in: nothing is taken from the estimate.
    expect(reviewInput(c, { ...reviewDraftOf(c), decision: "approved" })).toEqual({ problem: "Sheoldred, the Apocalypse: enter its TCG low (each)." });
    expect(reviewInput(c, { ...reviewDraftOf(c), decision: "approved", unit: "abc" })).toEqual({ problem: "Sheoldred, the Apocalypse: enter its TCG low (each)." });
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
    const c = card({ id: "c" });
    const tally = reviewTally([a, b, c], {
      a: { ...reviewDraftOf(a), decision: "approved", quantity: 1, unit: "76.50" },
      c: { ...reviewDraftOf(c), decision: "approved" }, // no TCG low typed yet: counts nothing
    });
    expect(tally).toEqual({ approved: 2, rejected: 0, pending: 1, unpriced: 1, approvedValueCents: 7650 });
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
    expect(inspectInput(approved, { ...d, accept: 0, note: "Only one arrived, and it's a proxy" })).toMatchObject({ finalQuantity: 0, finalUnitCents: 0 });
  });

  it("won't take a change from the approval without a reason the customer can see", () => {
    const lower = { ...inspectDraftOf(approved), unit: "70.00" };
    expect(inspectInput(approved, lower)).toEqual({
      problem: "Sheoldred, the Apocalypse: say why it changed from the approval (a note for the customer, a flag or the condition).",
    });
    expect(inspectInput(approved, { ...lower, flags: ["damaged"] })).toMatchObject({ finalUnitCents: 7000, flags: ["damaged"] });
    expect(inspectInput(approved, { ...lower, note: "Edge wear" })).toMatchObject({ finalUnitCents: 7000, inspectionNote: "Edge wear" });
    expect(inspectInput(approved, { ...lower, condition: "LP" })).toMatchObject({ verifiedCondition: "LP" });
    // As approved: nothing to explain.
    expect(inspectInput(approved, inspectDraftOf(approved))).toMatchObject({ finalQuantity: 2, finalUnitCents: 7600 });
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
    // $100 of cards → $80 credit; it covers our $50 with $30 left over (cash at 60/80: $22.50);
    // shipping ($3.99) is paid by card, never out of the credit.
    expect(finalOfferPreview(t, SETTINGS)).toEqual({
      valueCents: 10000,
      creditCents: 8000,
      wantedCents: 5000,
      shippingCents: 399,
      cardBalanceCents: 0,
      dueCents: 399,
      excessCents: 3000,
      cashOptionCents: 2250,
      uninspected: 0,
    });
    // Credit short of our cards: the rest of our cards and shipping, nothing left over.
    const short = finalOfferPreview({ ...t, wantedTotalCents: 9000 }, SETTINGS);
    expect(short).toMatchObject({ cardBalanceCents: 1000, shippingCents: 399, dueCents: 1399, excessCents: 0, cashOptionCents: 0 });
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
    expect(
      eventDetail({ ...base, event: "approved", detail: { approved_value_cents: 12345, confirm_by: "2026-10-27T19:00:00Z", deposit_cents: 2000 } }),
    ).toBe("Approved value $123.45 · confirm by Tue, Oct 27, 2:00 PM CT · deposit $20.00");
    expect(
      eventDetail({ ...base, event: "deadline_extended", detail: { kind: "shipping", to: "2026-10-27T19:00:00Z", hours: 24, customer_requested: true } }),
    ).toBe("For shipping · now Tue, Oct 27, 2:00 PM CT · 24 more hours · customer asked");
    expect(eventDetail({ ...base, event: "reminder_sent", detail: { kind: "ship_by" } })).toBe("ship their cards");
    expect(eventDetail({ ...base, event: "reminder_sent", detail: { kind: "confirm_by" } })).toBe("confirm their trade");
    expect(eventDetail({ ...base, event: "rejected", detail: { reason: "Mostly bulk" } })).toBe("Mostly bulk");
    expect(eventDetail({ ...base, event: "expired", detail: { reason: "No tracking number by the shipping deadline.", fault: "missed_deadline" } })).toBe(
      "No tracking number by the shipping deadline. · Didn't ship by the deadline",
    );
    expect(eventDetail({ ...base, event: "deposit_forfeited", detail: { amount_cents: 2000, note: "Never shipped" } })).toBe("$20.00 · Never shipped");
    expect(eventDetail({ ...base, event: "late_acceptance", detail: { accepted_at: "2026-10-27T21:00:00Z", ship_by: "2026-10-27T19:00:00Z" } })).toBe(
      "scanned Tue, Oct 27, 4:00 PM CT · deadline Tue, Oct 27, 2:00 PM CT",
    );
    expect(eventLabel("reservation_conflict")).toBe("A card sold while the deposit went through: nothing reserved, deposit refunded");
    expect(actorLabel({ actorType: "system", actorLabel: "stripe" })).toBe("Stripe");
    expect(actorLabel({ actorType: "system", actorLabel: "expiry" })).toBe("Automatic");
    expect(customerEmailNote({ status: "sent" })).toBe(" The customer was emailed.");
    expect(customerEmailNote({ status: "failed" })).toBe(" The email to the customer didn't go out: let them know another way.");
    expect(customerEmailNote({ status: "skipped", reason: "customer-emails-off" })).toBe(" Customer emails are off (Settings), so no email went out.");
    expect(customerEmailNote(null)).toBe("");
    expect(waitingOnStaff({ needsStaff: true })).toBe(true);
    expect(waitingOnStaff({ needsStaff: false })).toBe(false);
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
      confirmationHours: 48,
      shipDaysNew: 3,
      excludedDates: [],
      depositsEnabled: true,
      depositThresholdCents: 30000,
      depositBand1MaxCents: 10000,
      depositBand2MaxCents: 30000,
      depositBand3MaxCents: 60000,
      depositBand1Cents: 500,
      depositBand4Cents: 3000,
      allowForfeiture: false,
      abandonPolicy: "deposit",
      depositTerms: SETTINGS.depositTerms,
      shipFeeCents: 399,
      freeShipThresholdCents: 20000,
      freeShipFeeCents: 0,
      shipCostEstimateCents: 600,
    });
    // The terms version is the server's to set.
    expect(input).not.toHaveProperty("depositTermsVersion");
  });

  it("previews the shipping tiers as typed", () => {
    const form = formOf({ ...SETTINGS, minTradeValueCents: 7500 });
    expect(shippingTiersPreview(form)).toBe("Under $75.00: can't start a trade · $75.00 to $199.99: $3.99 · $200.00 or more: free");
    expect(shippingTiersPreview({ ...form, money: { ...form.money, freeShipFeeCents: "1.99" } })).toBe(
      "Under $75.00: can't start a trade · $75.00 to $199.99: $3.99 · $200.00 or more: $1.99",
    );
    // No minimum: no "can't start" tier. Free shipping at the minimum: no middle tier.
    expect(shippingTiersPreview(formOf(SETTINGS))).toBe("$0.00 to $199.99: $3.99 · $200.00 or more: free");
    expect(shippingTiersPreview({ ...form, money: { ...form.money, freeShipThresholdCents: "75" } })).toBe(
      "Under $75.00: can't start a trade · $75.00 or more: free",
    );
    // Something that isn't valid yet: nothing to preview.
    expect(shippingTiersPreview({ ...form, money: { ...form.money, freeShipThresholdCents: "50" } })).toBeNull();
    expect(shippingTiersPreview({ ...form, money: { ...form.money, shipFeeCents: "abc" } })).toBeNull();
  });

  it("reads the days that don't count: real dates only, sorted, without repeats", () => {
    expect(readExcludedDates("2026-12-25\n2026-11-26, 2026-12-25")).toEqual({ dates: ["2026-11-26", "2026-12-25"] });
    expect(readExcludedDates("2026-02-30")).toEqual({ bad: "2026-02-30" });
    expect(readExcludedDates("  ")).toEqual({ dates: [] });
  });

  it("normalizes lists and refuses what the server would", () => {
    const form = formOf(SETTINGS);
    expect(settingsInputOf({ ...form, excludedSetCodes: "mh3, lci  MH3" })).toMatchObject({ excludedSetCodes: ["MH3", "LCI"] });
    expect(settingsInputOf({ ...form, numbers: { ...form.numbers, creditRatePercent: "0" } })).toEqual({
      problem: "Store credit rate: enter a whole number from 1 to 100.",
    });
    expect(settingsInputOf({ ...form, conditions: { ...form.conditions, LP: "120" } })).toEqual({ problem: "Lightly Played: enter a percentage from 0 to 100." });
    expect(settingsInputOf({ ...form, money: { ...form.money, minTradeValueCents: "50", maxTradeValueCents: "20" } })).toEqual({
      problem: "The largest trade can't be smaller than the minimum.",
    });
    // Shipping: no negative or oversized fees, no free shipping below the minimum, never dearer from the threshold up.
    expect(settingsInputOf({ ...form, money: { ...form.money, shipFeeCents: "-1" } })).toEqual({
      problem: "Shipping under the free-shipping threshold: enter an amount from $0.00 to $100.00.",
    });
    expect(settingsInputOf({ ...form, money: { ...form.money, freeShipThresholdCents: "0" } })).toEqual({
      problem: "Free shipping from: enter an amount from $0.01 to $1,000,000.00.",
    });
    expect(settingsInputOf({ ...form, money: { ...form.money, freeShipFeeCents: "4.99" } })).toEqual({
      problem: "Shipping from the free-shipping threshold up can't cost more than below it.",
    });
    expect(settingsInputOf({ ...form, money: { ...form.money, minTradeValueCents: "75", freeShipThresholdCents: "50" } })).toEqual({
      problem: "Free shipping has to start at or above the minimum trade.",
    });
    expect(settingsInputOf({ ...form, money: { ...form.money, shipCostEstimateCents: "150" } })).toEqual({
      problem: "What shipping costs us: enter an amount from $0.00 to $100.00.",
    });
    expect(settingsInputOf({ ...form, money: { ...form.money, minTradeValueCents: "75", shipFeeCents: "4.50" } })).toMatchObject({
      minTradeValueCents: 7500,
      shipFeeCents: 450,
    });
    const noAddress = { ...form, shipTo: { name: "", line1: "", line2: "", city: "", state: "", postalCode: "" } };
    expect(settingsInputOf(noAddress)).toEqual({ problem: "Add the address customers mail their cards to before turning trading on." });
    expect(settingsInputOf({ ...noAddress, enabled: false })).toMatchObject({ enabled: false, shipTo: null });
    expect(settingsInputOf({ ...form, shipTo: { ...form.shipTo, postalCode: "6301" } })).toEqual({ problem: "Mailing address: enter a 5-digit ZIP code." });
    expect(settingsInputOf({ ...form, money: { ...form.money, depositBand2MaxCents: "50" } })).toEqual({
      problem: "Deposit bands have to go up: each one starts where the last ends.",
    });
    expect(settingsInputOf({ ...form, money: { ...form.money, depositBand1Cents: "0.25" } })).toEqual({
      problem: "Deposit, first band: enter an amount from $0.50 to $1,000.00.",
    });
    expect(settingsInputOf({ ...form, numbers: { ...form.numbers, loyaltyTier2Trades: "3" } })).toEqual({
      problem: "Trusted customers need more completed trades than returning ones.",
    });
    expect(settingsInputOf({ ...form, numbers: { ...form.numbers, confirmationHours: "0" } })).toEqual({
      problem: "Hours to confirm an approved trade: enter a whole number from 1 to 336.",
    });
    expect(settingsInputOf({ ...form, excludedDates: "2026-13-01" })).toEqual({ problem: "Days that don't count: 2026-13-01 isn't a date (use YYYY-MM-DD)." });
    expect(settingsInputOf({ ...form, depositTerms: "  " })).toEqual({ problem: "Add the deposit and cancellation terms customers agree to." });
  });
});

describe("the meetup (local pickup)", () => {
  it("adds up the cards taken, the credit, what they pay and what's left over, as the database does", async () => {
    const { meetupTotals } = await import("../src/admin/pages/trades/tradeMath");
    const trade = { wantedTotalCents: 8000, creditRatePercent: 80, processingFeeCents: 0 };
    const off = { cashPayoutEnabled: false, cashRatePercent: 50 };
    expect(meetupTotals(trade, [{ quantity: 1, unitCents: 5000 }, { quantity: 2, unitCents: 1000 }], off)).toEqual({
      valueCents: 7000,
      creditCents: 5600,
      dueCents: 2400,
      excessCents: 0,
      cashOptionCents: 0,
    });
    // Nothing taken: they buy our cards outright.
    expect(meetupTotals(trade, [], off)).toMatchObject({ valueCents: 0, creditCents: 0, dueCents: 8000 });
    // More than covers ours: the rest is store credit, or cash at the cash rate when that's on.
    expect(meetupTotals(trade, [{ quantity: 1, unitCents: 15000 }], { cashPayoutEnabled: true, cashRatePercent: 50 })).toEqual({
      valueCents: 15000,
      creditCents: 12000,
      dueCents: 0,
      excessCents: 4000,
      cashOptionCents: 2500,
    });
    // The processing fee comes off the credit.
    expect(meetupTotals({ ...trade, processingFeeCents: 300 }, [{ quantity: 1, unitCents: 5000 }], off).creditCents).toBe(3700);
  });
});
