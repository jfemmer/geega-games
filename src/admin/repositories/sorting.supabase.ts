import { supabase } from "../../supabase";
import { adminFetch } from "./apiClient";
import type {
  SortingOptionAdmin,
  SortingPaymentAdmin,
  SortingQuoteAdmin,
  SortingRequestDetail,
  SortingRequestSummary,
} from "../types";
import type { SortingQuoteItems } from "../../store/lib/sortingService";

// LIVE repository for Collection Sorting (sorting_requests, sorting_quotes,
// sorting_payments, sorting_service_options). Same split as photo requests:
//   * reads use the browser client directly (staff-only SELECT policies);
//   * every write goes through /api/admin/sorting-requests/:id and
//     /api/admin/sorting-options (service_role — `authenticated` has no
//     write grant on these tables), which also send the customer emails.

interface RequestRow {
  id: string;
  reference_number: string;
  created_at: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  option_name: string;
  rate_per_thousand_cents: number;
  estimated_cards: number;
  estimated_sorting_cents: number;
  delivery_method: "drop_off" | "ship";
  return_recipient: string | null;
  return_line1: string | null;
  return_line2: string | null;
  return_city: string | null;
  return_state: string | null;
  return_postal_code: string | null;
  shipping_terms_accepted_at: string | null;
  shipping_terms_text: string | null;
  customer_notes: string | null;
  status: SortingRequestSummary["status"];
  status_changed_at: string;
  counted_cards: number | null;
  internal_notes: string | null;
  accepted_quote_id: string | null;
  amount_paid_cents: number;
  return_carrier: string | null;
  return_tracking_number: string | null;
  received_at: string | null;
  returned_at: string | null;
  cancelled_at: string | null;
}

interface QuoteRow {
  id: string;
  request_id: string;
  version: number;
  status: SortingQuoteAdmin["status"];
  counted_cards: number | null;
  sorting_service_cents: number;
  return_shipping_cents: number;
  return_packaging_cents: number;
  other_charges: unknown;
  total_cents: number;
  note_to_customer: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  superseded_at: string | null;
}

interface PaymentRow {
  id: string;
  amount_cents: number;
  method: SortingPaymentAdmin["method"];
  provider_reference: string | null;
  note: string | null;
  created_at: string;
}

interface OptionRow {
  id: string;
  name: string;
  description: string | null;
  rate_per_thousand_cents: number;
  sort_order: number;
  active: boolean;
  updated_at: string;
}

/** A list row: the request plus where its quote and payment stand. */
export interface SortingListRow extends SortingRequestSummary {
  /** The newest quote sent to the customer (not drafts). */
  latestQuote: { status: SortingQuoteAdmin["status"]; totalCents: number; version: number } | null;
  acceptedTotalCents: number | null;
  hasDraft: boolean;
}

const LIST_LIMIT = 500;

function summaryOf(row: RequestRow): SortingRequestSummary {
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    createdAt: row.created_at,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    deliveryMethod: row.delivery_method,
    optionName: row.option_name,
    estimatedCards: row.estimated_cards,
    countedCards: row.counted_cards,
    status: row.status,
    acceptedQuoteId: row.accepted_quote_id,
    amountPaidCents: row.amount_paid_cents,
  };
}

function otherChargesOf(value: unknown): { label: string; amountCents: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    return typeof o.label === "string" && typeof o.amountCents === "number"
      ? [{ label: o.label, amountCents: o.amountCents }]
      : [];
  });
}

function quoteOf(row: QuoteRow): SortingQuoteAdmin {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    countedCards: row.counted_cards,
    sortingServiceCents: row.sorting_service_cents,
    returnShippingCents: row.return_shipping_cents,
    returnPackagingCents: row.return_packaging_cents,
    otherCharges: otherChargesOf(row.other_charges),
    totalCents: row.total_cents,
    noteToCustomer: row.note_to_customer,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
    declineReason: row.decline_reason,
    supersededAt: row.superseded_at,
  };
}

function optionOf(row: OptionRow): SortingOptionAdmin {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ratePerThousandCents: row.rate_per_thousand_cents,
    sortOrder: row.sort_order,
    active: row.active,
    updatedAt: row.updated_at,
  };
}

export interface RequestPatch {
  status?: string;
  /** Sent with the status email (when the status change emails the customer). */
  customerMessage?: string;
  internalNotes?: string;
  countedCards?: number | null;
  returnCarrier?: string;
  returnTrackingNumber?: string;
}

export interface DraftInput {
  items: SortingQuoteItems;
  countedCards: number | null;
  noteToCustomer: string;
}

export interface OptionInput {
  name: string;
  description: string;
  ratePerThousandCents: number;
  sortOrder: number;
  active: boolean;
}

export const sortingRepository = {
  async list(): Promise<SortingListRow[]> {
    const { data, error } = await supabase
      .from("sorting_requests")
      .select(
        "id, reference_number, created_at, first_name, last_name, email, delivery_method, option_name, estimated_cards, counted_cards, status, accepted_quote_id, amount_paid_cents",
      )
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RequestRow[];
    if (rows.length === 0) return [];

    const { data: quoteData, error: quoteErr } = await supabase
      .from("sorting_quotes")
      .select("id, request_id, version, status, total_cents")
      .in(
        "request_id",
        rows.map((r) => r.id),
      );
    if (quoteErr) throw new Error(quoteErr.message);
    const quotes = (quoteData ?? []) as Pick<QuoteRow, "id" | "request_id" | "version" | "status" | "total_cents">[];

    return rows.map((row) => {
      const mine = quotes.filter((q) => q.request_id === row.id);
      const latest = mine.filter((q) => q.status !== "draft").sort((a, b) => b.version - a.version)[0] ?? null;
      const accepted = row.accepted_quote_id ? (mine.find((q) => q.id === row.accepted_quote_id) ?? null) : null;
      return {
        ...summaryOf(row),
        latestQuote: latest ? { status: latest.status, totalCents: latest.total_cents, version: latest.version } : null,
        acceptedTotalCents: accepted ? accepted.total_cents : null,
        hasDraft: mine.some((q) => q.status === "draft"),
      };
    });
  },

  async get(id: string): Promise<SortingRequestDetail> {
    const [{ data: row, error }, { data: quoteRows, error: quoteErr }, { data: paymentRows, error: payErr }] =
      await Promise.all([
        supabase.from("sorting_requests").select("*").eq("id", id).maybeSingle(),
        supabase.from("sorting_quotes").select("*").eq("request_id", id).order("version", { ascending: false }),
        supabase
          .from("sorting_payments")
          .select("id, amount_cents, method, provider_reference, note, created_at")
          .eq("request_id", id)
          .order("created_at", { ascending: true }),
      ]);
    if (error) throw new Error(error.message);
    if (quoteErr) throw new Error(quoteErr.message);
    if (payErr) throw new Error(payErr.message);
    if (!row) throw new Error("Sorting request not found.");
    const r = row as RequestRow;
    return {
      ...summaryOf(r),
      userId: r.user_id,
      phone: r.phone,
      ratePerThousandCents: r.rate_per_thousand_cents,
      estimatedSortingCents: r.estimated_sorting_cents,
      customerNotes: r.customer_notes,
      internalNotes: r.internal_notes,
      statusChangedAt: r.status_changed_at,
      returnAddress:
        r.delivery_method === "ship"
          ? {
              recipient: r.return_recipient,
              line1: r.return_line1,
              line2: r.return_line2,
              city: r.return_city,
              state: r.return_state,
              postalCode: r.return_postal_code,
            }
          : null,
      shippingTermsAcceptedAt: r.shipping_terms_accepted_at,
      shippingTermsText: r.shipping_terms_text,
      returnCarrier: r.return_carrier,
      returnTrackingNumber: r.return_tracking_number,
      receivedAt: r.received_at,
      returnedAt: r.returned_at,
      cancelledAt: r.cancelled_at,
      quotes: ((quoteRows ?? []) as QuoteRow[]).map(quoteOf),
      payments: ((paymentRows ?? []) as PaymentRow[]).map((p) => ({
        id: p.id,
        amountCents: p.amount_cents,
        method: p.method,
        providerReference: p.provider_reference,
        note: p.note,
        createdAt: p.created_at,
      })),
    };
  },

  async updateRequest(id: string, patch: RequestPatch): Promise<{ emailed: boolean }> {
    const res = await adminFetch<{ emailed?: boolean }>(`/api/admin/sorting-requests/${id}`, {
      method: "PATCH",
      body: patch,
    });
    return { emailed: Boolean(res?.emailed) };
  },

  /** Creates or updates the request's draft quote; returns the draft's id. */
  async saveDraft(id: string, input: DraftInput): Promise<{ quoteId: string }> {
    const res = await adminFetch<{ quote?: { id?: string } }>(`/api/admin/sorting-requests/${id}`, {
      method: "POST",
      body: { action: "save-quote", ...input },
    });
    const quoteId = res?.quote?.id;
    if (!quoteId) throw new Error("The quote was saved, but couldn't be reloaded. Refresh and try again.");
    return { quoteId };
  },

  async sendQuote(id: string, quoteId: string): Promise<{ emailed: boolean }> {
    const res = await adminFetch<{ emailed?: boolean }>(`/api/admin/sorting-requests/${id}`, {
      method: "POST",
      body: { action: "send-quote", quoteId },
    });
    return { emailed: Boolean(res?.emailed) };
  },

  async discardDraft(id: string, quoteId: string): Promise<void> {
    await adminFetch(`/api/admin/sorting-requests/${id}`, {
      method: "POST",
      body: { action: "discard-draft", quoteId },
    });
  },

  async recordPayment(
    id: string,
    input: { amountCents: number; method: string; note: string },
  ): Promise<{ emailed: boolean }> {
    const res = await adminFetch<{ emailed?: boolean }>(`/api/admin/sorting-requests/${id}`, {
      method: "POST",
      body: { action: "record-payment", ...input },
    });
    return { emailed: Boolean(res?.emailed) };
  },

  async listOptions(): Promise<SortingOptionAdmin[]> {
    const { data, error } = await supabase
      .from("sorting_service_options")
      .select("id, name, description, rate_per_thousand_cents, sort_order, active, updated_at")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as OptionRow[]).map(optionOf);
  },

  async createOption(input: OptionInput): Promise<void> {
    await adminFetch("/api/admin/sorting-options", { method: "POST", body: input });
  },

  async updateOption(id: string, input: Partial<OptionInput>): Promise<void> {
    await adminFetch(`/api/admin/sorting-options?id=${encodeURIComponent(id)}`, { method: "PATCH", body: input });
  },

  async deleteOption(id: string): Promise<void> {
    await adminFetch(`/api/admin/sorting-options?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};
