import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../../_lib/http.js";
import { requireStaff, type StaffContext } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { logAdminAction } from "../../_lib/auditLog.js";
import {
  UUID_RE,
  cleanText,
  loadSortingRequest,
  sortingDbError,
  type SortingQuoteRow,
  type SortingRequestRow,
} from "../../_lib/sorting.js";
import {
  isNotifiableSortingStatus,
  sendSortingPaymentReceipt,
  sendSortingQuote,
  sendSortingStatusUpdate,
} from "../../_lib/sortingEmails.js";
import {
  SORTING_LIMITS,
  SORTING_MANUAL_PAYMENT_METHODS,
  SORTING_MANUAL_STATUSES,
  checkQuoteItems,
  formatUsdCents,
  sortingBalanceDueCents,
  type SortingPaymentMethod,
  type SortingRequestStatus,
} from "../../../src/store/lib/sortingService.js";
import type { Database } from "../../../src/types/database.js";

// Staff-only. Every write to a collection sorting request goes through here
// (authenticated has no write grant on the sorting tables).
//
// PATCH /api/admin/sorting-requests/:id
//   { status?, customerMessage?, internalNotes?, countedCards?, returnCarrier?, returnTrackingNumber? }
//   Status changes email the customer for the steps they wait on (ready for
//   the cards, received, ready, returned, cancelled), with the optional
//   message. "quoted" and "approved" can't be picked here: they only come
//   from sending a quote and the customer approving it. "returned" needs an
//   approved quote that's paid in full.
//
// POST /api/admin/sorting-requests/:id
//   { action: "save-quote", items, countedCards?, noteToCustomer? }  create or update the draft
//   { action: "send-quote", quoteId }                                 email it to the customer
//   { action: "discard-draft", quoteId }
//   { action: "record-payment", amountCents, method, note? }          an in-person payment
//
// Approved charges can't change here or anywhere: a sent quote is frozen by
// the database, and a change is a new version the customer has to approve.

type RequestUpdate = Database["public"]["Tables"]["sorting_requests"]["Update"];

interface PatchBody {
  status?: unknown;
  customerMessage?: unknown;
  internalNotes?: unknown;
  countedCards?: unknown;
  returnCarrier?: unknown;
  returnTrackingNumber?: unknown;
}

interface PostBody {
  action?: unknown;
  items?: unknown;
  countedCards?: unknown;
  noteToCustomer?: unknown;
  quoteId?: unknown;
  amountCents?: unknown;
  method?: unknown;
  note?: unknown;
}

function countedCardsFrom(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > SORTING_LIMITS.maxCountedCards) {
    throw new HttpError(400, "Counted cards must be a whole number.");
  }
  return value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "PATCH" && req.method !== "POST") return methodNotAllowed(res, ["PATCH", "POST"]);
  try {
    const staff = await requireStaff(req);
    const id = String(req.query.id ?? "");
    if (!UUID_RE.test(id)) throw new HttpError(400, "Request id is required.");
    const request = await loadSortingRequest(id);
    if (!request) throw new HttpError(404, "Sorting request not found.");

    if (req.method === "PATCH") {
      const body = (await readJsonBody(req, 16 * 1024)) as PatchBody;
      return sendJson(res, 200, await patchRequest(request, body));
    }

    const body = (await readJsonBody(req, 16 * 1024)) as PostBody;
    switch (body.action) {
      case "save-quote":
        return sendJson(res, 200, await saveDraft(request, staff, body));
      case "send-quote":
        return sendJson(res, 200, await sendQuote(request, staff, body));
      case "discard-draft":
        return sendJson(res, 200, await discardDraft(request, body));
      case "record-payment":
        return sendJson(res, 200, await recordPayment(request, staff, body));
      default:
        throw new HttpError(400, "Unknown action.");
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[admin/sorting-requests] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}

async function acceptedQuote(request: SortingRequestRow): Promise<SortingQuoteRow | null> {
  if (!request.accepted_quote_id) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("sorting_quotes")
    .select("*")
    .eq("id", request.accepted_quote_id)
    .maybeSingle();
  if (error) throw new HttpError(500, "Could not load the approved quote.");
  return (data as SortingQuoteRow | null) ?? null;
}

async function patchRequest(request: SortingRequestRow, body: PatchBody) {
  const patch: RequestUpdate = {};
  let newStatus: SortingRequestStatus | null = null;

  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !(SORTING_MANUAL_STATUSES as readonly string[]).includes(body.status)) {
      throw new HttpError(400, "That status can't be set by hand. Quotes move a request to Quote sent and Quote approved.");
    }
    newStatus = body.status as SortingRequestStatus;
    if (newStatus !== request.status) {
      if (newStatus === "returned") {
        const quote = await acceptedQuote(request);
        if (!quote) throw new HttpError(409, "The customer hasn't approved a quote yet, so this can't be marked returned.");
        const due = sortingBalanceDueCents(quote.total_cents, request.amount_paid_cents);
        if (due > 0) {
          throw new HttpError(409, `This request still has a balance of ${formatUsdCents(due)}. Record the payment first.`);
        }
      }
      patch.status = newStatus;
    } else {
      newStatus = null;
    }
  }
  if (body.internalNotes !== undefined) {
    if (body.internalNotes !== null && (typeof body.internalNotes !== "string" || body.internalNotes.length > 10_000)) {
      throw new HttpError(400, "Internal notes are too long.");
    }
    patch.internal_notes = typeof body.internalNotes === "string" && body.internalNotes.trim() ? body.internalNotes : null;
  }
  const counted = countedCardsFrom(body.countedCards);
  if (counted !== undefined) patch.counted_cards = counted;
  if (body.returnCarrier !== undefined) patch.return_carrier = cleanText(body.returnCarrier, 40);
  if (body.returnTrackingNumber !== undefined) patch.return_tracking_number = cleanText(body.returnTrackingNumber, 80);

  if (Object.keys(patch).length === 0) {
    return { ok: true, unchanged: true };
  }

  const { error } = await getSupabaseAdmin().from("sorting_requests").update(patch).eq("id", request.id);
  if (error) throw sortingDbError(error, "Could not save the request.");

  let emailed = false;
  if (newStatus && isNotifiableSortingStatus(newStatus)) {
    const message = cleanText(body.customerMessage, 1000);
    try {
      const result = await sendSortingStatusUpdate(request.id, newStatus, message);
      emailed = result.status === "sent" || result.status === "deduped";
    } catch (mailErr) {
      console.error("[admin/sorting-requests] status email failed", mailErr);
    }
  }
  return { ok: true, emailed };
}

async function saveDraft(request: SortingRequestRow, staff: StaffContext, body: PostBody) {
  const check = checkQuoteItems(body.items);
  if (!check.ok) throw new HttpError(400, check.message);
  const counted = countedCardsFrom(body.countedCards) ?? null;
  const note = cleanText(body.noteToCustomer, SORTING_LIMITS.maxNoteToCustomer);
  const fields = {
    counted_cards: counted,
    sorting_service_cents: check.items.sortingServiceCents,
    return_shipping_cents: check.items.returnShippingCents,
    return_packaging_cents: check.items.returnPackagingCents,
    other_charges: check.items.otherCharges as unknown as Database["public"]["Tables"]["sorting_quotes"]["Insert"]["other_charges"],
    note_to_customer: note,
  };

  const admin = getSupabaseAdmin();
  const { data: quotes, error: listErr } = await admin
    .from("sorting_quotes")
    .select("id, version, status")
    .eq("request_id", request.id)
    .order("version", { ascending: false });
  if (listErr) throw new HttpError(500, "Could not load the quotes.");
  const draft = (quotes ?? []).find((q) => q.status === "draft");

  if (draft) {
    const { data, error } = await admin
      .from("sorting_quotes")
      .update(fields)
      .eq("id", draft.id)
      .eq("status", "draft")
      .select("*")
      .maybeSingle();
    if (error) throw sortingDbError(error, "Could not save the quote.");
    if (!data) throw new HttpError(409, "That draft was just sent or removed. Reload to see the latest.");
    return { ok: true, quote: data };
  }

  const version = Math.max(0, ...(quotes ?? []).map((q) => q.version)) + 1;
  const { data, error } = await admin
    .from("sorting_quotes")
    .insert({ ...fields, request_id: request.id, version, created_by: staff.userId })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "Someone else just started a quote for this request. Reload to see it.");
    throw sortingDbError(error, "Could not save the quote.");
  }
  return { ok: true, quote: data };
}

async function sendQuote(request: SortingRequestRow, staff: StaffContext, body: PostBody) {
  const quoteId = typeof body.quoteId === "string" && UUID_RE.test(body.quoteId) ? body.quoteId : null;
  if (!quoteId) throw new HttpError(400, "Which quote should be sent?");
  const admin = getSupabaseAdmin();
  const { data: owned, error: ownErr } = await admin
    .from("sorting_quotes")
    .select("id, request_id, status")
    .eq("id", quoteId)
    .eq("request_id", request.id)
    .maybeSingle();
  if (ownErr) throw new HttpError(500, "Could not load the quote.");
  if (!owned) throw new HttpError(404, "Quote not found.");

  const { data: sent, error } = await admin.rpc("sorting_send_quote", { p_quote_id: quoteId, p_actor: staff.userId });
  if (error) throw sortingDbError(error, "Could not send the quote.");
  // A function returning one row comes back as an object (an array from some clients).
  const quote = (Array.isArray(sent) ? sent[0] : sent) as unknown as SortingQuoteRow;
  if (!quote) throw new HttpError(500, "Could not send the quote.");

  let emailed = false;
  try {
    const result = await sendSortingQuote(quoteId);
    emailed = result.status === "sent" || result.status === "deduped";
  } catch (mailErr) {
    console.error("[admin/sorting-requests] quote email failed", mailErr);
  }
  await logAdminAction(admin, staff, {
    action: "sorting.quote_sent",
    resourceType: "sorting_request",
    resourceId: request.id,
    after: { reference_number: request.reference_number, quote_id: quote.id, version: quote.version, total_cents: quote.total_cents },
  });
  return { ok: true, quote, emailed };
}

async function discardDraft(request: SortingRequestRow, body: PostBody) {
  const quoteId = typeof body.quoteId === "string" && UUID_RE.test(body.quoteId) ? body.quoteId : null;
  if (!quoteId) throw new HttpError(400, "Which draft should be removed?");
  const { data, error } = await getSupabaseAdmin()
    .from("sorting_quotes")
    .delete()
    .eq("id", quoteId)
    .eq("request_id", request.id)
    .eq("status", "draft")
    .select("id");
  if (error) throw sortingDbError(error, "Could not remove the draft.");
  if (!data || data.length === 0) throw new HttpError(409, "Only an unsent draft can be removed.");
  return { ok: true };
}

async function recordPayment(request: SortingRequestRow, staff: StaffContext, body: PostBody) {
  const amount = body.amountCents;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    throw new HttpError(400, "Enter the amount received.");
  }
  if (typeof body.method !== "string" || !(SORTING_MANUAL_PAYMENT_METHODS as readonly string[]).includes(body.method)) {
    throw new HttpError(400, "Choose how they paid.");
  }
  const method = body.method as SortingPaymentMethod;
  const note = cleanText(body.note, 500);

  const quote = await acceptedQuote(request);
  if (!quote) throw new HttpError(409, "The customer hasn't approved a quote yet, so there's nothing to pay.");
  const due = sortingBalanceDueCents(quote.total_cents, request.amount_paid_cents);
  if (due <= 0) throw new HttpError(409, "This request is already paid in full.");
  if (amount > due) {
    throw new HttpError(400, `That's more than the balance of ${formatUsdCents(due)}. The approved total can't be exceeded.`);
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("sorting_record_payment", {
    p_request_id: request.id,
    p_amount_cents: amount,
    p_method: method,
    p_note: note ?? undefined,
    p_actor: staff.userId,
  });
  if (error) throw sortingDbError(error, "Could not record the payment.");
  const result = (data ?? {}) as { payment_id?: string; amount_paid_cents?: number };

  let emailed = false;
  if (result.payment_id) {
    try {
      const sent = await sendSortingPaymentReceipt(result.payment_id);
      emailed = sent.status === "sent" || sent.status === "deduped";
    } catch (mailErr) {
      console.error("[admin/sorting-requests] receipt email failed", mailErr);
    }
  }
  await logAdminAction(admin, staff, {
    action: "sorting.payment_recorded",
    resourceType: "sorting_request",
    resourceId: request.id,
    after: { reference_number: request.reference_number, amount_cents: amount, method, payment_id: result.payment_id ?? null },
  });
  return { ok: true, amountPaidCents: result.amount_paid_cents ?? null, emailed };
}
