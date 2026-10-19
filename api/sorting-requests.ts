import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "./_lib/http.js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { normalizeEmail } from "./_lib/tokens.js";
import { checkRateLimit, getClientIp } from "./_lib/rateLimit.js";
import { optionalUserId } from "./_lib/requestUser.js";
import { UUID_RE, cleanText } from "./_lib/sorting.js";
import { notifySortingStaff, sendSortingRequestReceived } from "./_lib/sortingEmails.js";
import {
  SORTING_LIMITS,
  SORTING_SHIPPING_TERMS,
  sortingEstimateCents,
  type SortingDeliveryMethod,
} from "../src/store/lib/sortingService.js";
import { SHIP_TO_COUNTRY, checkUsAddress } from "../src/store/lib/usAddress.js";
import type { Database } from "../src/types/database.js";

// POST /api/sorting-requests
//
// PUBLIC, guest-submittable: the request form on /collection-sorting. Stores
// the request, alerts staff (push + email) and emails the customer a receipt
// with what happens next — and, for shipped collections, the shipping policy.
//
// Trust boundaries — nothing that affects a price is taken from the browser:
//   - the sorting option and its per-1,000-card rate are read here from the
//     active rows of sorting_service_options, and the estimate is recomputed;
//   - a saved address (returnAddressId) must belong to the signed-in customer
//     and is copied from their address book; a typed address must be a US
//     address (the same rules as checkout, src/store/lib/usAddress.ts);
//   - shipping needs the shipping-terms checkbox; what's stored is the
//     server's own copy of its wording (SORTING_SHIPPING_TERMS), with the time;
//   - the account a request belongs to comes from the verified session token,
//     never from the body.
// No anon INSERT policy exists on sorting_requests: every write is here.

type SortingRequestInsert = Database["public"]["Tables"]["sorting_requests"]["Insert"];

const MAX_BODY_BYTES = 8 * 1024;
const RATE_LIMIT_PER_WINDOW = 5;
const RATE_WINDOW_MS = 10 * 60_000;
const MAX_REQUESTS_PER_EMAIL_PER_HOUR = 3;
/** A second identical request this soon is a double-submit: answer with the first one. */
const DUPLICATE_WINDOW_MS = 10 * 60_000;

interface AddressBody {
  recipient?: unknown;
  line1?: unknown;
  line2?: unknown;
  city?: unknown;
  state?: unknown;
  postalCode?: unknown;
}

interface Body {
  optionId?: unknown;
  estimatedCards?: unknown;
  deliveryMethod?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  notes?: unknown;
  returnAddressId?: unknown;
  returnAddress?: AddressBody;
  shippingTermsAccepted?: unknown;
  /** Honeypot: hidden from people, filled in by bots. */
  website?: unknown;
}

function cardCount(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.replace(/[\s,]/g, "")) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= SORTING_LIMITS.maxEstimatedCards ? n : null;
}

type ReturnAddress = Pick<
  SortingRequestInsert,
  | "return_address_id"
  | "return_recipient"
  | "return_line1"
  | "return_line2"
  | "return_city"
  | "return_state"
  | "return_postal_code"
  | "return_country"
>;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit("sorting-requests", ip, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many requests. Please wait a bit and try again.");
    }

    const body = (await readJsonBody(req, MAX_BODY_BYTES)) as Body;

    // A real person never fills the honeypot. Look successful, store nothing.
    if (cleanText(body.website, 200)) {
      return sendJson(res, 200, { ok: true, referenceNumber: "GG-SR-0000" });
    }

    const firstName = cleanText(body.firstName, 100);
    const lastName = cleanText(body.lastName, 100);
    const email = normalizeEmail(body.email);
    if (!firstName || !lastName || !email) {
      throw new HttpError(400, "Please enter your first name, last name and a valid email address.");
    }
    const phone = cleanText(body.phone, 40);
    const notes = cleanText(body.notes, SORTING_LIMITS.maxCustomerNotes);

    const optionId = typeof body.optionId === "string" ? body.optionId : "";
    if (!UUID_RE.test(optionId)) throw new HttpError(400, "Please choose a sorting option.");
    const estimatedCards = cardCount(body.estimatedCards);
    if (!estimatedCards) {
      throw new HttpError(
        400,
        `Please enter about how many cards you have (1 to ${SORTING_LIMITS.maxEstimatedCards.toLocaleString("en-US")}).`,
      );
    }
    const delivery = body.deliveryMethod;
    if (delivery !== "drop_off" && delivery !== "ship") {
      throw new HttpError(400, "Please choose whether you'll drop off or ship your collection.");
    }
    const deliveryMethod: SortingDeliveryMethod = delivery;

    const admin = getSupabaseAdmin();

    const { data: option, error: optionErr } = await admin
      .from("sorting_service_options")
      .select("id, name, rate_per_thousand_cents, active")
      .eq("id", optionId)
      .eq("active", true)
      .maybeSingle();
    if (optionErr) throw new HttpError(500, "We couldn't load the sorting options. Please try again.");
    if (!option) {
      throw new HttpError(409, "That sorting option isn't available anymore. Please refresh the page and choose again.");
    }

    const userId = await optionalUserId(req);

    let returnAddress: ReturnAddress = {};
    let termsAcceptedAt: string | null = null;
    if (deliveryMethod === "ship") {
      if (body.shippingTermsAccepted !== true) {
        throw new HttpError(400, "Please tick the box to confirm you understand the shipping terms.");
      }
      termsAcceptedAt = new Date().toISOString();
      returnAddress = await resolveReturnAddress(body, userId, `${firstName} ${lastName}`);
    }

    // Survives cold starts, unlike the per-instance IP limit above.
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const { data: recent, error: recentErr } = await admin
      .from("sorting_requests")
      .select("id, reference_number, created_at, option_id, delivery_method, estimated_cards, status")
      .eq("email", email)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10);
    if (recentErr) throw new HttpError(500, "We couldn't save your request. Please try again.");
    const duplicate = (recent ?? []).find(
      (r) =>
        r.status === "new" &&
        r.option_id === option.id &&
        r.delivery_method === deliveryMethod &&
        r.estimated_cards === estimatedCards &&
        Date.parse(r.created_at) > Date.now() - DUPLICATE_WINDOW_MS,
    );
    if (duplicate) {
      return sendJson(res, 200, { ok: true, referenceNumber: duplicate.reference_number, duplicate: true });
    }
    if ((recent ?? []).length >= MAX_REQUESTS_PER_EMAIL_PER_HOUR) {
      throw new HttpError(
        429,
        "You've sent several sorting requests in the last hour. We'll answer those first — or email us directly.",
      );
    }

    const insert: SortingRequestInsert = {
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      option_id: option.id,
      option_name: option.name,
      rate_per_thousand_cents: option.rate_per_thousand_cents,
      estimated_cards: estimatedCards,
      estimated_sorting_cents: sortingEstimateCents(option.rate_per_thousand_cents, estimatedCards),
      delivery_method: deliveryMethod,
      customer_notes: notes,
      shipping_terms_accepted_at: termsAcceptedAt,
      shipping_terms_text: termsAcceptedAt ? SORTING_SHIPPING_TERMS : null,
      ...returnAddress,
    };

    const { data: created, error } = await admin
      .from("sorting_requests")
      .insert(insert)
      .select("id, reference_number")
      .single();
    if (error || !created) {
      console.error("[/api/sorting-requests] insert failed:", error);
      throw new HttpError(500, "We couldn't save your request. Please try again.");
    }

    // Best-effort, and both idempotent: the request is saved either way.
    await notifySortingStaff(created.id, { kind: "new_request" });
    try {
      await sendSortingRequestReceived(created.id);
    } catch (err) {
      console.error("[/api/sorting-requests] confirmation email failed:", err, "request:", created.id);
    }

    return sendJson(res, 200, { ok: true, referenceNumber: created.reference_number });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/sorting-requests] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}

/**
 * Where a shipped collection goes back to: a saved address from the
 * customer's own address book, or one they typed. Either way it must be a US
 * address, and it's stored as a copy.
 */
async function resolveReturnAddress(body: Body, userId: string | null, fallbackName: string): Promise<ReturnAddress> {
  if (body.returnAddressId !== undefined && body.returnAddressId !== null && body.returnAddressId !== "") {
    const addressId = typeof body.returnAddressId === "string" ? body.returnAddressId : "";
    if (!UUID_RE.test(addressId)) throw new HttpError(400, "Please choose a return address.");
    if (!userId) throw new HttpError(401, "Please sign in again to use a saved address, or type the address in.");
    const { data: saved, error } = await getSupabaseAdmin()
      .from("addresses")
      .select("id, user_id, recipient, line1, line2, city, state, postal_code, country")
      .eq("id", addressId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new HttpError(500, "We couldn't load your saved address. Please try again.");
    if (!saved) throw new HttpError(404, "We couldn't find that saved address. Choose another or type one in.");
    const check = checkUsAddress({ state: saved.state, postalCode: saved.postal_code, country: saved.country });
    if (!check.ok) {
      throw new HttpError(400, `We can't ship back to that saved address. ${check.message} Choose another or type one in.`);
    }
    return {
      return_address_id: saved.id,
      return_recipient: cleanText(saved.recipient, 200) ?? fallbackName,
      return_line1: saved.line1.trim().slice(0, 200),
      return_line2: cleanText(saved.line2, 200),
      return_city: saved.city.trim().slice(0, 100),
      return_state: check.state,
      return_postal_code: check.postalCode,
      return_country: check.country,
    };
  }

  const a = body.returnAddress ?? {};
  const line1 = cleanText(a.line1, 200);
  const city = cleanText(a.city, 100);
  if (!line1 || !city) {
    throw new HttpError(400, "Please enter the full address to ship your sorted collection back to.");
  }
  const check = checkUsAddress({ state: a.state, postalCode: a.postalCode, country: SHIP_TO_COUNTRY });
  if (!check.ok) throw new HttpError(400, check.message);
  return {
    return_address_id: null,
    return_recipient: cleanText(a.recipient, 200) ?? fallbackName,
    return_line1: line1,
    return_line2: cleanText(a.line2, 200),
    return_city: city,
    return_state: check.state,
    return_postal_code: check.postalCode,
    return_country: check.country,
  };
}
