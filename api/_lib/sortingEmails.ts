import * as React from "react";
import crypto from "node:crypto";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { notifyStaff, shortName } from "./staffPush.js";
import { sendTrackedEmail, type SendEmailResult } from "./emailService.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";
import { SortingEmail, sortingEmailText, type SortingEmailData } from "./emails/SortingEmails.js";
import {
  adminSortingUrl,
  loadSortingRequest,
  quoteItemsOf,
  sortingQuoteUrl,
  stripeConfigured,
  type SortingPaymentRow,
  type SortingQuoteRow,
  type SortingRequestRow,
} from "./sorting.js";
import {
  SORTING_DELIVERY_LABELS,
  SORTING_INBOUND_RESPONSIBILITIES,
  SORTING_NO_INBOUND_LABELS,
  SORTING_PAYMENT_METHOD_LABELS,
  SORTING_RETURN_POLICY,
  formatRatePerThousand,
  formatUsdCents,
  sortingBalanceDueCents,
  sortingQuoteLines,
  type SortingPaymentMethod,
  type SortingRequestStatus,
} from "../../src/store/lib/sortingService.js";
import { shipFromLines } from "../../src/store/lib/shipFrom.js";

// Collection sorting emails and staff alerts. Like the other *Emails
// modules, each function takes ids and loads everything else server-side,
// and every email has an idempotency key, so a retried request (or a Stripe
// webhook arriving after the page already confirmed a payment) never sends
// the same email twice. All of them are best-effort for their callers: the
// request, quote or payment is already saved when they run.

type Result = SendEmailResult | { status: "skipped"; reason: string };

const REASON = "You received this because you asked Geega Games to sort your Magic: The Gathering collection.";

const money = formatUsdCents;

function base() {
  return { siteUrl: siteUrl(), logoUrl: logoUrl(), supportEmail: ServerEnv.replyTo() };
}

async function sendCustomer(
  request: SortingRequestRow,
  emailType: string,
  idempotencyKey: string,
  subject: string,
  data: Omit<SortingEmailData, "siteUrl" | "logoUrl" | "supportEmail" | "reasonLine">,
): Promise<Result> {
  const full: SortingEmailData = { ...data, ...base(), reasonLine: REASON };
  return sendTrackedEmail({
    emailType,
    idempotencyKey,
    to: request.email,
    from: ServerEnv.fromOrders(),
    replyTo: ServerEnv.replyTo(),
    subject,
    react: React.createElement(SortingEmail, full),
    text: sortingEmailText(full),
  });
}

function cards(n: number): string {
  return `${n.toLocaleString("en-US")} card${n === 1 ? "" : "s"}`;
}

function shippingLists(): SortingEmailData["lists"] {
  return [
    {
      title: "Shipping your collection to us",
      items: [...SORTING_INBOUND_RESPONSIBILITIES, SORTING_NO_INBOUND_LABELS],
    },
    { title: "Return shipping", items: SORTING_RETURN_POLICY },
  ];
}

async function loadQuote(quoteId: string): Promise<SortingQuoteRow | null> {
  const { data, error } = await getSupabaseAdmin().from("sorting_quotes").select("*").eq("id", quoteId).maybeSingle();
  return error ? null : ((data as SortingQuoteRow | null) ?? null);
}

async function acceptedTotal(request: SortingRequestRow): Promise<number | null> {
  if (!request.accepted_quote_id) return null;
  const quote = await loadQuote(request.accepted_quote_id);
  return quote ? quote.total_cents : null;
}

function quoteBlock(request: SortingRequestRow, quote: SortingQuoteRow, totalLabel = "Total"): SortingEmailData["quote"] {
  const shipped = request.delivery_method === "ship";
  return {
    lines: sortingQuoteLines(quoteItemsOf(quote), request.delivery_method).map((line) => ({
      label: line.label,
      value: money(line.amountCents),
    })),
    totalLabel,
    total: money(quote.total_cents),
    footnote: shipped
      ? "Return shipping and packaging are included in this total. Once you've approved and paid it, we won't charge you anything more for return shipping unless you agree to a change."
      : "Local pickup — no return shipping.",
  };
}

/* ------------------------------------------------------------------ *
 * Customer emails
 * ------------------------------------------------------------------ */

/** "We got your request": what they asked for, what happens next, and (for shipping) the shipping policy. */
export async function sendSortingRequestReceived(requestId: string): Promise<Result> {
  const r = await loadSortingRequest(requestId);
  if (!r) return { status: "skipped", reason: "request-not-found" };
  const shipped = r.delivery_method === "ship";
  const rows = [
    { label: "Reference", value: r.reference_number },
    { label: "Service", value: r.option_name },
    { label: "Estimated cards", value: cards(r.estimated_cards) },
    { label: "Sorting estimate", value: money(r.estimated_sorting_cents) },
    { label: "Rate", value: formatRatePerThousand(r.rate_per_thousand_cents) },
    { label: "Getting it to us", value: SORTING_DELIVERY_LABELS[r.delivery_method] },
  ];
  if (shipped && r.return_city) {
    rows.push({ label: "Shipping back to", value: `${r.return_recipient ?? ""}, ${r.return_city}, ${r.return_state}`.replace(/^, /, "") });
  }
  return sendCustomer(r, "sorting_request_received", `sorting-request-received-${r.id}`, `We got your sorting request — ${r.reference_number}`, {
    previewText: shipped
      ? "We'll email you when we're ready for your cards. Please wait for that email before shipping."
      : "We'll be in touch to set up your drop-off.",
    heading: "Sorting request received",
    paragraphs: [
      `Thanks, ${r.first_name}! We've got your request to sort your collection.`,
      shipped
        ? "Next, we'll email you when we're ready for your cards, with the address to ship them to. Please wait for that email before sending anything."
        : "Next, we'll get in touch to set up a time and place to drop off your cards in the St. Louis area.",
    ],
    rows,
    lists: shipped ? shippingLists() : [],
    closing: [
      shipped
        ? "The sorting estimate doesn't include return shipping or packaging. Your final quote is based on the cards we count and adds return shipping and packaging, so you'll see the complete cost before you approve anything."
        : "Your final price is based on the cards we count. You'll get a complete quote to approve before you pay anything.",
    ],
  });
}

const STATUS_EMAILS: ReadonlySet<SortingRequestStatus> = new Set(["awaiting_cards", "received", "ready", "returned", "cancelled"]);

export function isNotifiableSortingStatus(status: SortingRequestStatus): boolean {
  return STATUS_EMAILS.has(status);
}

/**
 * The customer's update when staff move a request along (ready for the
 * cards, cards received, ready, returned, cancelled), with staff's optional
 * message. One email per status change: the key includes when it changed.
 */
export async function sendSortingStatusUpdate(
  requestId: string,
  status: SortingRequestStatus,
  message: string | null,
): Promise<Result> {
  const r = await loadSortingRequest(requestId);
  if (!r) return { status: "skipped", reason: "request-not-found" };
  if (!STATUS_EMAILS.has(status) || r.status !== status) return { status: "skipped", reason: "status-not-notifiable" };
  const shipped = r.delivery_method === "ship";
  const total = await acceptedTotal(r);
  const due = sortingBalanceDueCents(total, r.amount_paid_cents);
  const payButton =
    due > 0 && stripeConfigured() ? { href: sortingQuoteUrl(r), label: `Pay ${money(due)} online` } : null;

  let data: Omit<SortingEmailData, "siteUrl" | "logoUrl" | "supportEmail" | "reasonLine">;
  let subject: string;
  switch (status) {
    case "awaiting_cards":
      subject = shipped ? `Ready for your cards — ${r.reference_number}` : `Let's set up your drop-off — ${r.reference_number}`;
      data = shipped
        ? {
            previewText: "Here's where to ship your collection.",
            heading: "We're ready for your cards",
            paragraphs: [
              `Hi ${r.first_name}, we're ready for your collection. Please ship it to the address below and put a note inside the box with your reference number, ${r.reference_number}.`,
            ],
            note: message,
            address: { title: "Ship your cards to", lines: shipFromLines() },
            lists: shippingLists(),
          }
        : {
            previewText: "Let's pick a time and place for your drop-off.",
            heading: "Let's set up your drop-off",
            paragraphs: [
              `Hi ${r.first_name}, we're ready for your collection. Reply to this email to pick a time and place to drop it off in the St. Louis area, and bring your reference number, ${r.reference_number}.`,
            ],
            note: message,
          };
      break;
    case "received":
      subject = `We've got your cards — ${r.reference_number}`;
      data = {
        previewText: "Your collection arrived and is in line for sorting.",
        heading: "We've got your cards",
        paragraphs: [
          `Hi ${r.first_name}, your collection ${shipped ? "arrived safely" : "is with us"} and is in line for sorting.`,
          r.accepted_quote_id
            ? "We'll let you know when it's sorted."
            : shipped
              ? "We'll count your cards and send you a complete quote — sorting, return shipping and packaging — to approve before you pay anything."
              : "We'll count your cards and send you a complete quote to approve before you pay anything.",
        ],
        note: message,
      };
      break;
    case "ready":
      subject = shipped ? `Your collection is sorted — ${r.reference_number}` : `Ready for pickup — ${r.reference_number}`;
      data = {
        previewText: shipped ? "We're getting it ready to ship back to you." : "Your sorted collection is ready for pickup.",
        heading: shipped ? "Your collection is sorted" : "Ready for pickup",
        paragraphs: [
          shipped
            ? `Hi ${r.first_name}, your collection is sorted and we're getting it ready to ship back to you.`
            : `Hi ${r.first_name}, your sorted collection is ready. Reply to this email to set up a pickup time.`,
          due > 0
            ? shipped
              ? `Your balance is ${money(due)}. We'll ship your collection as soon as it's paid.`
              : `Your balance is ${money(due)} — pay online now or when you pick up.`
            : "It's paid in full — thank you!",
        ],
        note: message,
        button: payButton,
      };
      break;
    case "returned":
      subject = shipped ? `Your collection is on its way — ${r.reference_number}` : `Thanks for picking up — ${r.reference_number}`;
      data = shipped
        ? {
            previewText: "Your sorted collection is on its way back to you.",
            heading: "Your collection is on its way",
            paragraphs: [`Hi ${r.first_name}, your sorted collection is on its way back to you.`],
            note: message,
            rows: r.return_tracking_number
              ? [
                  ...(r.return_carrier ? [{ label: "Carrier", value: r.return_carrier }] : []),
                  { label: "Tracking number", value: r.return_tracking_number },
                ]
              : [],
            closing: ["Thanks for trusting us with your cards!"],
          }
        : {
            previewText: "Thanks for trusting us with your cards.",
            heading: "Thanks for picking up your collection",
            paragraphs: [`Hi ${r.first_name}, thanks for trusting us with your cards. Enjoy your sorted collection!`],
            note: message,
          };
      break;
    default:
      subject = `Your sorting request was cancelled — ${r.reference_number}`;
      data = {
        previewText: "Your collection sorting request was cancelled.",
        heading: "Your sorting request was cancelled",
        paragraphs: [
          `Hi ${r.first_name}, your collection sorting request ${r.reference_number} was cancelled.`,
          "If that's a mistake, or you have any questions, just reply to this email.",
        ],
        note: message,
      };
  }
  return sendCustomer(r, `sorting_status_${status}`, `sorting-status-${r.id}-${status}-${r.status_changed_at}`, subject, data);
}

/** The itemized quote, with the link to approve and pay. A revision says what it would replace. */
export async function sendSortingQuote(quoteId: string): Promise<Result> {
  const quote = await loadQuote(quoteId);
  if (!quote || quote.status !== "sent") return { status: "skipped", reason: "quote-not-sent" };
  const r = await loadSortingRequest(quote.request_id);
  if (!r) return { status: "skipped", reason: "request-not-found" };
  const approved = r.accepted_quote_id && r.accepted_quote_id !== quote.id ? await loadQuote(r.accepted_quote_id) : null;
  const revision = approved !== null;
  const paragraphs = [
    revision
      ? `Hi ${r.first_name}, here's a revised quote for sorting your collection.`
      : `Hi ${r.first_name}, here's your complete quote for sorting your collection. Nothing is charged until you approve it.`,
  ];
  if (approved) {
    paragraphs.push(
      `It replaces the ${money(approved.total_cents)} total you approved only if you approve this one. Until then, your approved total stays the same.`,
    );
  }
  return sendCustomer(
    r,
    "sorting_quote",
    `sorting-quote-${quote.id}`,
    `${revision ? "Your revised sorting quote" : "Your sorting quote"} — ${r.reference_number}`,
    {
      previewText: `Your quote: ${money(quote.total_cents)}. Review and approve it online.`,
      heading: revision ? "Your revised quote" : "Your quote is ready",
      paragraphs,
      note: quote.note_to_customer,
      quote: quoteBlock(r, quote),
      button: { href: sortingQuoteUrl(r), label: "Review and approve your quote" },
      closing: ["Questions about your quote? Just reply to this email."],
    },
  );
}

/** Confirms an approval, with what's left to pay. */
export async function sendSortingQuoteApproved(quoteId: string): Promise<Result> {
  const quote = await loadQuote(quoteId);
  if (!quote || quote.status !== "accepted") return { status: "skipped", reason: "quote-not-accepted" };
  const r = await loadSortingRequest(quote.request_id);
  if (!r) return { status: "skipped", reason: "request-not-found" };
  const due = sortingBalanceDueCents(quote.total_cents, r.amount_paid_cents);
  const shipped = r.delivery_method === "ship";
  return sendCustomer(r, "sorting_quote_approved", `sorting-quote-approved-${quote.id}`, `Quote approved — ${r.reference_number}`, {
    previewText: `You approved ${money(quote.total_cents)} for sorting your collection.`,
    heading: "Thanks — your quote is approved",
    paragraphs: [
      `Hi ${r.first_name}, you approved a total of ${money(quote.total_cents)} for sorting your collection.`,
      due <= 0
        ? "It's paid in full — thank you!"
        : shipped
          ? `Your balance is ${money(due)}. We'll ship your collection back once it's sorted and paid.`
          : `Your balance is ${money(due)}. Pay online any time, or when you pick up your cards.`,
    ],
    quote: quoteBlock(r, quote, "Approved total"),
    button: due > 0 && stripeConfigured() ? { href: sortingQuoteUrl(r), label: `Pay ${money(due)} online` } : null,
  });
}

/** A receipt for any payment (card online or recorded in person). */
export async function sendSortingPaymentReceipt(paymentId: string): Promise<Result> {
  const { data, error } = await getSupabaseAdmin().from("sorting_payments").select("*").eq("id", paymentId).maybeSingle();
  const payment = error ? null : ((data as SortingPaymentRow | null) ?? null);
  if (!payment) return { status: "skipped", reason: "payment-not-found" };
  const r = await loadSortingRequest(payment.request_id);
  if (!r) return { status: "skipped", reason: "request-not-found" };
  const total = await acceptedTotal(r);
  const due = sortingBalanceDueCents(total, r.amount_paid_cents);
  const shipped = r.delivery_method === "ship";
  const method = SORTING_PAYMENT_METHOD_LABELS[payment.method as SortingPaymentMethod] ?? payment.method;
  const next =
    r.status === "returned"
      ? null
      : due > 0
        ? `Your remaining balance is ${money(due)}.`
        : shipped
          ? r.status === "ready"
            ? "You're paid in full — we'll ship your collection back shortly."
            : "You're paid in full. We'll ship your collection back once it's sorted."
          : r.status === "ready"
            ? "You're paid in full — your collection is ready for pickup."
            : "You're paid in full. We'll let you know when your collection is ready for pickup.";
  return sendCustomer(r, "sorting_payment_receipt", `sorting-payment-${payment.id}`, `Payment received — ${r.reference_number}`, {
    previewText: `We received your payment of ${money(payment.amount_cents)}.`,
    heading: "Payment received",
    paragraphs: [`Thanks, ${r.first_name}! We received your payment for sorting your collection.`, ...(next ? [next] : [])],
    rows: [
      { label: "Reference", value: r.reference_number },
      { label: "Amount paid", value: money(payment.amount_cents) },
      { label: "Paid by", value: method },
      { label: "Date", value: new Date(payment.created_at).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "America/Chicago" }) },
      ...(total != null ? [{ label: "Approved total", value: money(total) }] : []),
      { label: "Paid so far", value: money(r.amount_paid_cents) },
      { label: "Balance", value: due > 0 ? money(due) : "Paid in full" },
    ],
  });
}

/* ------------------------------------------------------------------ *
 * Staff alerts: a push to the admin app and an email to the sorting inbox.
 * ------------------------------------------------------------------ */

export type SortingStaffEvent =
  | { kind: "new_request" }
  | { kind: "quote_approved"; quoteId: string }
  | { kind: "quote_declined"; quoteId: string; reason: string | null }
  | { kind: "payment"; paymentId: string; amountCents: number };

/** Push and email staff about something a customer did. Never throws. */
export async function notifySortingStaff(requestId: string, event: SortingStaffEvent): Promise<void> {
  try {
    const r = await loadSortingRequest(requestId);
    if (!r) return;
    const name = shortName(r.first_name, r.last_name);
    const fullName = `${r.first_name} ${r.last_name}`.trim();
    const url = adminSortingUrl(r.id);
    let title: string;
    let body: string;
    let key: string;
    let heading: string;
    let rows: { label: string; value: string }[] = [
      { label: "Reference", value: r.reference_number },
      { label: "Customer", value: `${fullName} <${r.email}>` },
    ];
    if (event.kind === "new_request") {
      key = `sorting_request:${r.id}`;
      title = `Sorting request · ${name}`;
      body = [r.delivery_method === "ship" ? "Shipping in" : "Drop-off", `~${cards(r.estimated_cards)}`, r.option_name].join(" · ");
      heading = "New collection sorting request";
      rows = [
        ...rows,
        ...(r.phone ? [{ label: "Phone", value: r.phone }] : []),
        { label: "Service", value: `${r.option_name} (${formatRatePerThousand(r.rate_per_thousand_cents)})` },
        { label: "Estimated cards", value: cards(r.estimated_cards) },
        { label: "Sorting estimate", value: money(r.estimated_sorting_cents) },
        { label: "Getting it to us", value: SORTING_DELIVERY_LABELS[r.delivery_method] },
        ...(r.delivery_method === "ship" && r.return_city
          ? [{ label: "Ships back to", value: `${r.return_city}, ${r.return_state} ${r.return_postal_code}` }]
          : []),
        ...(r.customer_notes ? [{ label: "Notes", value: r.customer_notes }] : []),
      ];
    } else if (event.kind === "quote_approved") {
      const quote = await loadQuote(event.quoteId);
      key = `sorting_quote_approved:${event.quoteId}`;
      title = `Quote approved · ${r.reference_number}`;
      body = [quote ? money(quote.total_cents) : null, name].filter(Boolean).join(" · ");
      heading = "Sorting quote approved";
      if (quote) rows.push({ label: "Approved total", value: money(quote.total_cents) }, { label: "Quote version", value: String(quote.version) });
    } else if (event.kind === "quote_declined") {
      key = `sorting_quote_declined:${event.quoteId}`;
      title = `Quote declined · ${r.reference_number}`;
      body = event.reason ? `${name}: "${event.reason}"` : name;
      heading = "Sorting quote declined";
      rows.push({ label: "Reason", value: event.reason ?? "(none given)" });
    } else {
      key = `sorting_payment:${event.paymentId}`;
      title = `Sorting payment · ${money(event.amountCents)}`;
      body = `${r.reference_number} · ${name}`;
      heading = "Collection sorting payment received";
      const total = await acceptedTotal(r);
      rows.push(
        { label: "Amount", value: money(event.amountCents) },
        { label: "Paid so far", value: money(r.amount_paid_cents) },
        { label: "Balance", value: money(sortingBalanceDueCents(total, r.amount_paid_cents)) },
      );
    }

    await notifyStaff({ key, kind: "sorting_request", title, body, url, tag: `sorting_request:${r.id}` });

    const data: SortingEmailData = {
      ...base(),
      previewText: `${heading} — ${r.reference_number}`,
      heading,
      paragraphs: [],
      rows,
      button: { href: url, label: "Open in the admin" },
    };
    const digest = crypto.createHash("sha256").update(key).digest("hex").slice(0, 24);
    const result = await sendTrackedEmail({
      emailType: `sorting_staff_${event.kind}`,
      idempotencyKey: `sorting-staff-${digest}`,
      to: ServerEnv.sortingNotificationEmail(),
      from: ServerEnv.fromOrders(),
      replyTo: r.email,
      subject: `${heading} — ${r.reference_number}`,
      react: React.createElement(SortingEmail, data),
      text: sortingEmailText(data),
    });
    if (result.status === "failed") console.error("[sortingEmails] staff email failed", key, result.error);
  } catch (err) {
    console.error("[sortingEmails] notifySortingStaff failed", requestId, event.kind, err);
  }
}
