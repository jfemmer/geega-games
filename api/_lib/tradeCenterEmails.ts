import * as React from "react";
import crypto from "node:crypto";
import { sendTrackedEmail, type SendEmailResult } from "./emailService.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";
import { notifyStaff } from "./staffPush.js";
// The collection sorting emails' layout is a general one (a heading,
// paragraphs, a details box, an itemized total, a note, an address, lists
// and a button), so trades use it too rather than a copy of it.
import {
  SortingEmail as NoticeEmail,
  sortingEmailText as noticeEmailText,
  type SortingEmailData as NoticeEmailData,
} from "./emails/SortingEmails.js";
import { adminTradePath, handoffOf, meetSpotText, shipToAddress, type TradeBundle, type TradeOfferRow, type TradeSettingsRow } from "./tradeCenter.js";
import {
  cardLine,
  LOCAL_PAYMENT_LABELS,
  formatDeadline,
  formatUsd,
  myTradePath,
  offerChanges,
  tradeComparison,
  tradeCreditCents,
  tradeLabel,
  type TradeOfferCard,
} from "../../src/store/lib/tradeCenter.js";
import { PACKING_CHECKLIST, PROTECT_YOUR_CARDS, tradeShippingCents, type ShippingTerms } from "../../src/store/lib/tradeShipping.js";
import { trackingUrlFor } from "../../src/store/lib/tracking.js";

// Trade Center emails and staff alerts. Like the other *Emails modules every
// email has an idempotency key, so a retried request, a repeated webhook or
// a worker run that overlaps another never sends the same email twice. All
// of it is best-effort for the caller: the change is already saved when
// these run, and they never throw.

type Result = SendEmailResult | { status: "skipped"; reason: string };
type Data = Omit<NoticeEmailData, "siteUrl" | "logoUrl" | "supportEmail" | "reasonLine">;

const money = formatUsd;
/** Cards listed in an email; the rest are on the trade page. */
const MAX_EMAIL_CARDS = 25;

function base() {
  return { siteUrl: siteUrl(), logoUrl: logoUrl(), supportEmail: ServerEnv.replyTo() };
}

function tradeUrl(tradeId: string): string {
  return `${siteUrl()}${myTradePath(tradeId)}`;
}

function firstName(name: string | null): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || null;
}

function hi(name: string | null): string {
  const first = firstName(name);
  return first ? `Hi ${first},` : "Hi there,";
}

function offerName(c: TradeOfferRow): string {
  return cardLine({ cardName: c.card_name, setCode: c.set_code, collectorNumber: c.collector_number, finish: c.finish });
}

function clipRows<T>(rows: T[], more: (n: number) => T): T[] {
  return rows.length > MAX_EMAIL_CARDS ? [...rows.slice(0, MAX_EMAIL_CARDS), more(rows.length - MAX_EMAIL_CARDS)] : rows;
}

/** "48 hours" or "3 days", in qualifying time. */
function hoursPhrase(hours: number): string {
  return hours === 1 ? "1 hour" : `${hours} hours`;
}
function daysPhrase(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

/** The shipping terms a trade started on. */
function shippingTermsOf(b: TradeBundle): ShippingTerms {
  const t = b.trade;
  return { shipFeeCents: t.ship_fee_cents, freeShipThresholdCents: t.free_ship_threshold_cents, freeShipFeeCents: t.free_ship_fee_cents };
}

/**
 * Our cards, their cards and the bottom line, as the itemized box. Trade
 * credit covers our cards only; shipping our cards is paid by card.
 */
function comparisonBlock(
  b: TradeBundle,
  value: number,
  valueLabel: string,
  footnote: string | null,
  shippingCents?: number,
): NoticeEmailData["quote"] {
  const t = b.trade;
  const c = tradeComparison({
    wantedCents: t.wanted_total_cents,
    offeredValueCents: value,
    ratePercent: t.credit_rate_percent,
    feeCents: t.processing_fee_cents,
    shippingCents: shippingCents ?? tradeShippingCents(t.wanted_total_cents, shippingTermsOf(b)),
  });
  const lines = [
    { label: "Our cards", value: money(c.wantedCents) },
    { label: valueLabel, value: money(value) },
    { label: `Trade credit at ${t.credit_rate_percent}%`, value: money(c.creditCents) },
  ];
  if (t.processing_fee_cents > 0) lines.push({ label: "Processing fee (taken from the credit)", value: money(t.processing_fee_cents) });
  if (c.cardBalanceCents > 0) lines.push({ label: "Left to pay for our cards", value: money(c.cardBalanceCents) });
  lines.push({ label: "Shipping our cards to you (paid by card)", value: c.shippingCents === 0 ? "Free" : money(c.shippingCents) });
  if (c.cashDueCents > 0 && c.excessCents > 0) lines.push({ label: "Trade credit left over (store credit)", value: money(c.excessCents) });
  if (c.cashDueCents > 0 || c.excessCents === 0) {
    return { lines, totalLabel: c.cashDueCents > 0 ? "You'd pay by card" : "Nothing to pay by card", total: money(c.cashDueCents), footnote };
  }
  return { lines, totalLabel: "Trade credit left over", total: money(c.excessCents), footnote };
}

function mailToBlock(settings: TradeSettingsRow): NoticeEmailData["address"] | null {
  const address = shipToAddress(settings);
  if (!address) return null;
  return {
    title: "Mail your cards to",
    lines: [address.name, address.line1, address.line2, `${address.city}, ${address.state} ${address.postalCode}`].filter(
      (line): line is string => Boolean(line),
    ),
  };
}

/** The deposit in a sentence, as of now. */
function paidDeposit(b: TradeBundle): number {
  return b.trade.deposit_paid_cents ?? b.trade.deposit_cents;
}

async function sendCustomer(
  b: TradeBundle,
  settings: TradeSettingsRow,
  emailType: string,
  idempotencyKey: string,
  subject: string,
  data: Data,
): Promise<Result> {
  const to = b.trade.customer_email;
  if (!to) return { status: "skipped", reason: "no-email" };
  if (!settings.notify_customer) return { status: "skipped", reason: "customer-emails-off" };
  const full: NoticeEmailData = {
    ...data,
    ...base(),
    reasonLine: `You received this because you started trade ${tradeLabel(b.trade.trade_number)} with Geega Games.`,
  };
  try {
    const result = await sendTrackedEmail({
      emailType,
      idempotencyKey,
      to,
      from: ServerEnv.fromOrders(),
      replyTo: ServerEnv.replyTo(),
      subject,
      react: React.createElement(NoticeEmail, full),
      text: noticeEmailText(full),
    });
    if (result.status === "failed") console.error("[tradeCenterEmails] customer email failed", emailType, b.trade.id, result.error);
    return result;
  } catch (err) {
    console.error("[tradeCenterEmails] customer email threw", emailType, b.trade.id, err);
    return { status: "failed", error: err instanceof Error ? err.message : String(err), deduped: false };
  }
}

export interface ShortLine {
  card_name: string;
  wanted: number;
  available: number;
}

export type DepositRefundReason = "store_canceled" | "declined" | "withdrawn" | "staff" | "conflict" | "unusable" | "dispute";

export type TradeCustomerEmail =
  | { kind: "submitted" }
  | { kind: "revision_requested"; message: string }
  | { kind: "cards_unavailable"; short: ShortLine[]; refund: boolean }
  | { kind: "approved" }
  | { kind: "reserved" }
  | { kind: "tracking_added" }
  | { kind: "no_scan_yet" }
  | { kind: "shipment_verified" }
  | { kind: "deposit_refund_started"; why: DepositRefundReason }
  | { kind: "deposit_refunded" }
  | { kind: "deposit_kept" }
  | { kind: "delivered" }
  | { kind: "received" }
  | { kind: "final_offer" }
  | { kind: "awaiting_payment" }
  | { kind: "finalized" }
  | { kind: "completed" }
  | { kind: "offer_expired"; stage: string | null }
  | { kind: "expired" }
  | { kind: "canceled" }
  | { kind: "withdrawn" }
  | { kind: "declined" }
  | { kind: "canceled_by_store"; reason: string | null }
  | { kind: "rejected"; reason: string | null }
  | { kind: "returned" }
  | { kind: "extended"; deadline: "list" | "confirmation" | "shipping" | "payment" }
  | { kind: "reinstated" }
  | { kind: "dispute_received" }
  | { kind: "message"; messageId: string; body: string }
  | { kind: "meetup_set" }
  | { kind: "reminder"; reminder: "list_due" | "revision_due" | "confirm_by" | "ship_by" | "payment_due" };

/** Emails the customer about their trade. Never throws. */
export async function sendTradeCustomerEmail(
  b: TradeBundle,
  settings: TradeSettingsRow,
  email: TradeCustomerEmail,
): Promise<Result> {
  try {
    return await buildAndSend(b, settings, email);
  } catch (err) {
    console.error("[tradeCenterEmails] couldn't build email", email.kind, b.trade.id, err);
    return { status: "failed", error: err instanceof Error ? err.message : String(err), deduped: false };
  }
}

const NO_PENALTY =
  "You'll never lose your deposit for declining an offer after your cards arrive, whatever the reason.";

function offerCardsOf(b: TradeBundle): TradeOfferCard[] {
  return b.offers.map((c) => ({
    id: c.id,
    scryfallId: c.scryfall_id,
    cardName: c.card_name,
    setCode: c.set_code,
    setName: c.set_name,
    collectorNumber: c.collector_number,
    finish: c.finish,
    imageUrl: c.image_url,
    quantity: c.quantity,
    reportedCondition: (c.reported_condition ?? "NM") as TradeOfferCard["reportedCondition"],
    customerEstimateCents: c.customer_estimate_cents,
    customerNote: c.customer_note,
    referencePriceCents: c.reference_price_cents,
    referenceCheckedAt: c.reference_checked_at,
    conditionPercent: c.condition_percent,
    estimatedUnitCents: c.estimated_unit_cents,
    eligibility: c.eligibility as TradeOfferCard["eligibility"],
    reviewStatus: c.review_status === "approved" || c.review_status === "rejected" ? c.review_status : "pending",
    approvedQuantity: c.approved_quantity,
    approvedUnitCents: c.approved_unit_cents,
    reviewNote: c.review_note,
    receivedQuantity: c.received_quantity,
    verifiedCondition: (c.verified_condition ?? null) as TradeOfferCard["verifiedCondition"],
    finalQuantity: c.final_quantity,
    finalUnitCents: c.final_unit_cents,
    flags: c.flags ?? [],
    inspectionNote: c.inspection_note,
    inspected: c.inspected_at !== null,
    disposition: "pending",
  }));
}

async function buildAndSend(b: TradeBundle, settings: TradeSettingsRow, email: TradeCustomerEmail): Promise<Result> {
  if (handoffOf(b.trade) === "local") {
    const local = await buildAndSendLocal(b, settings, email);
    if (local !== undefined) return local;
  }
  const t = b.trade;
  const label = tradeLabel(t.trade_number);
  const url = tradeUrl(t.id);
  const greet = hi(t.customer_name);
  const view = { href: url, label: "View your trade" };
  const deposit = paidDeposit(b);

  switch (email.kind) {
    case "submitted": {
      const blocked = b.offers.filter((c) => c.eligibility === "needs_review").length;
      return sendCustomer(b, settings, "trade_submitted", `trade-submitted-${t.id}-${t.submitted_at}`, `Trade ${label}: we got your trade`, {
        previewText: "We're reviewing your trade and will email you when we've decided.",
        heading: "We got your trade",
        paragraphs: [
          `${greet} thanks! We're reviewing trade ${label} and will email you as soon as we've decided.`,
          "Our cards aren't reserved yet, so they stay on sale while we review. Once we approve, you'll confirm your trade to reserve them.",
          "Please don't mail anything yet: we'll send the address and packing instructions once your cards are reserved.",
        ],
        quote: comparisonBlock(
          b,
          t.estimated_value_cents,
          "Your cards (estimated)",
          `Estimates use today's market prices, with each card's condition set from its age.${blocked > 0 ? ` ${blocked} card${blocked === 1 ? " has" : "s have"} no price yet.` : ""} We'll price your cards at TCG low when we review your trade, and check their condition when they arrive, so values can go up or down.`,
        ),
        button: view,
      });
    }

    case "revision_requested":
      return sendCustomer(b, settings, "trade_revision_requested", `trade-revision-${t.id}-${t.list_due_at}`, `Trade ${label}: a change is needed`, {
        previewText: "We need a change before we can approve your trade.",
        heading: "We need a change to your trade",
        paragraphs: [`${greet} we looked over trade ${label} and need a change before we can approve it:`],
        note: email.message,
        closing: [
          t.list_due_at
            ? `Update your trade and send it again by ${formatDeadline(t.list_due_at)}.`
            : "Update your trade and send it again.",
        ],
        button: { href: url, label: "Update your trade" },
      });

    case "cards_unavailable": {
      const lines = email.short.map((s) =>
        s.available > 0 ? `${s.card_name}: ${s.available} left of the ${s.wanted} you picked` : `${s.card_name}: sold`,
      );
      return sendCustomer(
        b,
        settings,
        "trade_cards_unavailable",
        `trade-unavailable-${t.id}-${t.list_due_at ?? t.updated_at}`,
        `Trade ${label}: some of our cards sold`,
        {
          previewText: "Update your selection and send the trade again.",
          heading: "Some of our cards sold before your trade was confirmed",
          paragraphs: [
            `${greet} our cards stay on sale until a trade is confirmed, and some on trade ${label} sold in the meantime, so we can't reserve your trade as it was approved.`,
            email.refund
              ? `Nothing was reserved, and your ${money(deposit)} deposit is being refunded in full.`
              : "Nothing was reserved or charged.",
            "Update which of our cards you'd like and send the trade again. We'll review it right away.",
          ],
          lists: [{ title: "No longer available", items: lines.slice(0, MAX_EMAIL_CARDS) }],
          button: { href: url, label: "Update your trade" },
        },
      );
    }

    case "approved": {
      const approved = b.offers.filter((c) => c.review_status === "approved" && (c.approved_quantity ?? 0) > 0);
      const rejected = b.offers.filter((c) => c.review_status === "rejected");
      const value = t.approved_value_cents ?? 0;
      const credit = tradeCreditCents(value, t.credit_rate_percent, t.processing_fee_cents);
      const confirmBy = t.confirm_by ? formatDeadline(t.confirm_by) : null;
      return sendCustomer(b, settings, "trade_approved", `trade-approved-${t.id}-${t.approved_at}`, `Trade ${label} is approved: confirm by ${confirmBy ?? "soon"}`, {
        previewText: confirmBy ? `Confirm your trade by ${confirmBy} to reserve our cards.` : "Confirm your trade to reserve our cards.",
        heading: "Your trade is approved",
        paragraphs: [
          `${greet} good news: we've approved trade ${label}. We priced your cards at TCG low: ${money(value)}, or ${money(credit)} in trade credit. When they arrive we check each card's condition, so the final value can go up or down.`,
          confirmBy
            ? `You have until ${confirmBy} to confirm it: ${hoursPhrase(settings.confirmation_hours)}, not counting Sundays. If it isn't confirmed by then, the approval expires.`
            : "Confirm it on your trade page to reserve our cards.",
          t.deposit_cents > 0
            ? `Confirming takes a refundable ${money(t.deposit_cents)} deposit. It's refunded in full once the carrier accepts your package by your shipping deadline, and you never lose it for declining an offer after your cards arrive.`
            : "No deposit is needed for this trade.",
          "Until you confirm, our cards stay on sale. If one sells first, we'll let you know and you can update your trade.",
        ],
        note: t.approval_conditions ? `Approved on this condition: ${t.approval_conditions}` : null,
        rows: clipRows(
          approved.map((c) => ({
            label: `${c.approved_quantity} × ${offerName(c)}`,
            value: money((c.approved_quantity ?? 0) * (c.approved_unit_cents ?? 0)),
          })),
          (n) => ({ label: `And ${n} more on your trade page`, value: "" }),
        ),
        lists:
          rejected.length > 0
            ? [{ title: "Not part of this trade", items: rejected.slice(0, MAX_EMAIL_CARDS).map((c) => `${offerName(c)}${c.review_note ? `: ${c.review_note}` : ""}`) }]
            : [],
        button: { href: url, label: t.deposit_cents > 0 ? "Confirm and pay the deposit" : "Confirm your trade" },
      });
    }

    case "reserved": {
      const shipBy = t.ship_by ? formatDeadline(t.ship_by) : null;
      const address = mailToBlock(settings);
      const rejected = b.offers.filter((c) => c.review_status === "rejected");
      return sendCustomer(b, settings, "trade_reserved", `trade-reserved-${t.id}-${t.reserved_at}`, `Trade ${label}: our cards are reserved. Ship by ${shipBy ?? "your deadline"}`, {
        previewText: shipBy ? `Ship your cards by ${shipBy}. Here's where and how.` : "Here's where and how to ship your cards.",
        heading: "Our cards are reserved for you",
        paragraphs: [
          `${greet} trade ${label} is confirmed${t.deposit_status === "paid" ? ` and your ${money(deposit)} deposit is paid` : ""}. Our cards are reserved for you and off the shelf.`,
          shipBy
            ? `Ship your cards by ${shipBy}: ${daysPhrase(t.ship_days ?? settings.ship_days_new)}, not counting Sundays. Your shipment counts once the carrier scans your package, so drop it off with time to spare; a label on its own doesn't count.`
            : "Ship your cards soon. Your shipment counts once the carrier scans your package.",
          "Then add the tracking number on your trade page.",
          ...(t.deposit_status === "paid"
            ? [`Your deposit is refunded in full as soon as the carrier accepts your package in time. ${NO_PENALTY}`]
            : []),
        ],
        address,
        lists: [
          {
            title: "Packing your cards",
            items: [
              ...PACKING_CHECKLIST,
              settings.packing_instructions,
              `Put a slip of paper with your trade ID, ${label}, inside the package.`,
              settings.shipping_paid_by === "store"
                ? "We cover shipping your cards to us: reply to this email before you ship and we'll arrange it."
                : "You buy the shipping label for your cards to us. Every trade shipment needs tracking.",
              ...(rejected.length > 0 ? [`Leave out the ${rejected.length === 1 ? "card" : `${rejected.length} cards`} we didn't approve (marked on your trade page).`] : []),
            ],
          },
        ],
        button: { href: url, label: "Add your tracking number" },
        closing: [`${PROTECT_YOUR_CARDS.paragraphs[2]} ${PROTECT_YOUR_CARDS.damage}`],
      });
    }

    case "tracking_added":
      return sendCustomer(b, settings, "trade_tracking_added", `trade-tracking-${t.id}-${t.inbound_tracking}`, `Trade ${label}: tracking number received`, {
        previewText: "Your shipment counts once the carrier scans your package.",
        heading: "Thanks, we'll watch for your package",
        paragraphs: [
          `${greet} we've got the tracking number for trade ${label}.`,
          t.ship_by
            ? `Your shipment counts once the carrier scans the package, which has to happen by ${formatDeadline(t.ship_by)}. We'll email you when it does.`
            : "Your shipment counts once the carrier scans the package. We'll email you when it does.",
        ],
        rows: [
          ...(t.inbound_carrier ? [{ label: "Carrier", value: t.inbound_carrier }] : []),
          { label: "Tracking number", value: t.inbound_tracking ?? "" },
        ],
        button: view,
      });

    case "no_scan_yet":
      return sendCustomer(b, settings, "trade_no_scan_yet", `trade-no-scan-${t.id}-${t.ship_by}`, `Trade ${label}: no carrier scan yet`, {
        previewText: "If you shipped in time, send us your receipt.",
        heading: "We haven't seen a carrier scan yet",
        paragraphs: [
          `${greet} your shipping deadline for trade ${label} was ${t.ship_by ? formatDeadline(t.ship_by) : "today"}, and the carrier hasn't scanned your package yet.`,
          "Carriers sometimes scan a package late. If you dropped it off in time, send us your receipt or a photo of the drop-off on your trade page and we'll look at it before anything happens to your reservation or deposit.",
        ],
        button: { href: url, label: "Send proof of shipping" },
      });

    case "shipment_verified": {
      const refunding = t.deposit_status === "refund_pending" || t.deposit_status === "refunded";
      return sendCustomer(b, settings, "trade_shipment_verified", `trade-verified-${t.id}-${t.inbound_accepted_at}`, `Trade ${label}: your package is on its way`, {
        previewText: refunding ? `Shipment verified. Your ${money(deposit)} deposit refund has started.` : "Shipment verified. We'll email you when it arrives.",
        heading: "Shipment verified",
        paragraphs: [
          `${greet} the carrier accepted your package for trade ${label}${t.inbound_accepted_at ? ` on ${formatDeadline(t.inbound_accepted_at)}` : ""}, in time. Our cards stay reserved for you while it travels, however long the carrier takes.`,
          ...(refunding
            ? [`We've started refunding your ${money(deposit)} deposit in full. We'll email you again once the card network confirms it; your bank may take 5 to 10 business days to show it.`]
            : []),
          "We'll email you when your cards arrive and again once we've inspected them.",
        ],
        rows: t.inbound_tracking
          ? [
              ...(t.inbound_carrier ? [{ label: "Carrier", value: t.inbound_carrier }] : []),
              { label: "Tracking number", value: t.inbound_tracking },
            ]
          : [],
        button: trackingUrlFor(t.inbound_carrier, t.inbound_tracking)
          ? { href: trackingUrlFor(t.inbound_carrier, t.inbound_tracking) as string, label: "Track your package" }
          : view,
      });
    }

    case "deposit_refund_started": {
      const why: Record<DepositRefundReason, string> = {
        store_canceled: "we canceled the trade",
        declined: "you declined the final offer",
        withdrawn: "you canceled after shipping",
        staff: "we reviewed it",
        conflict: "some of our cards sold before your deposit went through",
        unusable: "the trade could no longer use it",
        dispute: "we accepted your proof of shipping",
      };
      return sendCustomer(
        b,
        settings,
        "trade_deposit_refund_started",
        `trade-dep-refund-start-${t.id}-${t.deposit_refund_attempts}-${t.deposit_payment_intent ?? ""}`,
        `Trade ${label}: your ${money(deposit)} deposit is being refunded`,
        {
          previewText: "We've started a full refund of your deposit.",
          heading: "Your deposit refund has started",
          paragraphs: [
            `${greet} we've started a full refund of your ${money(deposit)} deposit for trade ${label}, because ${why[email.why]}.`,
            "We'll email you again once the card network confirms it. Your bank may take 5 to 10 business days to show it.",
          ],
          button: view,
        },
      );
    }

    case "deposit_refunded":
      return sendCustomer(b, settings, "trade_deposit_refunded", `trade-dep-refunded-${t.id}-${t.deposit_refund_id ?? t.deposit_refunded_at}`, `Trade ${label}: deposit refunded`, {
        previewText: `Your ${money(deposit)} deposit was refunded in full.`,
        heading: "Your deposit was refunded",
        paragraphs: [
          `${greet} the refund of your ${money(deposit)} deposit for trade ${label} has gone through, in full, to the card you paid with.`,
          "Depending on your bank it can take 5 to 10 business days to show on your statement.",
        ],
        button: view,
      });

    case "deposit_kept":
      return sendCustomer(b, settings, "trade_deposit_kept", `trade-dep-kept-${t.id}`, `Trade ${label}: about your deposit`, {
        previewText: "We reviewed your deposit under the cancellation terms.",
        heading: "About your deposit",
        paragraphs: [
          `${greet} we reviewed trade ${label}. Because ${t.customer_fault === "canceled_while_reserved" ? "it was canceled after our cards were reserved and before your cards shipped" : "your cards weren't shipped by the deadline"}, we've kept your ${money(deposit)} deposit under the cancellation terms you agreed to when you confirmed the trade.`,
          "If you think we got this wrong, reply to this email and we'll take another look.",
        ],
        note: t.deposit_decision_note,
        button: view,
      });

    case "delivered":
      return sendCustomer(b, settings, "trade_delivered", `trade-delivered-${t.id}`, `Trade ${label}: your cards arrived`, {
        previewText: "We'll inspect your cards next.",
        heading: "Your cards arrived",
        paragraphs: [`${greet} the carrier delivered your package for trade ${label}. We'll inspect your cards next and email you our final offer.`],
        button: view,
      });

    case "received":
      return sendCustomer(b, settings, "trade_received", `trade-received-${t.id}`, `Trade ${label}: your cards arrived`, {
        previewText: "We'll inspect your cards next.",
        heading: "Your cards arrived",
        paragraphs: [
          `${greet} your package for trade ${label} arrived. We'll inspect your cards next and email you our final offer.`,
          ...(t.deposit_status === "refund_pending" ? [`Your ${money(deposit)} deposit is being refunded in full.`] : []),
        ],
        button: view,
      });

    case "final_offer": {
      const value = t.final_value_cents ?? 0;
      const approved = t.approved_value_cents ?? 0;
      const changes = offerChanges(offerCardsOf(b));
      const cash = t.excess_handling === "cash" && t.cash_payout_cents ? t.cash_payout_cents : null;
      return sendCustomer(b, settings, "trade_final_offer", `trade-final-offer-${t.id}-${t.final_offer_at}`, `Trade ${label}: inspection done, your final offer is ready`, {
        previewText: changes.length > 0 ? "A few things changed. Review your final offer." : "Everything matched. Review your final offer.",
        heading: changes.length > 0 ? "Your revised offer is ready" : "Your final offer is ready",
        paragraphs: [
          `${greet} we've finished inspecting your cards for trade ${label}.`,
          changes.length > 0
            ? `A few things changed from the ${money(approved)} we approved before you shipped; each change and its reason is listed below. Your cards are now valued at ${money(value)}.`
            : `Everything matched what we approved: your cards are valued at ${money(value)}.`,
        ],
        quote: comparisonBlock(
          b,
          value,
          "Your cards (final value)",
          cash ? `Instead of store credit for what's left over, we'll pay you ${money(cash)} in cash.` : null,
        ),
        lists:
          changes.length > 0
            ? [
                {
                  title: "What changed",
                  items: changes.slice(0, MAX_EMAIL_CARDS).map((c) => {
                    const diff = c.differenceCents === 0 ? "" : ` (${c.differenceCents > 0 ? "+" : "−"}${money(Math.abs(c.differenceCents))})`;
                    const what = c.finalQuantity === 0 ? "not accepted" : c.finalQuantity !== c.approvedQuantity ? `${c.finalQuantity} of ${c.approvedQuantity} accepted, ${money(c.finalUnitCents)} each` : `${money(c.finalUnitCents)} each (was ${money(c.approvedUnitCents)})`;
                    return `${c.cardName}: ${what}${diff}.${c.reasons.length ? ` ${c.reasons.join(". ")}.` : ""}`;
                  }),
                },
              ]
            : [],
        button: { href: url, label: "Review your final offer" },
        closing: [
          `Accept it, ask for an adjustment, or decline it on your trade page. Nothing is final until you accept. ${NO_PENALTY}`,
          settings.return_policy,
        ],
      });
    }

    case "awaiting_payment": {
      const due = t.amount_due_cents ?? 0;
      const shipping = t.shipping_cents ?? 0;
      const cards = Math.max(due - shipping, 0);
      return sendCustomer(b, settings, "trade_awaiting_payment", `trade-awaiting-payment-${t.id}-${t.accepted_at}`, `Trade ${label}: pay ${money(due)} to finish`, {
        previewText: "Pay by card to finish your trade.",
        heading: "One last step: pay by card",
        paragraphs: [
          `${greet} you accepted the final offer for trade ${label}. Your trade credit covers ${cards > 0 ? `${money(Math.min(t.final_credit_cents ?? 0, t.wanted_total_cents))} of our cards` : "our cards"}; ${money(due)} is due by card${t.payment_due_at ? ` by ${formatDeadline(t.payment_due_at)}` : ""}.`,
          "Pay on your trade page and we'll pack your new cards right away.",
        ],
        rows: [
          ...(cards > 0 ? [{ label: "Left to pay for our cards", value: money(cards) }] : []),
          { label: "Shipping our cards to you", value: shipping === 0 ? "Free" : money(shipping) },
          { label: "To pay by card", value: money(due) },
        ],
        button: { href: url, label: `Pay ${money(due)}` },
      });
    }

    case "finalized": {
      const issued = t.credit_issued_cents ?? 0;
      const due = t.amount_due_cents ?? 0;
      const excess = t.excess_cents ?? 0;
      const cash = t.excess_handling === "cash" ? (t.cash_payout_cents ?? 0) : 0;
      const orderNumber = t.order_id ? `GG-${t.order_id.slice(0, 8).toUpperCase()}` : null;
      // Credit covers our cards only; shipping was paid by card.
      const spent = Math.min(t.final_credit_cents ?? 0, t.wanted_total_cents);
      return sendCustomer(b, settings, "trade_finalized", `trade-finalized-${t.id}`, `Trade ${label}: final trade approved`, {
        previewText: "Your new cards are being packed.",
        heading: "Your trade is final",
        paragraphs: [`${greet} thanks for trading with us! Here's how trade ${label} settled.`],
        rows: [
          { label: "Trade credit issued", value: money(issued) },
          { label: "Used on your order", value: money(Math.max(spent, 0)) },
          ...(due > 0 ? [{ label: "Paid by card", value: money(due) }] : []),
          ...(cash > 0
            ? [{ label: "Cash for the credit left over", value: money(cash) }]
            : excess > 0
              ? [{ label: "Store credit left for you", value: money(excess) }]
              : []),
          ...(orderNumber ? [{ label: "Order", value: orderNumber }] : []),
        ],
        closing: [
          "We're packing your new cards now and will email the tracking number when they ship.",
          ...(cash > 0 ? [`We'll be in touch to pay you the ${money(cash)} in cash.`] : []),
          ...(excess > 0 && cash === 0 ? ["Your store credit is in your account, ready for your next order."] : []),
        ],
        button: t.order_id ? { href: `${siteUrl()}/account/orders/${t.order_id}`, label: "View your order" } : view,
      });
    }

    case "completed":
      return sendCustomer(b, settings, "trade_completed", `trade-completed-${t.id}`, `Trade ${label} is complete`, {
        previewText: "Your new cards are on their way.",
        heading: "Trade complete",
        paragraphs: [
          `${greet} your new cards from trade ${label} have shipped, so the trade is complete. Thanks for trading with Geega Games!`,
          "Your order's tracking number is in your account. We'd love to trade with you again.",
        ],
        button: t.order_id ? { href: `${siteUrl()}/account/orders/${t.order_id}`, label: "Track your order" } : view,
      });

    case "offer_expired": {
      const why =
        email.stage === "confirmation" || email.stage === "deposit"
          ? "the approved trade wasn't confirmed in time"
          : email.stage === "revision"
            ? "the changes weren't sent in time"
            : "the trade wasn't sent in time";
      return sendCustomer(b, settings, "trade_offer_expired", `trade-offer-expired-${t.id}`, `Trade ${label} has closed`, {
        previewText: "Nothing was reserved or charged.",
        heading: "Your trade has closed",
        paragraphs: [
          `${greet} trade ${label} closed because ${why}. Nothing was reserved or charged.`,
          "If you'd still like to trade, start a new one: our cards may still be available.",
        ],
        button: view,
      });
    }

    case "expired": {
      const due = Date.parse(t.closed_at ?? new Date().toISOString()) + settings.dispute_window_days * 86_400_000;
      return sendCustomer(b, settings, "trade_reservation_expired", `trade-expired-${t.id}-${t.closed_at}`, `Trade ${label}: your reservation expired`, {
        previewText: "If you shipped in time, send us proof.",
        heading: "Your reservation expired",
        paragraphs: [
          t.expired_stage === "scan"
            ? `${greet} the carrier never scanned a package for trade ${label}, so your reservation expired at the end of the grace period after your shipping deadline${t.ship_by ? ` (${formatDeadline(t.ship_by)})` : ""}, and our cards are back on sale.`
            : `${greet} we didn't get a shipment for trade ${label} by your shipping deadline${t.ship_by ? `, ${formatDeadline(t.ship_by)}` : ""}, so your reservation expired and our cards are back on sale.`,
          t.deposit_status === "forfeiture_review"
            ? `Your ${money(deposit)} deposit hasn't been kept: a person reviews every case first, under the terms you agreed to.`
            : "No deposit was involved.",
          `Did you ship in time? Send your receipt or proof of drop-off on your trade page by ${formatDeadline(new Date(due).toISOString())}, or reply to this email. If your package is on its way, we'll either reinstate the trade or mail your cards back.`,
        ],
        button: { href: url, label: "Send proof of shipping" },
      });
    }

    case "canceled":
      return sendCustomer(b, settings, "trade_canceled", `trade-canceled-${t.id}`, `Trade ${label} is canceled`, {
        previewText: "Your trade is canceled.",
        heading: "Your trade is canceled",
        paragraphs: [
          `${greet} as you asked, we've canceled trade ${label}.`,
          t.reserved_at ? "We've released the reservation on our cards." : "Nothing of ours was reserved.",
          ...(t.deposit_status === "forfeiture_review"
            ? [`Because the trade was canceled after our cards were reserved, your ${money(deposit)} deposit may be kept under the cancellation terms. A person reviews it first, and we'll email you either way.`]
            : []),
        ],
        button: view,
      });

    case "withdrawn":
      return sendCustomer(b, settings, "trade_withdrawn", `trade-withdrawn-${t.id}`, `Trade ${label} is canceled: no penalty`, {
        previewText: "We'll mail your cards back.",
        heading: "Your trade is canceled, with no penalty",
        paragraphs: [
          `${greet} as you asked, we've canceled trade ${label}. You shipped in time, so there's no penalty.`,
          ...(t.deposit_cents > 0 || (t.deposit_paid_cents ?? 0) > 0 ? [`Your ${money(deposit)} deposit is refunded in full.`] : []),
          "We'll mail your cards back and email you the tracking number.",
        ],
        closing: [settings.return_policy],
        button: view,
      });

    case "declined":
      return sendCustomer(b, settings, "trade_declined", `trade-declined-${t.id}`, `Trade ${label}: declined, no penalty`, {
        previewText: "We'll mail your cards back.",
        heading: "Declined after inspection: no penalty",
        paragraphs: [
          `${greet} we've recorded that you declined the final offer for trade ${label}. That's completely fine, and there's no penalty.`,
          ...((t.deposit_paid_cents ?? 0) > 0 ? [`Your ${money(deposit)} deposit is refunded in full.`] : []),
          "We'll mail your cards back and email you the tracking number.",
        ],
        closing: [settings.return_policy],
        button: view,
      });

    case "canceled_by_store":
      return sendCustomer(b, settings, "trade_canceled_by_store", `trade-store-canceled-${t.id}`, `Trade ${label} was canceled by Geega Games`, {
        previewText: "Any deposit is refunded in full.",
        heading: "We canceled your trade",
        paragraphs: [`${greet} we're sorry, but we had to cancel trade ${label}.`],
        note: email.reason,
        closing: [
          ...((t.deposit_paid_cents ?? 0) > 0 ? [`Your ${money(deposit)} deposit is refunded in full.`] : []),
          ...(t.return_status === "pending" ? ["We'll mail your cards back and email you the tracking number."] : []),
          "This doesn't count against you in any way.",
        ],
        button: view,
      });

    case "rejected":
      return sendCustomer(b, settings, "trade_rejected", `trade-rejected-${t.id}-${t.closed_at ?? t.updated_at}`, `Trade ${label} wasn't accepted`, {
        previewText: "We couldn't accept this trade.",
        heading: "We couldn't accept this trade",
        paragraphs: [`${greet} we're sorry, but we can't accept trade ${label}.`],
        note: email.reason,
        closing: ["Nothing was reserved or charged. You're welcome to start a new trade anytime."],
        button: view,
      });

    case "returned":
      return sendCustomer(b, settings, "trade_returned", `trade-returned-${t.id}-${t.return_tracking ?? t.returned_at}`, `Trade ${label}: your cards are on the way back`, {
        previewText: "Your cards are on their way back to you.",
        heading: "Your cards are on the way back",
        paragraphs: [
          t.status === "approved_for_fulfillment" || t.status === "completed"
            ? `${greet} we've mailed the cards we didn't take from trade ${label} back to you.`
            : `${greet} we've mailed your cards from trade ${label} back to you.`,
        ],
        rows: t.return_tracking
          ? [
              ...(t.return_carrier ? [{ label: "Carrier", value: t.return_carrier }] : []),
              { label: "Tracking number", value: t.return_tracking },
            ]
          : [],
        button: view,
      });

    case "extended": {
      const at =
        email.deadline === "confirmation" ? t.confirm_by : email.deadline === "shipping" ? t.ship_by : email.deadline === "payment" ? t.payment_due_at : t.list_due_at;
      const what =
        email.deadline === "confirmation" ? "confirm your trade" : email.deadline === "shipping" ? "ship your cards" : email.deadline === "payment" ? "pay" : "send your trade";
      return sendCustomer(b, settings, "trade_extended", `trade-extended-${t.id}-${email.deadline}-${at}`, `Trade ${label}: more time`, {
        previewText: at ? `You now have until ${formatDeadline(at)}.` : "We gave you more time.",
        heading: "We gave you more time",
        paragraphs: [`${greet} you now have until ${at ? formatDeadline(at) : "later"} to ${what} for trade ${label}.`],
        button: view,
      });
    }

    case "reinstated":
      return sendCustomer(b, settings, "trade_reinstated", `trade-reinstated-${t.id}-${t.updated_at}`, `Trade ${label} is back on`, {
        previewText: "We reinstated your reservation.",
        heading: "Your reservation is reinstated",
        paragraphs: [
          `${greet} we've reinstated trade ${label}: our cards are reserved for you again.`,
          t.status === "awaiting_shipment" && t.ship_by
            ? `Your new shipping deadline is ${formatDeadline(t.ship_by)}.`
            : "Your shipment is verified, so you're all set; we'll email you when your cards arrive.",
          ...(t.deposit_status === "refund_pending" ? [`Your ${money(deposit)} deposit is being refunded in full.`] : []),
        ],
        button: view,
      });

    case "dispute_received":
      return sendCustomer(b, settings, "trade_dispute_received", `trade-dispute-${t.id}-${b.disputes.at(-1)?.id ?? ""}`, `Trade ${label}: we got your proof of shipping`, {
        previewText: "A person will look at it.",
        heading: "We got your proof of shipping",
        paragraphs: [
          `${greet} thanks. A person will look at it shortly. While we do, your reservation won't expire and your deposit won't be touched.`,
        ],
        button: view,
      });

    case "message":
      return sendCustomer(b, settings, "trade_message", `trade-message-${email.messageId}`, `Trade ${label}: a message from Geega Games`, {
        previewText: email.body.slice(0, 120),
        heading: "A message about your trade",
        paragraphs: [`${greet} here's a message from us about trade ${label}:`],
        note: email.body,
        button: { href: url, label: "Reply on your trade page" },
      });

    case "meetup_set":
      // Only local pickup trades have a meetup (buildAndSendLocal).
      return { status: "skipped", reason: "not-local" };

    case "reminder": {
      const r = email.reminder;
      if (r === "list_due" || r === "revision_due") {
        if (!t.list_due_at) return { status: "skipped", reason: "no-deadline" };
        return sendCustomer(b, settings, `trade_reminder_${r}`, `trade-reminder-${r}-${t.id}-${t.list_due_at}`, `Trade ${label}: send it by ${formatDeadline(t.list_due_at)}`, {
          previewText: `Send your ${r === "list_due" ? "trade" : "changes"} by ${formatDeadline(t.list_due_at)}.`,
          heading: r === "list_due" ? "Your trade isn't sent yet" : "Your changes are due soon",
          paragraphs: [
            r === "list_due"
              ? `${greet} trade ${label} is still a draft. Send it for review by ${formatDeadline(t.list_due_at)} or it closes.`
              : `${greet} make the change we asked for on trade ${label} and send it again by ${formatDeadline(t.list_due_at)}, or it closes.`,
          ],
          button: { href: url, label: "Finish your trade" },
        });
      }
      if (r === "confirm_by") {
        if (!t.confirm_by) return { status: "skipped", reason: "no-deadline" };
        return sendCustomer(b, settings, "trade_reminder_confirm_by", `trade-reminder-confirm-${t.id}-${t.confirm_by}`, `Trade ${label}: confirm by ${formatDeadline(t.confirm_by)}`, {
          previewText: "Your approval expires if it isn't confirmed.",
          heading: "Confirm your trade soon",
          paragraphs: [
            `${greet} trade ${label} is approved and waiting for you. Confirm it by ${formatDeadline(t.confirm_by)} to reserve our cards, or the approval expires.`,
            t.deposit_cents > 0 ? `Confirming takes a refundable ${money(t.deposit_cents)} deposit.` : "No deposit is needed.",
          ],
          button: { href: url, label: "Confirm your trade" },
        });
      }
      if (r === "ship_by") {
        if (!t.ship_by) return { status: "skipped", reason: "no-deadline" };
        return sendCustomer(b, settings, "trade_reminder_ship_by", `trade-reminder-ship-${t.id}-${t.ship_by}`, `Trade ${label}: ship by ${formatDeadline(t.ship_by)}`, {
          previewText: "The carrier has to scan your package by then.",
          heading: "Time to ship your cards",
          paragraphs: [
            `${greet} please ship your cards for trade ${label} so the carrier scans the package by ${formatDeadline(t.ship_by)}. A label on its own doesn't count.`,
            "Already shipped? Add the tracking number on your trade page.",
          ],
          button: { href: url, label: "Add your tracking number" },
        });
      }
      if (!t.payment_due_at || !t.amount_due_cents) return { status: "skipped", reason: "no-deadline" };
      return sendCustomer(b, settings, "trade_reminder_payment_due", `trade-reminder-payment-${t.id}-${t.payment_due_at}`, `Trade ${label}: ${money(t.amount_due_cents)} due ${formatDeadline(t.payment_due_at)}`, {
        previewText: "Pay the difference to finish your trade.",
        heading: "Your payment is due soon",
        paragraphs: [
          `${greet} the remaining ${money(t.amount_due_cents)} for trade ${label} is due ${formatDeadline(t.payment_due_at)}.`,
          "Pay by card on your trade page. Changed your mind? You can decline there instead, with no penalty, and we'll return your cards.",
        ],
        button: { href: url, label: `Pay ${money(t.amount_due_cents)}` },
      });
    }
  }
}

/** Where to meet, when staff have written it. */
function meetupNote(b: TradeBundle): string | null {
  return b.trade.meetup_details ? `Where and when to meet: ${b.trade.meetup_details}` : null;
}

/**
 * A local pickup trade's emails, where they differ from a shipped one's:
 * nothing to list, mail or track, and the trade settles when we meet.
 * undefined: the shipped trade's email reads right as it is.
 */
async function buildAndSendLocal(b: TradeBundle, settings: TradeSettingsRow, email: TradeCustomerEmail): Promise<Result | undefined> {
  const t = b.trade;
  const label = tradeLabel(t.trade_number);
  const url = tradeUrl(t.id);
  const greet = hi(t.customer_name);
  const view = { href: url, label: "View your trade" };
  const area = settings.local_pickup_area;
  const credit = `${t.credit_rate_percent}%`;
  // Where we meet, when a spot is saved (the trade's meetup details can say otherwise).
  const spot = meetSpotText(settings);
  const spotRows = spot ? [{ label: "Meeting spot", value: spot }] : [];

  switch (email.kind) {
    case "submitted":
      return sendCustomer(b, settings, "trade_submitted", `trade-submitted-${t.id}-${t.submitted_at}`, `Trade ${label}: we got your trade`, {
        previewText: "We're reviewing your local pickup trade and will email you when we've decided.",
        heading: "We got your trade",
        paragraphs: [
          `${greet} thanks! We're reviewing trade ${label}, a local pickup in ${area}, and will email you as soon as we've decided.`,
          "Our cards aren't reserved yet, so they stay on sale while we review. Once we approve, we hold them for you until we meet.",
          `Bring the cards you're trading in when we meet: we'll value each one at its TCG low for the condition we see, and ${credit} of that is your trade credit toward our cards.`,
        ],
        rows: [{ label: "Our cards", value: money(t.wanted_total_cents) }],
        button: view,
      });

    case "approved": {
      // A trade approved before holds started at approval still waits for the customer to confirm it.
      if (t.status === "awaiting_confirmation") {
        const confirmBy = t.confirm_by ? formatDeadline(t.confirm_by) : null;
        return sendCustomer(b, settings, "trade_approved", `trade-approved-${t.id}-${t.approved_at}`, `Trade ${label} is approved: confirm by ${confirmBy ?? "soon"}`, {
          previewText: confirmBy ? `Confirm your trade by ${confirmBy} to reserve our cards until we meet.` : "Confirm your trade to reserve our cards.",
          heading: "Your trade is approved",
          paragraphs: [
            `${greet} good news: we've approved trade ${label}, a local pickup in ${area}.`,
            confirmBy ? `Confirm it by ${confirmBy} on your trade page to hold our cards until we meet. There's no deposit.` : "Confirm it on your trade page to hold our cards until we meet.",
          ],
          note: [meetupNote(b), t.approval_conditions ? `Approved on this condition: ${t.approval_conditions}` : null].filter(Boolean).join("\n\n") || null,
          rows: [{ label: "Our cards", value: money(t.wanted_total_cents) }, ...spotRows],
          button: { href: url, label: "Confirm your trade" },
        });
      }
      return sendCustomer(b, settings, "trade_approved", `trade-approved-${t.id}-${t.approved_at}`, `Trade ${label} is approved: our cards are held for you`, {
        previewText: "We've approved your trade and are holding our cards for you until we meet.",
        heading: "Your trade is approved",
        paragraphs: [
          `${greet} good news: we've approved trade ${label}, a local pickup in ${area}. Our cards are off the shelf and held for you until we meet. There's no deposit.`,
          t.meetup_details
            ? "Here's where and when we'll meet. Need a different time? Reply on your trade page."
            : spot
              ? `We'll message you on your trade page to set a time to meet at our meeting spot, ${spot}. Reply there with times that work for you.`
              : "We'll message you on your trade page to set a time and a public place to meet. Reply there with times that work for you.",
          `Bring the cards you're trading in. We'll value each one at its TCG low for the condition we see, and ${credit} of that is your credit toward our cards. Anything it doesn't cover is paid when we meet, in cash or by card; credit left over stays in your account.`,
          "Changed your mind about any of our cards? Tell us on your trade page and we'll take them off. Can't make it? Cancel your trade so we can put our cards back on sale. Canceling costs nothing.",
        ],
        note: [meetupNote(b) ?? settings.local_pickup_details, t.approval_conditions ? `Approved on this condition: ${t.approval_conditions}` : null].filter(Boolean).join("\n\n") || null,
        rows: [{ label: "Our cards", value: money(t.wanted_total_cents) }, ...spotRows],
        button: { href: url, label: "Message us about the meetup" },
      });
    }

    case "reserved": {
      // Only a trade approved under the old flow is confirmed by the customer; held until we meet, with no deadline.
      return sendCustomer(b, settings, "trade_reserved", `trade-reserved-${t.id}-${t.reserved_at}`, `Trade ${label}: our cards are reserved. Let's meet up`, {
        previewText: "Our cards are held for you until we meet.",
        heading: "Our cards are reserved for you",
        paragraphs: [
          `${greet} trade ${label} is confirmed. Our cards are reserved for you and off the shelf until we meet.`,
          t.meetup_details
            ? "Here's where and when we'll meet. Need a different time? Reply on your trade page."
            : spot
              ? `We'll message you on your trade page to set a time to meet at our meeting spot, ${spot}. Reply there with times that work for you.`
              : "We'll message you on your trade page to set a time and a public place to meet. Reply there with times that work for you.",
          `Bring the cards you're trading in. We'll value each one at its TCG low for the condition we see, and ${credit} of that is your credit toward our cards. Anything it doesn't cover is paid when we meet, in cash or by card; credit left over stays in your account.`,
        ],
        note: meetupNote(b) ?? settings.local_pickup_details,
        rows: spotRows,
        button: { href: url, label: "Message us about the meetup" },
      });
    }

    case "meetup_set":
      if (!t.meetup_details) return { status: "skipped", reason: "no-meetup" };
      return sendCustomer(
        b,
        settings,
        "trade_meetup_set",
        `trade-meetup-${t.id}-${crypto.createHash("sha256").update(t.meetup_details).digest("hex").slice(0, 12)}`,
        `Trade ${label}: where and when we'll meet`,
        {
          previewText: t.meetup_details.slice(0, 120),
          heading: "Where and when we'll meet",
          paragraphs: [`${greet} here are the meetup details for trade ${label}:`],
          note: t.meetup_details,
          closing: [
            "Bring the cards you're trading in. Need a different time or place? Reply on your trade page.",
            ...(t.status === "awaiting_confirmation" && t.confirm_by
              ? [`Remember to confirm your trade by ${formatDeadline(t.confirm_by)} so we hold our cards for you.`]
              : []),
          ],
          button: { href: url, label: "Reply on your trade page" },
        },
      );

    case "completed": {
      const value = t.final_value_cents ?? 0;
      const issued = t.credit_issued_cents ?? 0;
      const spent = Math.min(t.final_credit_cents ?? 0, t.wanted_total_cents);
      const paid = t.local_paid_cents ?? t.amount_due_cents ?? 0;
      const excess = t.excess_cents ?? 0;
      const cash = t.excess_handling === "cash" ? (t.cash_payout_cents ?? 0) : 0;
      const method = t.local_payment_method && t.local_payment_method !== "none" ? LOCAL_PAYMENT_LABELS[t.local_payment_method as keyof typeof LOCAL_PAYMENT_LABELS] : null;
      const taken = b.offers.filter((c) => (c.final_quantity ?? 0) > 0);
      return sendCustomer(b, settings, "trade_completed", `trade-completed-${t.id}`, `Trade ${label} is complete`, {
        previewText: "Thanks for trading with us! Here's how your trade settled.",
        heading: "Trade complete",
        paragraphs: [`${greet} thanks for meeting up and trading with Geega Games! Here's how trade ${label} settled.`],
        rows: [
          { label: "Our cards (you picked them up)", value: money(t.wanted_total_cents) },
          { label: "Your cards we took", value: money(value) },
          { label: `Trade credit at ${credit}`, value: money(issued) },
          { label: "Used on our cards", value: money(Math.max(spent, 0)) },
          ...(paid > 0 ? [{ label: `Paid when we met${method ? ` (${method.toLowerCase()})` : ""}`, value: money(paid) }] : []),
          ...(cash > 0
            ? [{ label: "Cash for the credit left over", value: money(cash) }]
            : excess > 0
              ? [{ label: "Store credit left for you", value: money(excess) }]
              : []),
        ],
        lists:
          taken.length > 0
            ? [
                {
                  title: "Your cards we took",
                  items: taken
                    .slice(0, MAX_EMAIL_CARDS)
                    .map((c) => `${c.final_quantity} × ${offerName(c)}: ${money((c.final_quantity ?? 0) * (c.final_unit_cents ?? 0))}`),
                },
              ]
            : [],
        closing: [
          ...(excess > 0 && cash === 0 ? ["Your store credit is in your account, ready for your next order."] : []),
          "We'd love to trade with you again.",
        ],
        button: view,
      });
    }

    case "expired":
      // A local trade's hold doesn't run out on its own any more: this is staff letting it go.
      return sendCustomer(b, settings, "trade_reservation_expired", `trade-expired-${t.id}-${t.closed_at}`, `Trade ${label}: we've stopped holding our cards`, {
        previewText: "Our cards went back on sale. Message us if you'd still like to trade.",
        heading: "We've stopped holding our cards",
        paragraphs: [
          `${greet} we didn't manage to meet for trade ${label}, so we've stopped holding our cards and put them back on sale.`,
          t.customer_fault
            ? "Nothing was charged. If you'd still like to trade, message us on your trade page or start a new trade."
            : "Nothing was charged, and it doesn't count against you. If you'd still like to trade, message us on your trade page or start a new trade.",
        ],
        button: view,
      });

    case "canceled":
      return sendCustomer(b, settings, "trade_canceled", `trade-canceled-${t.id}`, `Trade ${label} is canceled`, {
        previewText: "Your trade is canceled.",
        heading: "Your trade is canceled",
        paragraphs: [
          `${greet} as you asked, we've canceled trade ${label}.`,
          t.reserved_at ? "Our cards went back on sale. Nothing was charged." : "Nothing of ours was reserved, and nothing was charged.",
        ],
        button: view,
      });

    case "extended":
      if (email.deadline !== "shipping") return undefined;
      return sendCustomer(b, settings, "trade_extended", `trade-extended-${t.id}-shipping-${t.ship_by}`, `Trade ${label}: more time to meet`, {
        previewText: t.ship_by ? `We'll hold our cards until ${formatDeadline(t.ship_by)}.` : "We gave you more time.",
        heading: "We gave you more time",
        paragraphs: [`${greet} we'll hold our cards for trade ${label} until ${t.ship_by ? formatDeadline(t.ship_by) : "later"} so we can meet.`],
        button: view,
      });

    case "reinstated":
      return sendCustomer(b, settings, "trade_reinstated", `trade-reinstated-${t.id}-${t.updated_at}`, `Trade ${label} is back on`, {
        previewText: "Our cards are reserved for you again.",
        heading: "Your trade is back on",
        paragraphs: [
          `${greet} we've reinstated trade ${label}: our cards are reserved for you again${t.ship_by ? ` until ${formatDeadline(t.ship_by)}` : ""}.`,
          "We'll message you on your trade page to set up where and when to meet.",
        ],
        note: meetupNote(b),
        button: view,
      });

    case "reminder":
      if (email.reminder !== "ship_by") return undefined;
      if (!t.ship_by) return { status: "skipped", reason: "no-deadline" };
      return sendCustomer(b, settings, "trade_reminder_ship_by", `trade-reminder-ship-${t.id}-${t.ship_by}`, `Trade ${label}: our hold ends ${formatDeadline(t.ship_by)}`, {
        previewText: "Haven't met up yet? Message us to set a time.",
        heading: "Let's meet up soon",
        paragraphs: [
          `${greet} we're holding our cards for trade ${label} until ${formatDeadline(t.ship_by)}.`,
          t.meetup_details
            ? "See you at the meetup below. Need a different time? Message us on your trade page."
            : "Haven't set a time yet? Message us on your trade page with times that work for you.",
        ],
        note: meetupNote(b),
        button: { href: url, label: "Message us" },
      });

    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Staff alerts: a push to the admin app and an email to the trades inbox.
 * ------------------------------------------------------------------ */

export type TradeStaffEvent =
  | { kind: "submitted" }
  | { kind: "resubmitted" }
  | { kind: "reserved" }
  | { kind: "tracking" }
  | { kind: "late_scan" }
  | { kind: "early_scan" }
  | { kind: "tracking_check" }
  | { kind: "dispute" }
  | { kind: "delivered" }
  | { kind: "adjustment"; message: string }
  | { kind: "accepted" }
  | { kind: "finalized" }
  | { kind: "declined"; reason: string | null }
  | { kind: "withdrawn"; reason: string | null }
  | { kind: "canceled"; reason: string | null }
  | { kind: "message"; messageId: string; body: string }
  | { kind: "transit_overdue" }
  | { kind: "stalled" }
  | { kind: "payment_overdue" }
  | { kind: "refund_failed" }
  | { kind: "payment_refunded"; why: string; paymentIntentId: string }
  | { kind: "forfeiture_review"; why: "canceled" | "expired" | "late" }
  | { kind: "cards_unavailable" }
  | { kind: "arrived_after_expiry" };

/** Push and email staff about something on a trade. Never throws. */
export async function notifyTradeStaff(b: TradeBundle, settings: TradeSettingsRow, event: TradeStaffEvent): Promise<void> {
  try {
    if (!settings.notify_staff) return;
    const t = b.trade;
    const label = tradeLabel(t.trade_number);
    const who = t.customer_name || t.customer_email || "A customer";
    const url = `${siteUrl()}${adminTradePath(t.id)}`;
    const cards = b.offers.reduce((n, c) => n + c.quantity, 0);
    const deposit = paidDeposit(b);
    let key: string;
    let title: string;
    let body: string;
    let heading: string;
    const rows: { label: string; value: string }[] = [
      { label: "Trade", value: label },
      { label: "Customer", value: `${who}${t.customer_email ? ` <${t.customer_email}>` : ""}` },
      { label: "Our cards", value: money(t.wanted_total_cents) },
    ];
    const tracking = () => rows.push({ label: "Tracking", value: `${t.inbound_carrier ?? ""} ${t.inbound_tracking ?? ""}`.trim() || "None" });
    let note: string | null = null;
    switch (event.kind) {
      case "submitted":
      case "resubmitted":
        key = `trade:${event.kind}:${t.id}:${t.submitted_at}`;
        title = `${event.kind === "submitted" ? "Trade to review" : "Trade changes to review"} · ${label}`;
        if (handoffOf(t) === "local") {
          body = `${who} · local pickup · ${money(t.wanted_total_cents)} of our cards`;
          heading =
            event.kind === "submitted" ? "A local pickup trade is waiting for review" : "A local pickup trade was sent back with changes";
          rows.push(
            { label: "How", value: "Local pickup: their cards are valued when you meet" },
            ...(t.customer_note ? [{ label: "Their note", value: t.customer_note }] : []),
          );
          break;
        }
        body = `${who} · ${cards} card${cards === 1 ? "" : "s"} · est. ${money(t.estimated_value_cents)}`;
        heading = event.kind === "submitted" ? "A trade is waiting for review" : "A trade was sent back with changes";
        rows.push(
          { label: "Their cards", value: `${cards} (estimated ${money(t.estimated_value_cents)})` },
          ...(t.customer_note ? [{ label: "Their note", value: t.customer_note }] : []),
        );
        break;
      case "reserved":
        key = `trade:reserved:${t.id}:${t.reserved_at}`;
        title = `Trade confirmed · ${label}`;
        if (handoffOf(t) === "local") {
          // Held until it's finished: no deadline.
          body = `${who} · local pickup · cards held until the trade is finished: arrange the meetup`;
          heading = "A customer confirmed a local pickup trade: arrange the meetup";
          rows.push({ label: "Meetup", value: t.meetup_details ?? "Not set yet: message them on the trade" });
          break;
        }
        body = `${who} · cards reserved${t.deposit_status === "paid" ? ` · ${money(deposit)} deposit paid` : ""} · ship by ${t.ship_by ? formatDeadline(t.ship_by) : "?"}`;
        heading = "A customer confirmed their trade: our cards are reserved";
        rows.push(
          { label: "Deposit", value: t.deposit_status === "paid" ? `${money(deposit)} paid` : "None" },
          { label: "Ship by", value: t.ship_by ? formatDeadline(t.ship_by) : "" },
        );
        break;
      case "tracking":
        key = `trade:tracking:${t.id}:${t.inbound_tracking}`;
        title = `Tracking added · ${label}`;
        body = `${who} · ${t.inbound_carrier ?? "Carrier"} ${t.inbound_tracking ?? ""}`;
        heading = "A customer added a tracking number (not verified until the carrier scans it)";
        tracking();
        break;
      case "late_scan":
        key = `trade:late-scan:${t.id}:${t.inbound_accepted_at}`;
        title = `Late carrier scan · ${label}`;
        body = `${who} · first scan ${t.inbound_accepted_at ? formatDeadline(t.inbound_accepted_at) : ""} · deadline ${t.ship_by ? formatDeadline(t.ship_by) : ""}`;
        heading = "The first carrier scan came after the shipping deadline: decide whether it counts";
        tracking();
        rows.push({ label: "Deadline", value: t.ship_by ? formatDeadline(t.ship_by) : "" }, { label: "First scan", value: t.inbound_accepted_at ? formatDeadline(t.inbound_accepted_at) : "" });
        break;
      case "early_scan":
        key = `trade:early-scan:${t.id}:${t.inbound_tracking}`;
        title = `Check this tracking number · ${label}`;
        body = `${who} · its first scan is from before the trade was approved`;
        heading = "A tracking number's first scan is older than the trade: check it's the right package";
        tracking();
        break;
      case "tracking_check":
        key = `trade:tracking-check:${t.id}:${t.ship_by}`;
        title = `Verify a shipment by hand · ${label}`;
        body = `${who} · ${t.inbound_carrier ?? ""} ${t.inbound_tracking ?? ""} · deadline passed`;
        heading = "This tracking number can't be checked automatically: verify the carrier's acceptance by hand";
        tracking();
        break;
      case "dispute":
        key = `trade:dispute:${t.id}:${b.disputes.at(-1)?.id ?? ""}`;
        title = `Proof of shipping · ${label}`;
        body = `${who} says they shipped in time`;
        heading = "A customer sent proof of shipping: review it";
        note = b.disputes.at(-1)?.note ?? null;
        tracking();
        break;
      case "delivered":
        key = `trade:delivered:${t.id}`;
        title = `Trade package delivered · ${label}`;
        body = `${who} · ready to inspect`;
        heading = "A trade package was delivered: inspect it";
        tracking();
        break;
      case "adjustment":
        key = `trade:adjustment:${t.id}:${crypto.createHash("sha256").update(event.message).digest("hex").slice(0, 12)}`;
        title = `Adjustment asked · ${label}`;
        body = `${who}: "${event.message.slice(0, 120)}"`;
        heading = "A customer asked for an adjustment to their final offer";
        note = event.message;
        break;
      case "accepted":
        key = `trade:accepted:${t.id}:${t.accepted_at}`;
        title = `Final offer accepted · ${label}`;
        body = t.amount_due_cents ? `${who} · ${money(t.amount_due_cents)} to pay` : `${who} · nothing to pay`;
        heading = "A customer accepted their final offer";
        rows.push({ label: "To pay by card", value: money(t.amount_due_cents ?? 0) });
        break;
      case "finalized":
        key = `trade:finalized:${t.id}`;
        title = `Trade final · ${label}`;
        body = `${who} · order ready to pack`;
        heading = "A trade is final: its order is ready to pack";
        rows.push(
          { label: "Credit issued", value: money(t.credit_issued_cents ?? 0) },
          { label: "Paid by card", value: money(t.amount_due_cents ?? 0) },
          ...(t.excess_handling === "cash" && t.cash_payout_cents ? [{ label: "Cash owed to them", value: money(t.cash_payout_cents) }] : []),
          ...(t.order_id ? [{ label: "Order", value: `GG-${t.order_id.slice(0, 8).toUpperCase()}` }] : []),
        );
        break;
      case "declined":
        key = `trade:declined:${t.id}`;
        title = `Final offer declined · ${label}`;
        body = event.reason ? `${who}: "${event.reason.slice(0, 120)}"` : who;
        heading = "A customer declined their final offer (no penalty): mail their cards back";
        note = event.reason;
        break;
      case "withdrawn":
        key = `trade:withdrawn:${t.id}`;
        title = `Canceled after shipping · ${label}`;
        body = event.reason ? `${who}: "${event.reason.slice(0, 120)}"` : who;
        heading = "A customer canceled after shipping (no penalty): mail their cards back when they arrive";
        note = event.reason;
        tracking();
        break;
      case "canceled":
        key = `trade:canceled:${t.id}`;
        title = `Trade canceled · ${label}`;
        body = event.reason ? `${who}: "${event.reason.slice(0, 120)}"` : who;
        heading = t.deposit_status === "forfeiture_review" ? "A customer canceled a reserved trade: review the deposit" : "A customer canceled their trade";
        note = event.reason;
        break;
      case "message":
        key = `trade:message:${event.messageId}`;
        title = `Trade message · ${label}`;
        body = `${who}: "${event.body.slice(0, 120)}"`;
        heading = "A customer sent a message about their trade";
        note = event.body;
        break;
      case "transit_overdue":
        key = `trade:transit-overdue:${t.id}:${t.inbound_tracking}`;
        title = `Trade package overdue · ${label}`;
        body = `${who} · accepted ${t.inbound_accepted_at ? formatDeadline(t.inbound_accepted_at) : ""}`;
        heading = "A trade package has been in transit longer than expected: check the tracking (the reservation stays)";
        tracking();
        break;
      case "stalled":
        key = `trade:stalled:${t.id}:${t.inbound_last_event_at}`;
        title = `Trade package stalled · ${label}`;
        body = `${who} · no carrier update since ${t.inbound_last_event_at ? formatDeadline(t.inbound_last_event_at) : "?"}`;
        heading = "A trade package hasn't had a carrier update in a while: check on it (the reservation stays)";
        tracking();
        break;
      case "payment_overdue":
        key = `trade:payment-overdue:${t.id}:${t.payment_due_at}`;
        title = `Trade payment overdue · ${label}`;
        body = `${who} · ${money(t.amount_due_cents ?? 0)} due`;
        heading = "A trade's payment is overdue: follow up with the customer";
        rows.push({ label: "Due", value: money(t.amount_due_cents ?? 0) });
        break;
      case "refund_failed":
        key = `trade:refund-failed:${t.id}:${t.deposit_refund_attempts}`;
        title = `Deposit refund failed · ${label}`;
        body = `${who} · ${money(deposit)} · ${t.deposit_refund_failure ?? "no reason given"}`;
        heading = "A deposit refund failed: retry it or refund the customer another way";
        rows.push({ label: "Deposit", value: money(deposit) }, { label: "Why", value: t.deposit_refund_failure ?? "Unknown" });
        break;
      case "payment_refunded":
        key = `trade:payment-refunded:${event.paymentIntentId}`;
        title = `Deposit refunded automatically · ${label}`;
        body = `${who} · ${event.why}`;
        heading = "A deposit payment couldn't be used, so it's being refunded automatically";
        rows.push({ label: "Payment", value: event.paymentIntentId }, { label: "Why", value: event.why });
        break;
      case "forfeiture_review":
        key = `trade:forfeiture-review:${t.id}:${t.closed_at ?? t.updated_at}`;
        title = `Deposit to review · ${label}`;
        body = `${who} · ${money(deposit)} · ${event.why === "canceled" ? "canceled while reserved" : event.why === "late" ? "shipped late" : "reservation expired"}`;
        heading = "A deposit is waiting for your decision: refund it, or keep it under the terms";
        rows.push({ label: "Deposit", value: money(deposit) });
        break;
      case "cards_unavailable":
        key = `trade:unavailable:${t.id}:${t.list_due_at ?? t.updated_at}`;
        title = `Cards sold before confirmation · ${label}`;
        body = `${who} · sent back to update their selection`;
        heading = "Some of our cards on an approved trade sold before it was confirmed; it went back to the customer";
        break;
      case "arrived_after_expiry":
        key = `trade:arrived-after-expiry:${t.id}`;
        title = `Package after expiry · ${label}`;
        body = `${who} · reinstate the trade or mail the cards back`;
        heading = "Cards arrived for a reservation that had expired: reinstate it or mail them back";
        tracking();
        break;
    }

    await notifyStaff({ key, kind: "trade", title, body, url, tag: `trade:${t.id}` });

    const data: NoticeEmailData = {
      ...base(),
      previewText: `${heading} (${label})`,
      heading,
      paragraphs: [],
      note,
      rows,
      button: { href: url, label: "Open in the admin" },
    };
    const digest = crypto.createHash("sha256").update(key).digest("hex").slice(0, 24);
    const result = await sendTrackedEmail({
      emailType: `trade_staff_${event.kind}`,
      idempotencyKey: `trade-staff-${digest}`,
      to: ServerEnv.tradeNotificationEmail(),
      from: ServerEnv.fromOrders(),
      replyTo: t.customer_email ?? ServerEnv.replyTo(),
      subject: `${heading} (${label})`,
      react: React.createElement(NoticeEmail, data),
      text: noticeEmailText(data),
    });
    if (result.status === "failed") console.error("[tradeCenterEmails] staff email failed", key, result.error);
  } catch (err) {
    console.error("[tradeCenterEmails] notifyTradeStaff failed", b.trade.id, event.kind, err);
  }
}
