import { supabase } from "../../supabase";
import type {
  SortingDeliveryMethod,
  SortingQuoteLine,
  SortingQuoteStatus,
  SortingRequestStatus,
} from "./sortingService";

// The storefront's side of collection sorting: the advertised rates (read
// straight from Supabase — anyone may read the active ones), the request
// form (/api/sorting-requests) and the quote page (/api/sorting-quote). The
// signed-in customer's session token rides along so the server can link the
// request to their account and let them act on their own quotes.

export interface SortingOption {
  id: string;
  name: string;
  description: string | null;
  ratePerThousandCents: number;
}

interface OptionRow {
  id: string;
  name: string;
  description: string | null;
  rate_per_thousand_cents: number;
}

/** The active rates, in the order staff set. Throws when they can't be loaded. */
export async function loadSortingOptions(): Promise<SortingOption[]> {
  const { data, error } = await supabase
    .from("sorting_service_options")
    .select("id, name, description, rate_per_thousand_cents")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as OptionRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    ratePerThousandCents: row.rate_per_thousand_cents,
  }));
}

async function accessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("We couldn't reach the server. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as (T & { ok?: boolean; message?: string }) | null;
  if (!res.ok || !body || body.ok === false) {
    const error = new Error(body?.message || "Something went wrong. Please try again.") as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return body;
}

export interface SortingRequestPayload {
  optionId: string;
  estimatedCards: number;
  deliveryMethod: SortingDeliveryMethod;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
  /** A saved address from the customer's address book… */
  returnAddressId?: string | null;
  /** …or one typed in. */
  returnAddress?: {
    recipient: string;
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
  } | null;
  shippingTermsAccepted: boolean;
  /** Honeypot. */
  website: string;
}

export async function submitSortingRequest(payload: SortingRequestPayload): Promise<{ referenceNumber: string }> {
  return post<{ referenceNumber: string }>("/api/sorting-requests", payload);
}

/* ------------------------------------------------------------------ *
 * The quote page
 * ------------------------------------------------------------------ */

export interface SortingQuoteView {
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

export interface SortingRequestView {
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
  returnTo: string | null;
  openQuote: SortingQuoteView | null;
  acceptedQuote: SortingQuoteView | null;
  latestQuote: SortingQuoteView | null;
  amountPaidCents: number;
  balanceDueCents: number;
  returnTracking: { carrier: string | null; number: string } | null;
  canRespond: boolean;
  payOnline: boolean;
}

export interface SortingQuoteAccess {
  referenceNumber: string;
  email: string;
  /** The token from the quote email's link, if the customer came that way. */
  token: string | null;
}

type ViewResponse = { request: SortingRequestView };

export async function lookupSortingRequest(access: SortingQuoteAccess): Promise<SortingRequestView> {
  return (await post<ViewResponse>("/api/sorting-quote", { action: "lookup", ...access })).request;
}

export async function approveSortingQuote(access: SortingQuoteAccess, quoteId: string): Promise<SortingRequestView> {
  return (await post<ViewResponse>("/api/sorting-quote", { action: "approve", quoteId, ...access })).request;
}

export async function declineSortingQuote(
  access: SortingQuoteAccess,
  quoteId: string,
  reason: string,
): Promise<SortingRequestView> {
  return (await post<ViewResponse>("/api/sorting-quote", { action: "decline", quoteId, reason, ...access })).request;
}

export type StartPaymentResult =
  | { kind: "pay"; clientSecret: string; amountDueCents: number }
  | { kind: "paid"; request: SortingRequestView };

export async function startSortingPayment(access: SortingQuoteAccess): Promise<StartPaymentResult> {
  const body = await post<{ clientSecret?: string; amountDueCents?: number; request?: SortingRequestView }>(
    "/api/sorting-quote",
    { action: "pay", ...access },
  );
  if (body.request) return { kind: "paid", request: body.request };
  return { kind: "pay", clientSecret: body.clientSecret ?? "", amountDueCents: body.amountDueCents ?? 0 };
}

export async function confirmSortingPayment(
  access: SortingQuoteAccess,
  paymentIntentId: string,
): Promise<{ request: SortingRequestView; paymentStatus: string | null }> {
  const body = await post<{ request: SortingRequestView; paymentStatus?: string }>("/api/sorting-quote", {
    action: "confirm-payment",
    paymentIntentId,
    ...access,
  });
  return { request: body.request, paymentStatus: body.paymentStatus ?? null };
}

/* ------------------------------------------------------------------ *
 * Account page
 * ------------------------------------------------------------------ */

export interface MySortingRequest {
  id: string;
  reference_number: string;
  created_at: string;
  status: SortingRequestStatus;
  delivery_method: SortingDeliveryMethod;
  option_name: string;
  estimated_cards: number;
  email: string;
  quote_status: SortingQuoteStatus | null;
  quote_total_cents: number | null;
  accepted_total_cents: number | null;
  amount_paid_cents: number;
}

export async function loadMySortingRequests(): Promise<MySortingRequest[]> {
  const { data, error } = await supabase.rpc("my_sorting_requests");
  if (error) throw new Error(error.message);
  return (data ?? []) as MySortingRequest[];
}
