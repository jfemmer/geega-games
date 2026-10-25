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
import { adminTradePath, shipToAddress, type TradeBundle, type TradeOfferRow, type TradeSettingsRow } from "./tradeCenter.js";
import {
  cardLine,
  formatDeadline,
  formatUsd,
  myTradePath,
  tradeComparison,
  tradeCreditCents,
  tradeLabel,
  tradeShippingCents,
} from "../../src/store/lib/tradeCenter.js";

// Trade Center emails and staff alerts. Like the other *Emails modules every
// email has an idempotency key, so a retried request, or the Stripe webhook
// arriving after the trade page already recorded a payment, never sends the
// same email twice. All of it is best-effort for the caller: the change is
// already saved when these run, and they never throw.

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

/** Our cards, their cards and the bottom line, as the itemized box. */
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
    shippingCents,
  });
  const lines = [
    { label: "Our cards", value: money(c.wantedCents) },
    { label: "Shipping our cards to you", value: c.shippingCents === 0 ? "Free" : money(c.shippingCents) },
    { label: valueLabel, value: money(value) },
    { label: `Trade credit at ${t.credit_rate_percent}%`, value: money(c.creditCents) },
  ];
  if (t.processing_fee_cents > 0) lines.push({ label: "Processing fee (taken from the credit)", value: money(t.processing_fee_cents) });
  return c.remainingCents > 0
    ? { lines, totalLabel: "You'd pay by card", total: money(c.remainingCents), footnote }
    : { lines, totalLabel: "Trade credit left over", total: money(c.excessCents), footnote };
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

export type TradeCustomerEmail =
  | { kind: "submitted" }
  | { kind: "revision_requested"; message: string }
  | { kind: "approved" }
  | { kind: "rejected"; reason: string | null }
  | { kind: "canceled" }
  | { kind: "expired"; fromStatus: string }
  | { kind: "tracking_added" }
  | { kind: "received" }
  | { kind: "final_offer" }
  | { kind: "awaiting_payment" }
  | { kind: "finalized" }
  | { kind: "return_pending"; reason: string | null }
  | { kind: "returned" }
  | { kind: "message"; messageId: string; body: string }
  | { kind: "reminder"; reminder: "list_due" | "revision_due" | "ship_by" | "payment_due" };

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

async function buildAndSend(b: TradeBundle, settings: TradeSettingsRow, email: TradeCustomerEmail): Promise<Result> {
  const t = b.trade;
  const label = tradeLabel(t.trade_number);
  const url = tradeUrl(t.id);
  const greet = hi(t.customer_name);
  const view = { href: url, label: "View your trade" };

  switch (email.kind) {
    case "submitted": {
      const blocked = b.offers.filter((c) => c.eligibility === "needs_review").length;
      return sendCustomer(b, settings, "trade_submitted", `trade-submitted-${t.id}-${t.submitted_at}`, `Trade ${label}: we got your list`, {
        previewText: "We're reviewing your cards. Our cards stay on hold for you meanwhile.",
        heading: "We got your trade list",
        paragraphs: [
          `${greet} thanks! We're reviewing the cards you listed for trade ${label}. Our cards stay on hold for you while we do.`,
          "We'll email you when we've decided. Please don't mail anything yet: if your trade is approved, we'll send the address to ship to and how to pack your cards.",
        ],
        quote: comparisonBlock(
          b,
          t.estimated_value_cents,
          "Your cards (estimated)",
          `Estimates use each card's market reference price for its condition.${blocked > 0 ? ` ${blocked} card${blocked === 1 ? " has" : "s have"} no current price and will be valued by hand.` : ""} We confirm values when we review your list, and again when your cards arrive.`,
        ),
        button: view,
      });
    }

    case "revision_requested":
      return sendCustomer(
        b,
        settings,
        "trade_revision_requested",
        `trade-revision-${t.id}-${t.hold_expires_at}`,
        `Trade ${label}: a change is needed`,
        {
          previewText: "We need a change before we can approve your trade.",
          heading: "We need a change to your trade",
          paragraphs: [`${greet} we looked over your list for trade ${label} and need a change before we can approve it:`],
          note: email.message,
          closing: [
            t.hold_expires_at
              ? `Update your list and send it again by ${formatDeadline(t.hold_expires_at)}. Our cards stay on hold until then.`
              : "Update your list and send it again. Our cards stay on hold until then.",
          ],
          button: { href: url, label: "Update your trade" },
        },
      );

    case "approved": {
      const approved = b.offers.filter((c) => c.review_status === "approved" && (c.approved_quantity ?? 0) > 0);
      const value = t.approved_value_cents ?? 0;
      const credit = tradeCreditCents(value, t.credit_rate_percent, t.processing_fee_cents);
      const address = shipToAddress(settings);
      if (!address) return { status: "skipped", reason: "no-ship-to-address" };
      const rejected = b.offers.filter((c) => c.review_status === "rejected");
      return sendCustomer(b, settings, "trade_approved", `trade-approved-${t.id}-${t.approved_at}`, `Trade ${label} is approved: ship your cards`, {
        previewText: t.ship_by ? `Please mail your cards by ${formatDeadline(t.ship_by)}.` : "Here's where to mail your cards.",
        heading: "Your trade is preliminarily approved",
        paragraphs: [
          `${greet} good news: we've approved the cards below for trade ${label}, valued at ${money(value)} (${money(credit)} in trade credit).`,
          t.ship_by
            ? `Please mail them by ${formatDeadline(t.ship_by)}, then add the tracking number on your trade page. Our cards stay on hold for you until then.`
            : "Please mail them soon, then add the tracking number on your trade page.",
          "Final values are confirmed when your cards arrive and we inspect them.",
        ],
        note: t.approval_conditions ? `Approved on this condition: ${t.approval_conditions}` : null,
        rows: clipRows(
          approved.map((c) => ({
            label: `${c.approved_quantity} × ${offerName(c)}`,
            value: money((c.approved_quantity ?? 0) * (c.approved_unit_cents ?? 0)),
          })),
          (n) => ({ label: `And ${n} more on your trade page`, value: "" }),
        ),
        address: {
          title: "Mail your cards to",
          lines: [address.name, address.line1, address.line2, `${address.city}, ${address.state} ${address.postalCode}`].filter(
            (line): line is string => Boolean(line),
          ),
        },
        lists: [
          {
            title: "Packing your cards",
            items: [
              settings.packing_instructions,
              `Put a slip of paper with your trade ID, ${label}, inside the package.`,
              settings.shipping_paid_by === "store"
                ? "We cover shipping your cards to us: reply to this email before you ship and we'll arrange it."
                : "You pay to ship your cards to us. Please use a tracked service.",
              ...(rejected.length > 0 ? [`Leave out the ${rejected.length === 1 ? "card" : `${rejected.length} cards`} we didn't approve (marked on your trade page).`] : []),
            ],
          },
        ],
        button: { href: url, label: "Add your tracking number" },
      });
    }

    case "rejected":
      return sendCustomer(b, settings, "trade_rejected", `trade-rejected-${t.id}-${t.closed_at ?? t.updated_at}`, `Trade ${label} wasn't accepted`, {
        previewText: "We couldn't accept this trade. Our cards were released.",
        heading: "We couldn't accept this trade",
        paragraphs: [`${greet} we're sorry, but we can't accept trade ${label}.`],
        note: email.reason,
        closing: ["We've released the hold on our cards. You're welcome to start a new trade anytime."],
        button: view,
      });

    case "canceled":
      return sendCustomer(b, settings, "trade_canceled", `trade-canceled-${t.id}`, `Trade ${label} is canceled`, {
        previewText: "Your trade is canceled and our cards were released.",
        heading: "Your trade is canceled",
        paragraphs: [`${greet} as you asked, we've canceled trade ${label} and released the hold on our cards.`],
        button: view,
      });

    case "expired": {
      const why =
        email.fromStatus === "awaiting_shipment"
          ? "we didn't get a tracking number by the shipping deadline"
          : email.fromStatus === "revision_requested"
            ? "the changes weren't sent in time"
            : "your card list wasn't sent in time";
      return sendCustomer(b, settings, "trade_expired", `trade-expired-${t.id}`, `Trade ${label} expired`, {
        previewText: "The hold on our cards was released.",
        heading: "Your trade expired",
        paragraphs: [
          `${greet} trade ${label} expired because ${why}, so we've released the hold on our cards.`,
          "If you'd still like to trade, start a new one: our cards may still be available.",
        ],
        button: view,
      });
    }

    case "tracking_added":
      return sendCustomer(
        b,
        settings,
        "trade_tracking_added",
        `trade-tracking-${t.id}-${t.inbound_tracking}`,
        `Trade ${label}: tracking number received`,
        {
          previewText: "We'll email you when your package arrives.",
          heading: "Thanks, we'll watch for your package",
          paragraphs: [`${greet} we've got the tracking number for trade ${label}. We'll email you when your package arrives.`],
          rows: [
            ...(t.inbound_carrier ? [{ label: "Carrier", value: t.inbound_carrier }] : []),
            { label: "Tracking number", value: t.inbound_tracking ?? "" },
          ],
          button: view,
        },
      );

    case "received":
      return sendCustomer(b, settings, "trade_received", `trade-received-${t.id}`, `Trade ${label}: your cards arrived`, {
        previewText: "We'll inspect your cards next.",
        heading: "Your cards arrived",
        paragraphs: [`${greet} your package for trade ${label} arrived. We'll inspect your cards next and email you our final offer.`],
        button: view,
      });

    case "final_offer": {
      const value = t.final_value_cents ?? 0;
      const changes = b.offers.flatMap((c) => {
        const approvedQty = c.review_status === "approved" ? (c.approved_quantity ?? 0) : 0;
        const finalQty = c.inspected_at ? (c.final_quantity ?? 0) : 0;
        const sameQty = finalQty === approvedQty;
        const sameUnit = finalQty === 0 || c.final_unit_cents === c.approved_unit_cents;
        if (approvedQty === 0 && finalQty === 0) return [];
        if (sameQty && sameUnit) return [];
        const what =
          finalQty === 0
            ? "not accepted"
            : !sameQty
              ? `${finalQty} of ${approvedQty} accepted`
              : `now ${money(c.final_unit_cents ?? 0)} each (was ${money(c.approved_unit_cents ?? 0)})`;
        return [`${offerName(c)}: ${what}.${c.inspection_note ? ` ${c.inspection_note}` : ""}`];
      });
      const cash = t.excess_handling === "cash" && t.cash_payout_cents ? t.cash_payout_cents : null;
      return sendCustomer(b, settings, "trade_final_offer", `trade-final-offer-${t.id}-${t.final_offer_at}`, `Trade ${label}: your final offer is ready`, {
        previewText: "Review it, then accept, ask for an adjustment, or decline.",
        heading: "Your final offer is ready",
        paragraphs: [
          `${greet} we've inspected your cards for trade ${label}. Here's our final offer.`,
          changes.length > 0
            ? "A few things changed from what we approved. They're listed below with the reason."
            : "Everything matched what we approved.",
        ],
        quote: comparisonBlock(
          b,
          value,
          "Your cards (final value)",
          cash ? `Instead of store credit for what's left over, we'll pay you ${money(cash)} in cash.` : null,
          tradeShippingCents(t.wanted_total_cents),
        ),
        lists: changes.length > 0 ? [{ title: "What changed", items: changes.slice(0, MAX_EMAIL_CARDS) }] : [],
        button: { href: url, label: "Review your final offer" },
        closing: [
          "Accept it, ask for an adjustment, or decline it on your trade page. Nothing is final until you accept, and there's no deadline to answer.",
          settings.return_policy,
        ],
      });
    }

    case "awaiting_payment":
      return sendCustomer(b, settings, "trade_awaiting_payment", `trade-awaiting-payment-${t.id}-${t.accepted_at}`, `Trade ${label}: pay ${money(t.amount_due_cents ?? 0)} to finish`, {
        previewText: "Pay the difference by card to finish your trade.",
        heading: "One last step: pay the difference",
        paragraphs: [
          `${greet} you accepted the final offer for trade ${label}. Your trade credit covers ${money(t.final_credit_cents ?? 0)}; the remaining ${money(t.amount_due_cents ?? 0)} is due${t.payment_due_at ? ` by ${formatDeadline(t.payment_due_at)}` : ""}.`,
          "Pay by card on your trade page and we'll pack your new cards right away.",
        ],
        button: { href: url, label: `Pay ${money(t.amount_due_cents ?? 0)}` },
      });

    case "finalized": {
      const issued = t.credit_issued_cents ?? 0;
      const due = t.amount_due_cents ?? 0;
      const excess = t.excess_cents ?? 0;
      const cash = t.excess_handling === "cash" ? (t.cash_payout_cents ?? 0) : 0;
      const orderNumber = t.order_id ? `GG-${t.order_id.slice(0, 8).toUpperCase()}` : null;
      const spent = (t.wanted_total_cents + (t.shipping_cents ?? 0)) - due;
      return sendCustomer(b, settings, "trade_finalized", `trade-finalized-${t.id}`, `Trade ${label} is complete`, {
        previewText: "Your new cards are being packed.",
        heading: "Your trade is complete",
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

    case "return_pending":
      return sendCustomer(b, settings, "trade_return_pending", `trade-return-pending-${t.id}`, `Trade ${label}: we're returning your cards`, {
        previewText: "We'll email the tracking number when they're on the way.",
        heading: "We're returning your cards",
        paragraphs: [`${greet} we'll mail your cards from trade ${label} back to you. We've released the hold on our cards.`],
        note: email.reason,
        closing: [settings.return_policy, "We'll email the tracking number when they're on the way."],
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

    case "message":
      return sendCustomer(b, settings, "trade_message", `trade-message-${email.messageId}`, `Trade ${label}: a message from Geega Games`, {
        previewText: email.body.slice(0, 120),
        heading: "A message about your trade",
        paragraphs: [`${greet} here's a message from us about trade ${label}:`],
        note: email.body,
        button: { href: url, label: "Reply on your trade page" },
      });

    case "reminder": {
      const r = email.reminder;
      if (r === "list_due" || r === "revision_due") {
        if (!t.hold_expires_at) return { status: "skipped", reason: "no-deadline" };
        return sendCustomer(b, settings, `trade_reminder_${r}`, `trade-reminder-${r}-${t.id}-${t.hold_expires_at}`, `Trade ${label}: the hold on our cards ends soon`, {
          previewText: `Send your ${r === "list_due" ? "list" : "changes"} by ${formatDeadline(t.hold_expires_at)}.`,
          heading: "The hold on our cards ends soon",
          paragraphs: [
            `${greet} the hold on our cards for trade ${label} ends ${formatDeadline(t.hold_expires_at)}.`,
            r === "list_due"
              ? "Add the cards you're trading in and send your list before then, or the hold is released."
              : "Make the change we asked for and send your list again before then, or the hold is released.",
          ],
          button: { href: url, label: "Finish your trade" },
        });
      }
      if (r === "ship_by") {
        if (!t.ship_by) return { status: "skipped", reason: "no-deadline" };
        return sendCustomer(b, settings, "trade_reminder_ship_by", `trade-reminder-ship-${t.id}-${t.ship_by}`, `Trade ${label}: please ship by ${formatDeadline(t.ship_by)}`, {
          previewText: "Add your tracking number once your cards are in the mail.",
          heading: "Time to mail your cards",
          paragraphs: [
            `${greet} please mail your cards for trade ${label} by ${formatDeadline(t.ship_by)}.`,
            "Already sent them? Add the tracking number on your trade page so we know they're coming.",
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
          "Pay by card on your trade page. Changed your mind? You can decline there instead and we'll return your cards.",
        ],
        button: { href: url, label: `Pay ${money(t.amount_due_cents)}` },
      });
    }
  }
}

/* ------------------------------------------------------------------ *
 * Staff alerts: a push to the admin app and an email to the trades inbox.
 * ------------------------------------------------------------------ */

export type TradeStaffEvent =
  | { kind: "submitted" }
  | { kind: "resubmitted" }
  | { kind: "tracking" }
  | { kind: "adjustment"; message: string }
  | { kind: "accepted" }
  | { kind: "finalized" }
  | { kind: "declined"; reason: string | null }
  | { kind: "canceled"; reason: string | null }
  | { kind: "message"; messageId: string; body: string }
  | { kind: "transit_overdue" }
  | { kind: "payment_overdue" };

/** Push and email staff about something on a trade. Never throws. */
export async function notifyTradeStaff(b: TradeBundle, settings: TradeSettingsRow, event: TradeStaffEvent): Promise<void> {
  try {
    if (!settings.notify_staff) return;
    const t = b.trade;
    const label = tradeLabel(t.trade_number);
    const who = t.customer_name || t.customer_email || "A customer";
    const url = `${siteUrl()}${adminTradePath(t.id)}`;
    const cards = b.offers.reduce((n, c) => n + c.quantity, 0);
    let key: string;
    let title: string;
    let body: string;
    let heading: string;
    const rows: { label: string; value: string }[] = [
      { label: "Trade", value: label },
      { label: "Customer", value: `${who}${t.customer_email ? ` <${t.customer_email}>` : ""}` },
      { label: "Our cards", value: money(t.wanted_total_cents) },
    ];
    let note: string | null = null;
    switch (event.kind) {
      case "submitted":
      case "resubmitted":
        key = `trade:${event.kind}:${t.id}:${t.submitted_at}`;
        title = `${event.kind === "submitted" ? "Trade to review" : "Trade changes to review"} · ${label}`;
        body = `${who} · ${cards} card${cards === 1 ? "" : "s"} · est. ${money(t.estimated_value_cents)}`;
        heading = event.kind === "submitted" ? "A trade is waiting for review" : "A trade was sent back with changes";
        rows.push(
          { label: "Their cards", value: `${cards} (estimated ${money(t.estimated_value_cents)})` },
          ...(t.customer_note ? [{ label: "Their note", value: t.customer_note }] : []),
        );
        break;
      case "tracking":
        key = `trade:tracking:${t.id}:${t.inbound_tracking}`;
        title = `Trade shipped · ${label}`;
        body = `${who} · ${t.inbound_carrier ?? "Carrier"} ${t.inbound_tracking ?? ""}`;
        heading = "A customer mailed their trade cards";
        rows.push({ label: "Tracking", value: `${t.inbound_carrier ?? ""} ${t.inbound_tracking ?? ""}`.trim() });
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
        title = `Trade complete · ${label}`;
        body = `${who} · order ready to pack`;
        heading = "A trade is complete: its order is ready to pack";
        rows.push(
          { label: "Credit issued", value: money(t.credit_issued_cents ?? 0) },
          { label: "Paid by card", value: money(t.amount_due_cents ?? 0) },
          ...(t.excess_handling === "cash" && t.cash_payout_cents
            ? [{ label: "Cash owed to them", value: money(t.cash_payout_cents) }]
            : []),
          ...(t.order_id ? [{ label: "Order", value: `GG-${t.order_id.slice(0, 8).toUpperCase()}` }] : []),
        );
        break;
      case "declined":
        key = `trade:declined:${t.id}`;
        title = `Final offer declined · ${label}`;
        body = event.reason ? `${who}: "${event.reason.slice(0, 120)}"` : who;
        heading = "A customer declined their final offer: mail their cards back";
        note = event.reason;
        break;
      case "canceled":
        key = `trade:canceled:${t.id}`;
        title = `Trade canceled · ${label}`;
        body = event.reason ? `${who}: "${event.reason.slice(0, 120)}"` : who;
        heading = "A customer canceled their trade";
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
        body = `${who} · shipped ${t.inbound_shipped_at ? new Date(t.inbound_shipped_at).toLocaleDateString("en-US", { timeZone: "America/Chicago" }) : ""}`;
        heading = "A trade package hasn't arrived: check the tracking";
        rows.push({ label: "Tracking", value: `${t.inbound_carrier ?? ""} ${t.inbound_tracking ?? ""}`.trim() });
        break;
      case "payment_overdue":
        key = `trade:payment-overdue:${t.id}:${t.payment_due_at}`;
        title = `Trade payment overdue · ${label}`;
        body = `${who} · ${money(t.amount_due_cents ?? 0)} due`;
        heading = "A trade's payment is overdue: follow up with the customer";
        rows.push({ label: "Due", value: money(t.amount_due_cents ?? 0) });
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
