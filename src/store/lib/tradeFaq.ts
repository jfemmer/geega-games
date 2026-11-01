import { formatCents } from "./money";
import { localTermsDiffer, meetSpotLine, meetSpotOf, type TradeTerms } from "./tradeCenter";
import { moneyShort, requiredValueCents } from "./tradeShipping";
import { conditionAgeSummary } from "./tradeConditions";
import { addQualifyingDays, storeDateKey, storeInstant, weekdayOfKey } from "./tradeDeadlines";

// The trade program's FAQ and the sentences that describe its terms, shared
// by the Trade Cards page (the cart, /trade-cards) and the trade-in landing
// page (/trade-in-magic-cards). Every number comes from the Trade Center
// settings staff control; with no terms yet (the prerendered page, or
// before they load) the wording stays general.

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Tuesday": the day a shipping window that opens Friday at 2 PM closes, worked out like a real deadline. */
export function shipExampleDay(days: number): string {
  const friday = storeInstant(2026, 10, 30, 14); // Friday, October 30, 2026, 2:00 PM in St. Louis
  return WEEKDAYS[weekdayOfKey(storeDateKey(addQualifyingDays(friday, days)))];
}

/** "Our cards ship to you tracked: $3.99, or free on $200 or more of our cards." */
export function ourShipping(t: TradeTerms | null): string {
  if (!t) return "Our cards ship to you tracked, free on bigger trades.";
  const free = t.freeShipFeeCents > 0 ? moneyShort(t.freeShipFeeCents) : "free";
  return `Our cards ship to you tracked: ${moneyShort(t.shipFeeCents)}, or ${free} on ${moneyShort(t.freeShipThresholdCents)} or more of our cards.`;
}

/** "Local pickup trades: 85% trade credit, staples worth $5+ each at TCG low, and at least $40 of our cards." */
export function localTermsSentence(t: TradeTerms): string {
  const minimum = t.localMinTradeValueCents > 0 ? `, and at least ${moneyShort(t.localMinTradeValueCents)} of our cards` : ", and no minimum trade";
  return `Local pickup trades run on their own terms: ${t.localCreditRatePercent}% trade credit, staples worth ${moneyShort(t.localMinCardValueCents)}+ each at TCG low${minimum}.`;
}

export function tradeFaqItems(t: TradeTerms | null): { question: string; answer: string }[] {
  const rate = t ? `${t.creditRatePercent}%` : "a set share";
  const confirmHours = t ? plural(t.confirmationHours, "hour") : "a set time";
  const shipDays = t ? plural(t.shipDaysNew, "day") : "a few days";
  const deposits = t?.depositsEnabled ?? false;
  const threshold = t ? formatCents(t.depositThresholdCents) : "";
  const spot = meetSpotOf(t);
  return [
    {
      question: "What cards can I trade in?",
      answer: `Staples: Magic: The Gathering singles worth ${t ? `${moneyShort(t.minCardValueCents)}+` : "a set amount or more"} each at TCG low, in their condition. We're not taking bulk. We match every card to its exact printing and finish, so search for yours or paste a list when you build your trade.`,
    },
    {
      question: "How is my trade credit worked out?",
      answer: `When we review your list, we price each of your cards at its TCG low (TCGplayer's lowest listed price) for its condition and finish. Your trade credit is ${rate} of that. The estimates you see while you build your trade use today's market prices, so they're a rough guide.`,
    },
    {
      question: "How do you decide my cards' condition?",
      answer: `From when each printing came out: ${conditionAgeSummary()}. When your cards arrive we check every one, and a card in better or worse shape is worth more or less. Your final offer shows every change and why.`,
    },
    {
      question: "Is there a minimum trade?",
      answer: !t
        ? "Yes: each trade needs a minimum value of our cards, shown in your trade cart."
        : t.minTradeValueCents > 0
          ? `Yes: at least ${moneyShort(t.minTradeValueCents)} of our cards per trade, at their regular prices (shipping doesn't count toward it). You can add cards below that while you shop; you'll need to reach it to start your trade. At ${rate} trade credit, ${moneyShort(t.minTradeValueCents)} of our cards takes ${formatCents(requiredValueCents(t.minTradeValueCents, t.creditRatePercent, t.processingFeeCents))} of your cards at TCG low to cover completely.`
          : `Not right now: a trade can be any amount of our cards. Your trade cart shows how much of your cards, at TCG low, it takes to cover them at ${rate} trade credit.`,
    },
    {
      question: "Do my cards have to cover everything I pick?",
      answer: "No. If your credit falls short, you pay the rest by card at the end, after you've accepted our final offer.",
    },
    {
      question: "What if my cards are worth more than the cards I picked?",
      answer: t?.cashPayoutEnabled
        ? "Credit left over stays in your account as store credit for your next order. Sometimes we can offer cash for it instead, at a lower rate; we'll say so in your final offer if we can."
        : t?.localPickupEnabled && t.localCashPayoutEnabled
          ? "Credit left over stays in your account as store credit for your next order. On a local pickup trade we can sometimes pay it in cash instead, at a lower rate, when we meet."
          : "Credit left over stays in your account as store credit for your next order. It isn't paid out in cash.",
    },
    {
      question: "When are the cards I picked reserved for me?",
      answer: `When you confirm your approved trade. While you build your trade and while we review it, our cards stay on sale. Once we approve it you have ${confirmHours} to confirm (Sundays don't count). If a card sells before you confirm, we'll tell you and you can pick another.`,
    },
    {
      question: "How long do I have to ship my cards?",
      answer: t
        ? `${shipDays} from confirming, and Sundays don't count: confirm on a Friday at 2 PM and you'd ship by ${shipExampleDay(t.shipDaysNew)} at 2 PM. It counts as shipped when the carrier scans your package; a label on its own doesn't. After ${plural(t.loyaltyTier1Trades, "completed trade")} you get ${plural(t.shipDaysTier1, "day")}, and after ${t.loyaltyTier2Trades}, ${plural(t.shipDaysTier2, "day")}.`
        : `${shipDays} from confirming, and Sundays don't count. It counts as shipped when the carrier scans your package; a label on its own doesn't.`,
    },
    {
      question: "Is there a deposit?",
      answer: deposits
        ? `Trades with ${threshold} or more of our cards need a small refundable deposit to confirm. It's refunded in full, to your card, as soon as the carrier accepts your package by your shipping deadline, and declining our final offer never costs it. If you cancel after confirming and before shipping, or don't ship in time, it may be kept under our cancellation policy; a person reviews every case first. Smaller trades may need one too after earlier trades were canceled or not shipped.`
        : "Not right now. If a trade ever needs one, you'll see it, and its terms, before you confirm.",
    },
    {
      question: "Who pays for shipping?",
      answer: `${
        t?.shippingPaidBy === "store"
          ? "We cover shipping your cards to us; we'll arrange it once your trade is approved."
          : "You ship your cards to us at your cost, with tracking (we'll show you how to pack them)."
      } ${ourShipping(t)} It's paid by card when your trade is final, never out of your trade credit, and never charged on a trade that's canceled or declined.`,
    },
    {
      question: "What if my cards arrive in a different condition, or one is missing?",
      answer:
        "We check every card when it arrives. One in better shape than listed is worth more, and one in worse shape is worth less; a card that's missing, wrong or not genuine can't be taken. Your final offer lists every change and why, and you decide whether to accept it.",
    },
    {
      question: "What if I don't like the final offer?",
      answer: `Ask us to take another look, or decline it. ${t?.returnPolicy ?? "If you decline, we'll mail your cards back to you."}`,
    },
    {
      question: "Can I cancel a trade?",
      answer:
        "Yes. Before you confirm, it costs nothing. After you confirm, our cards are reserved for you, so canceling before you ship counts against future trades, and a deposit on the trade may be kept under our cancellation policy (we review every case). Once the carrier has your package you can still cancel with no penalty, and we'll mail your cards back.",
    },
    ...(t?.localPickupEnabled
      ? [
          {
            question: "Can I trade in person?",
            answer: `Yes, in ${t.localPickupArea}: choose local pickup when you start your trade. You don't list your cards; once we approve the trade, we hold our cards for you until we meet, and we set a time to meet${spot ? ` at our meeting spot, ${meetSpotLine(spot)}` : " in a public place"}. Bring your cards and we'll value each one at its TCG low for the condition we see, together. Anything your ${t.localCreditRatePercent}% trade credit doesn't cover is paid then, in cash or by card. There's no deposit and no shipping.${localTermsDiffer(t) ? ` ${localTermsSentence(t)}` : ""}`,
          },
        ]
      : []),
    {
      question: "Do I need an account?",
      answer: "Yes. Trades live in your account, where you'll see every card, price, message and deadline.",
    },
  ];
}
