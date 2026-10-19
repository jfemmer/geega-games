import { HttpError } from "./http.js";
import { guestTokensAvailable, signGuestToken, verifyGuestToken } from "./guestAccess.js";
import { siteUrl } from "./assets.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import {
  SORTING_QUOTE_PATH,
  sortingBalanceDueCents,
  sortingQuoteLines,
  sortingStatusLabel,
  type SortingDeliveryMethod,
  type SortingOtherCharge,
  type SortingQuoteItems,
  type SortingQuoteLine,
  type SortingQuoteStatus,
  type SortingRequestStatus,
} from "../../src/store/lib/sortingService.js";

// Server-side pieces shared by the collection sorting endpoints
// (api/sorting-requests.ts, api/sorting-quote.ts, api/admin/sorting-*.ts)
// and their emails: the row shapes, the customer's view of a request, the
// quote link, and turning the database's refusals into clear messages.

export interface SortingRequestRow {
  id: string;
  reference_number: string;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  option_id: string | null;
  option_name: string;
  rate_per_thousand_cents: number;
  estimated_cards: number;
  estimated_sorting_cents: number;
  delivery_method: SortingDeliveryMethod;
  return_address_id: string | null;
  return_recipient: string | null;
  return_line1: string | null;
  return_line2: string | null;
  return_city: string | null;
  return_state: string | null;
  return_postal_code: string | null;
  return_country: string | null;
  shipping_terms_accepted_at: string | null;
  shipping_terms_text: string | null;
  customer_notes: string | null;
  status: SortingRequestStatus;
  status_changed_at: string;
  counted_cards: number | null;
  internal_notes: string | null;
  accepted_quote_id: string | null;
  amount_paid_cents: number;
  stripe_payment_intent_id: string | null;
  return_carrier: string | null;
  return_tracking_number: string | null;
  received_at: string | null;
  returned_at: string | null;
  cancelled_at: string | null;
}

export interface SortingQuoteRow {
  id: string;
  request_id: string;
  version: number;
  status: SortingQuoteStatus;
  counted_cards: number | null;
  sorting_service_cents: number;
  return_shipping_cents: number;
  return_packaging_cents: number;
  other_charges: unknown;
  total_cents: number;
  note_to_customer: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  sent_at: string | null;
  sent_by: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  superseded_at: string | null;
}

export interface SortingPaymentRow {
  id: string;
  request_id: string;
  quote_id: string | null;
  amount_cents: number;
  method: string;
  provider_reference: string | null;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Trimmed text clipped to maxLen, or null when blank or not a string. */
export function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

/** other_charges as stored (jsonb), read defensively. */
export function otherChargesOf(value: unknown): SortingOtherCharge[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    return typeof o.label === "string" && typeof o.amountCents === "number"
      ? [{ label: o.label, amountCents: o.amountCents }]
      : [];
  });
}

export function quoteItemsOf(row: SortingQuoteRow): SortingQuoteItems & { countedCards: number | null } {
  return {
    sortingServiceCents: row.sorting_service_cents,
    returnShippingCents: row.return_shipping_cents,
    returnPackagingCents: row.return_packaging_cents,
    otherCharges: otherChargesOf(row.other_charges),
    countedCards: row.counted_cards,
  };
}

/**
 * The token in the quote email's link: it lets the customer approve, decline
 * and pay without signing in. Null when EMAIL_TOKEN_SECRET isn't set.
 */
export function sortingQuoteToken(requestId: string): string | null {
  return guestTokensAvailable() ? signGuestToken("sorting", requestId) : null;
}

export function verifySortingQuoteToken(requestId: string, token: unknown): boolean {
  return verifyGuestToken("sorting", requestId, token);
}

/** The customer's quote page for a request, with the action token when available. */
export function sortingQuoteUrl(request: Pick<SortingRequestRow, "id" | "reference_number" | "email">): string {
  const params = new URLSearchParams({ ref: request.reference_number, email: request.email });
  const token = sortingQuoteToken(request.id);
  if (token) params.set("t", token);
  return `${siteUrl()}${SORTING_QUOTE_PATH}?${params.toString()}`;
}

export function adminSortingUrl(requestId: string): string {
  return `${siteUrl()}/admin_dashboard/sorting?request=${requestId}`;
}

/** The database's refusals (see the migration's GGSxx codes) as HTTP errors with their own words. */
export function sortingDbError(error: { code?: string; message?: string } | null | undefined, fallback: string): HttpError {
  const code = error?.code ?? "";
  const message = error?.message ?? fallback;
  if (code === "GGS03") return new HttpError(404, message);
  if (code === "GGS01" || code === "GGS02" || code === "GGS04" || code === "23505") return new HttpError(409, message);
  if (code === "22023" || code === "23514") return new HttpError(400, message);
  return new HttpError(500, fallback);
}

export async function loadSortingRequest(id: string): Promise<SortingRequestRow | null> {
  const { data, error } = await getSupabaseAdmin().from("sorting_requests").select("*").eq("id", id).maybeSingle();
  if (error) throw new HttpError(500, "Could not load the request.");
  return (data as SortingRequestRow | null) ?? null;
}

export async function loadSortingQuotes(requestId: string): Promise<SortingQuoteRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("sorting_quotes")
    .select("*")
    .eq("request_id", requestId)
    .order("version", { ascending: false });
  if (error) throw new HttpError(500, "Could not load the quotes.");
  return (data ?? []) as SortingQuoteRow[];
}

/* ------------------------------------------------------------------ *
 * What the customer sees on the quote page. Never internal notes, staff
 * names, drafts or the full return address.
 * ------------------------------------------------------------------ */

export interface CustomerQuoteView {
  id: string;
  version: number;
  status: SortingQuoteStatus;
  countedCards: number | null;
  lines: SortingQuoteLine[];
  totalCents: number;
  noteToCustomer: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
}

export interface CustomerRequestView {
  referenceNumber: string;
  firstName: string;
  createdAt: string;
  status: SortingRequestStatus;
  statusLabel: string;
  deliveryMethod: SortingDeliveryMethod;
  optionName: string;
  ratePerThousandCents: number;
  estimatedCards: number;
  estimatedSortingCents: number;
  /** "Ballwin, MO 63011" — enough to recognise, not the street. */
  returnTo: string | null;
  /** The quote waiting for the customer's approval, if any. */
  openQuote: CustomerQuoteView | null;
  /** The quote they approved: the binding total. */
  acceptedQuote: CustomerQuoteView | null;
  /** The newest quote they were sent, whatever became of it. */
  latestQuote: CustomerQuoteView | null;
  amountPaidCents: number;
  balanceDueCents: number;
  returnTracking: { carrier: string | null; number: string } | null;
  /** Whether this visitor may approve, decline and pay (quote-link token or the signed-in owner). */
  canRespond: boolean;
  /** Whether card payment is set up on the server. */
  payOnline: boolean;
}

export function customerQuoteView(row: SortingQuoteRow, delivery: SortingDeliveryMethod): CustomerQuoteView {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    countedCards: row.counted_cards,
    lines: sortingQuoteLines(quoteItemsOf(row), delivery),
    totalCents: row.total_cents,
    noteToCustomer: row.note_to_customer,
    sentAt: row.sent_at,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
  };
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.trim());
}

export function customerRequestView(
  request: SortingRequestRow,
  quotes: SortingQuoteRow[],
  canRespond: boolean,
): CustomerRequestView {
  const delivery = request.delivery_method;
  const visible = quotes.filter((q) => q.status !== "draft").sort((a, b) => b.version - a.version);
  const open = visible.find((q) => q.status === "sent") ?? null;
  const accepted = request.accepted_quote_id ? (visible.find((q) => q.id === request.accepted_quote_id) ?? null) : null;
  const latest = visible[0] ?? null;
  const acceptedTotal = accepted ? accepted.total_cents : null;
  const place = [request.return_city, [request.return_state, request.return_postal_code].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return {
    referenceNumber: request.reference_number,
    firstName: request.first_name,
    createdAt: request.created_at,
    status: request.status,
    statusLabel: sortingStatusLabel(request.status, delivery),
    deliveryMethod: delivery,
    optionName: request.option_name,
    ratePerThousandCents: request.rate_per_thousand_cents,
    estimatedCards: request.estimated_cards,
    estimatedSortingCents: request.estimated_sorting_cents,
    returnTo: delivery === "ship" && place ? place : null,
    openQuote: open ? customerQuoteView(open, delivery) : null,
    acceptedQuote: accepted ? customerQuoteView(accepted, delivery) : null,
    latestQuote: latest ? customerQuoteView(latest, delivery) : null,
    amountPaidCents: request.amount_paid_cents,
    balanceDueCents: sortingBalanceDueCents(acceptedTotal, request.amount_paid_cents),
    returnTracking:
      delivery === "ship" && request.return_tracking_number
        ? { carrier: request.return_carrier, number: request.return_tracking_number }
        : null,
    canRespond,
    payOnline: stripeConfigured(),
  };
}
