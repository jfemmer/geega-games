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
  | "reservationHours"
  | "revisionHours"
  | "shipBusinessDays"
  | "shipGraceHours"
  | "transitAlertDays"
  | "paymentDueDays"
  | "maxActiveTrades"
  | "maxWantedLines"
  | "maxOfferedLines"
  | "maxExpiredTrades30d"
  | "cashRatePercent"
  | "overstockThreshold";

export type MoneyKey = "minCardValueCents" | "processingFeeCents" | "minTradeValueCents" | "maxTradeValueCents";

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
  notifyCustomer: boolean;
  notifyStaff: boolean;
  shippingPaidBy: "customer" | "store";
  shipTo: { name: string; line1: string; line2: string; city: string; state: string; postalCode: string };
  packingInstructions: string;
  returnPolicy: string;
}

export const NUMBER_KEYS: NumberKey[] = [
  "creditRatePercent",
  "reservationHours",
  "revisionHours",
  "shipBusinessDays",
  "shipGraceHours",
  "transitAlertDays",
  "paymentDueDays",
  "maxActiveTrades",
  "maxWantedLines",
  "maxOfferedLines",
  "maxExpiredTrades30d",
  "cashRatePercent",
  "overstockThreshold",
];

export const NUMBER_LABELS: Record<NumberKey, string> = {
  creditRatePercent: "Store credit rate",
  reservationHours: "Hold while they build their list",
  revisionHours: "Hold while they make changes",
  shipBusinessDays: "Business days to ship",
  shipGraceHours: "Grace after the ship-by date",
  transitAlertDays: "Alert when in transit longer than",
  paymentDueDays: "Days to pay a difference",
  maxActiveTrades: "Open trades per customer",
  maxWantedLines: "Our cards per trade",
  maxOfferedLines: "Their cards per trade",
  maxExpiredTrades30d: "Expired trades before a customer is paused",
  cashRatePercent: "Cash rate",
  overstockThreshold: "Overstock limit",
};

export function formOf(s: TradeSettings): SettingsForm {
  const numbers = {} as Record<NumberKey, string>;
  for (const key of NUMBER_KEYS) numbers[key] = String(s[key]);
  const conditions = {} as Record<CardConditionCode, string>;
  for (const code of CARD_CONDITIONS) conditions[code] = String(s.conditionPercents[code]);
  return {
    enabled: s.enabled,
    paused: s.paused,
    pauseMessage: s.pauseMessage,
    numbers,
    money: {
      minCardValueCents: centsInput(s.minCardValueCents),
      processingFeeCents: centsInput(s.processingFeeCents),
      minTradeValueCents: centsInput(s.minTradeValueCents),
      maxTradeValueCents: centsInput(s.maxTradeValueCents),
    },
    conditions,
    cashPayoutEnabled: s.cashPayoutEnabled,
    excludedSetCodes: s.excludedSetCodes.join(", "),
    excludedCardNames: s.excludedCardNames.join("\n"),
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

/** The form as the server takes it, or the first problem with it. */
export function settingsInputOf(form: SettingsForm): TradeSettingsInput | { problem: string } {
  const r = TRADE_SETTING_RANGES;
  const numbers = {} as Record<NumberKey, number>;
  for (const key of NUMBER_KEYS) {
    const n = wholeIn(form.numbers[key], r[key]);
    if (n === null) return { problem: `${NUMBER_LABELS[key]}: enter a whole number from ${r[key][0]} to ${r[key][1]}.` };
    numbers[key] = n;
  }
  const percents = {} as Record<CardConditionCode, number>;
  for (const code of CARD_CONDITIONS) {
    const n = wholeIn(form.conditions[code], r.conditionPercent);
    if (n === null) return { problem: `${CONDITION_NAMES[code]}: enter a percentage from 0 to 100.` };
    percents[code] = n;
  }
  const money = (key: Exclude<MoneyKey, "maxTradeValueCents">, label: string): number | { problem: string } => {
    const cents = parsePriceCents(form.money[key] || "0");
    const [min, max] = r[key];
    if (cents === null || cents < min || cents > max) return { problem: `${label}: enter an amount from ${formatUsd(min)} to ${formatUsd(max)}.` };
    return cents;
  };
  const minCard = money("minCardValueCents", "Minimum card value");
  if (typeof minCard !== "number") return minCard;
  const fee = money("processingFeeCents", "Processing fee");
  if (typeof fee !== "number") return fee;
  const minTrade = money("minTradeValueCents", "Smallest trade");
  if (typeof minTrade !== "number") return minTrade;
  let maxTrade: number | null = null;
  if (form.money.maxTradeValueCents.trim()) {
    maxTrade = parsePriceCents(form.money.maxTradeValueCents);
    const [min, max] = r.maxTradeValueCents;
    if (maxTrade === null || maxTrade < min || maxTrade > max) return { problem: `Largest trade: enter an amount up to ${formatUsd(max)}, or leave it blank.` };
    if (maxTrade < minTrade) return { problem: "The largest trade can't be smaller than the smallest." };
  }

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

  const list = (text: string, split: RegExp) => [...new Set(text.split(split).map((v) => v.trim()).filter(Boolean))];
  return {
    enabled: form.enabled,
    paused: form.paused,
    pauseMessage: form.pauseMessage.trim(),
    ...numbers,
    conditionPercents: percents,
    minCardValueCents: minCard,
    processingFeeCents: fee,
    minTradeValueCents: minTrade,
    maxTradeValueCents: maxTrade,
    cashPayoutEnabled: form.cashPayoutEnabled,
    excludedSetCodes: list(form.excludedSetCodes.toUpperCase(), /[\s,]+/),
    excludedCardNames: list(form.excludedCardNames, /\n+/),
    notifyCustomer: form.notifyCustomer,
    notifyStaff: form.notifyStaff,
    shippingPaidBy: form.shippingPaidBy,
    shipTo,
    packingInstructions: form.packingInstructions.trim(),
    returnPolicy: form.returnPolicy.trim(),
  };
}
