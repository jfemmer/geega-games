import { parsePriceCents } from "../../utils/tradeEvaluator";
import type { TradeSettingsInput } from "../../repositories/tradeCenter.supabase";
import { usZip } from "../../../store/lib/usAddress";
import {
  CARD_CONDITIONS,
  CONDITION_NAMES,
  TRADE_SETTING_RANGES,
  formatUsd,
  type CardConditionCode,
  type TradeSettings,
} from "../../../store/lib/tradeCenter";
import { centsInput } from "./tradeMath";

// The Trades → Settings form: the saved settings as editable text, and the
// text back as what the server takes (the server checks every range again).

export type NumberKey =
  | "creditRatePercent"
  | "draftDays"
  | "revisionHours"
  | "confirmationHours"
  | "shipDaysNew"
  | "shipDaysTier1"
  | "shipDaysTier2"
  | "loyaltyTier1Trades"
  | "loyaltyTier2Trades"
  | "scanGraceHours"
  | "paymentDueDays"
  | "maxTransitDays"
  | "stallAlertDays"
  | "confirmReminderHours"
  | "shipReminderHours"
  | "disputeWindowDays"
  | "abandonLimit"
  | "abandonWindowDays"
  | "maxActiveTrades"
  | "maxWantedLines"
  | "maxOfferedLines"
  | "cashRatePercent"
  | "overstockThreshold";

export type MoneyKey =
  | "minCardValueCents"
  | "processingFeeCents"
  | "minTradeValueCents"
  | "maxTradeValueCents"
  | "depositThresholdCents"
  | "depositBand1MaxCents"
  | "depositBand2MaxCents"
  | "depositBand3MaxCents"
  | "depositBand1Cents"
  | "depositBand2Cents"
  | "depositBand3Cents"
  | "depositBand4Cents";

export interface SettingsForm {
  enabled: boolean;
  paused: boolean;
  pauseMessage: string;
  numbers: Record<NumberKey, string>;
  money: Record<MoneyKey, string>;
  conditions: Record<CardConditionCode, string>;
  cashPayoutEnabled: boolean;
  excludedSetCodes: string;
  excludedCardNames: string;
  /** Extra days that don't count toward deadlines: YYYY-MM-DD, one per line. */
  excludedDates: string;
  depositsEnabled: boolean;
  allowForfeiture: boolean;
  depositTerms: string;
  abandonPolicy: "deposit" | "block";
  notifyCustomer: boolean;
  notifyStaff: boolean;
  shippingPaidBy: "customer" | "store";
  shipTo: { name: string; line1: string; line2: string; city: string; state: string; postalCode: string };
  packingInstructions: string;
  returnPolicy: string;
}

const R = TRADE_SETTING_RANGES;

/** The range the database allows for each whole-number setting. */
export const NUMBER_RANGES: Record<NumberKey, readonly [number, number]> = {
  creditRatePercent: R.creditRatePercent,
  draftDays: R.draftDays,
  revisionHours: R.revisionHours,
  confirmationHours: R.confirmationHours,
  shipDaysNew: R.shipDays,
  shipDaysTier1: R.shipDays,
  shipDaysTier2: R.shipDays,
  loyaltyTier1Trades: R.loyaltyTrades,
  loyaltyTier2Trades: R.loyaltyTrades,
  scanGraceHours: R.scanGraceHours,
  paymentDueDays: R.paymentDueDays,
  maxTransitDays: R.maxTransitDays,
  stallAlertDays: R.stallAlertDays,
  confirmReminderHours: R.reminderHours,
  shipReminderHours: R.reminderHours,
  disputeWindowDays: R.disputeWindowDays,
  abandonLimit: R.abandonLimit,
  abandonWindowDays: R.abandonWindowDays,
  maxActiveTrades: R.maxActiveTrades,
  maxWantedLines: R.maxWantedLines,
  maxOfferedLines: R.maxOfferedLines,
  cashRatePercent: R.cashRatePercent,
  overstockThreshold: R.overstockThreshold,
};

export const NUMBER_KEYS = Object.keys(NUMBER_RANGES) as NumberKey[];

export const NUMBER_LABELS: Record<NumberKey, string> = {
  creditRatePercent: "Store credit rate",
  draftDays: "Days to send a draft for review",
  revisionHours: "Hours to send requested changes",
  confirmationHours: "Hours to confirm an approved trade",
  shipDaysNew: "Days to ship: new customers",
  shipDaysTier1: "Days to ship: returning customers",
  shipDaysTier2: "Days to ship: trusted customers",
  loyaltyTier1Trades: "Completed trades to be returning",
  loyaltyTier2Trades: "Completed trades to be trusted",
  scanGraceHours: "Grace for the carrier's first scan",
  paymentDueDays: "Days to pay a difference",
  maxTransitDays: "Alert when in transit longer than",
  stallAlertDays: "Alert when tracking hasn't moved for",
  confirmReminderHours: "Remind before the confirmation deadline",
  shipReminderHours: "Remind before the shipping deadline",
  disputeWindowDays: "Days to send proof after an expiry",
  abandonLimit: "Abandoned reservations allowed",
  abandonWindowDays: "Counted over the last",
  maxActiveTrades: "Open trades per customer",
  maxWantedLines: "Our cards per trade",
  maxOfferedLines: "Their cards per trade",
  cashRatePercent: "Cash rate",
  overstockThreshold: "Overstock limit",
};

/** Dollar settings, with the range (in cents) each allows and its label for messages. */
const MONEY_RULES: Record<Exclude<MoneyKey, "maxTradeValueCents">, { range: readonly [number, number]; label: string }> = {
  minCardValueCents: { range: R.minCardValueCents, label: "Minimum card value" },
  processingFeeCents: { range: R.processingFeeCents, label: "Processing fee" },
  minTradeValueCents: { range: R.minTradeValueCents, label: "Smallest trade" },
  depositThresholdCents: { range: R.depositThresholdCents, label: "Deposit required from" },
  depositBand1MaxCents: { range: R.depositBandMaxCents, label: "First deposit band, up to" },
  depositBand2MaxCents: { range: R.depositBandMaxCents, label: "Second deposit band, up to" },
  depositBand3MaxCents: { range: R.depositBandMaxCents, label: "Third deposit band, up to" },
  depositBand1Cents: { range: R.depositCents, label: "Deposit, first band" },
  depositBand2Cents: { range: R.depositCents, label: "Deposit, second band" },
  depositBand3Cents: { range: R.depositCents, label: "Deposit, third band" },
  depositBand4Cents: { range: R.depositCents, label: "Deposit, top band" },
};

const MONEY_KEYS = Object.keys(MONEY_RULES) as Exclude<MoneyKey, "maxTradeValueCents">[];

export function formOf(s: TradeSettings): SettingsForm {
  const numbers = {} as Record<NumberKey, string>;
  for (const key of NUMBER_KEYS) numbers[key] = String(s[key]);
  const money = {} as Record<MoneyKey, string>;
  for (const key of MONEY_KEYS) money[key] = centsInput(s[key]);
  money.maxTradeValueCents = centsInput(s.maxTradeValueCents);
  const conditions = {} as Record<CardConditionCode, string>;
  for (const code of CARD_CONDITIONS) conditions[code] = String(s.conditionPercents[code]);
  return {
    enabled: s.enabled,
    paused: s.paused,
    pauseMessage: s.pauseMessage,
    numbers,
    money,
    conditions,
    cashPayoutEnabled: s.cashPayoutEnabled,
    excludedSetCodes: s.excludedSetCodes.join(", "),
    excludedCardNames: s.excludedCardNames.join("\n"),
    excludedDates: s.excludedDates.join("\n"),
    depositsEnabled: s.depositsEnabled,
    allowForfeiture: s.allowForfeiture,
    depositTerms: s.depositTerms,
    abandonPolicy: s.abandonPolicy,
    notifyCustomer: s.notifyCustomer,
    notifyStaff: s.notifyStaff,
    shippingPaidBy: s.shippingPaidBy,
    shipTo: {
      name: s.shipTo?.name ?? "",
      line1: s.shipTo?.line1 ?? "",
      line2: s.shipTo?.line2 ?? "",
      city: s.shipTo?.city ?? "",
      state: s.shipTo?.state ?? "",
      postalCode: s.shipTo?.postalCode ?? "",
    },
    packingInstructions: s.packingInstructions,
    returnPolicy: s.returnPolicy,
  };
}

function wholeIn(text: string, [min, max]: readonly [number, number]): number | null {
  if (!/^\d{1,9}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : null;
}

/** "2026-11-26" and the like, one per line or separated by commas; null names the first that isn't a real date. */
export function readExcludedDates(text: string): { dates: string[] } | { bad: string } {
  const out = new Set<string>();
  for (const raw of text.split(/[\s,]+/)) {
    const d = raw.trim();
    if (!d) continue;
    const noon = /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T12:00:00Z`) : Number.NaN;
    const real = Number.isFinite(noon) && new Date(noon).toISOString().slice(0, 10) === d;
    if (!real) return { bad: d };
    out.add(d);
  }
  return { dates: [...out].sort() };
}

/** The form as the server takes it, or the first problem with it. */
export function settingsInputOf(form: SettingsForm): TradeSettingsInput | { problem: string } {
  const numbers = {} as Record<NumberKey, number>;
  for (const key of NUMBER_KEYS) {
    const range = NUMBER_RANGES[key];
    const n = wholeIn(form.numbers[key], range);
    if (n === null) return { problem: `${NUMBER_LABELS[key]}: enter a whole number from ${range[0]} to ${range[1]}.` };
    numbers[key] = n;
  }
  if (numbers.loyaltyTier1Trades >= numbers.loyaltyTier2Trades) {
    return { problem: "Trusted customers need more completed trades than returning ones." };
  }
  const percents = {} as Record<CardConditionCode, number>;
  for (const code of CARD_CONDITIONS) {
    const n = wholeIn(form.conditions[code], R.conditionPercent);
    if (n === null) return { problem: `${CONDITION_NAMES[code]}: enter a percentage from 0 to 100.` };
    percents[code] = n;
  }
  const money = {} as Record<Exclude<MoneyKey, "maxTradeValueCents">, number>;
  for (const key of MONEY_KEYS) {
    const { range, label } = MONEY_RULES[key];
    const cents = parsePriceCents(form.money[key] || "0");
    if (cents === null || cents < range[0] || cents > range[1]) {
      return { problem: `${label}: enter an amount from ${formatUsd(range[0])} to ${formatUsd(range[1])}.` };
    }
    money[key] = cents;
  }
  let maxTrade: number | null = null;
  if (form.money.maxTradeValueCents.trim()) {
    maxTrade = parsePriceCents(form.money.maxTradeValueCents);
    const [min, max] = R.maxTradeValueCents;
    if (maxTrade === null || maxTrade < min || maxTrade > max) return { problem: `Largest trade: enter an amount up to ${formatUsd(max)}, or leave it blank.` };
    if (maxTrade < money.minTradeValueCents) return { problem: "The largest trade can't be smaller than the smallest." };
  }
  if (!(money.depositBand1MaxCents < money.depositBand2MaxCents && money.depositBand2MaxCents < money.depositBand3MaxCents)) {
    return { problem: "Deposit bands have to go up: each one starts where the last ends." };
  }
  const excluded = readExcludedDates(form.excludedDates);
  if ("bad" in excluded) return { problem: `Days that don't count: ${excluded.bad} isn't a date (use YYYY-MM-DD).` };
  if (excluded.dates.length > R.maxExcludedDates[1]) return { problem: `Days that don't count: up to ${R.maxExcludedDates[1]}.` };

  const a = form.shipTo;
  const anyAddress = [a.line1, a.city, a.state, a.postalCode].some((v) => v.trim());
  let shipTo: TradeSettingsInput["shipTo"] = null;
  if (anyAddress) {
    if (!a.line1.trim() || !a.city.trim()) return { problem: "Mailing address: add the street and city." };
    if (!a.state) return { problem: "Mailing address: choose the state." };
    const zip = usZip(a.postalCode);
    if (!zip) return { problem: "Mailing address: enter a 5-digit ZIP code." };
    shipTo = { name: a.name.trim() || null, line1: a.line1.trim(), line2: a.line2.trim() || null, city: a.city.trim(), state: a.state, postalCode: zip };
  }
  if (form.enabled && !shipTo) return { problem: "Add the address customers mail their cards to before turning trading on." };
  if (!form.packingInstructions.trim()) return { problem: "Add packing instructions for customers." };
  if (!form.returnPolicy.trim()) return { problem: "Add the return policy customers see." };
  if (!form.pauseMessage.trim()) return { problem: "Add the message customers see while new trades are paused." };
  if (!form.depositTerms.trim()) return { problem: "Add the deposit and cancellation terms customers agree to." };

  const list = (text: string, split: RegExp) => [...new Set(text.split(split).map((v) => v.trim()).filter(Boolean))];
  return {
    enabled: form.enabled,
    paused: form.paused,
    pauseMessage: form.pauseMessage.trim(),
    ...numbers,
    ...money,
    conditionPercents: percents,
    maxTradeValueCents: maxTrade,
    cashPayoutEnabled: form.cashPayoutEnabled,
    excludedSetCodes: list(form.excludedSetCodes.toUpperCase(), /[\s,]+/),
    excludedCardNames: list(form.excludedCardNames, /\n+/),
    excludedDates: excluded.dates,
    depositsEnabled: form.depositsEnabled,
    allowForfeiture: form.allowForfeiture,
    depositTerms: form.depositTerms.replace(/\r\n/g, "\n").trim(),
    abandonPolicy: form.abandonPolicy,
    notifyCustomer: form.notifyCustomer,
    notifyStaff: form.notifyStaff,
    shippingPaidBy: form.shippingPaidBy,
    shipTo,
    packingInstructions: form.packingInstructions.trim(),
    returnPolicy: form.returnPolicy.trim(),
  };
}
