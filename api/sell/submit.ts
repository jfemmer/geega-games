import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { normalizeEmail } from "../_lib/tokens.js";
import { checkRateLimit, getClientIp } from "../_lib/rateLimit.js";
import {
  isValidDraftId,
  listDraftPhotos,
  MAX_CARDS_PER_SUBMISSION,
  MAX_PHOTOS_PER_SUBMISSION,
} from "../_lib/sell.js";
import {
  sendSellSubmissionAdminNotification,
  sendSellSubmissionConfirmation,
} from "../_lib/sellSubmissionEmails.js";
import type { Database } from "../../src/types/database.js";

// POST /api/sell/submit
//
// PUBLIC, guest-submittable. Creates a sell_submissions row + its cards +
// photos in one server-side operation using the service_role key (there is
// no anon INSERT policy on these tables at all — see the sell_submissions
// migration — every write goes through here, never a direct client insert).
//
// Trust boundaries:
//   - contact info, collection details, and card identity are the seller's
//     own claims (this is a LEAD form, not a financial transaction — nothing
//     is charged or paid out automatically, so the stakes of trusting a
//     seller's own description of their own cards are low; staff review
//     everything before any money moves).
//   - photo METADATA (mime type, size) always comes from what Storage
//     actually recorded for the upload, never from the client — a client
//     cannot fabricate a photo row for a file it never uploaded.
//   - user_id is only ever set from a server-verified access token, never
//     trusted from the request body directly.
//   - total_cards / estimated_value_cents are computed here from the
//     (validated, bounded) card list, never accepted as client-supplied
//     totals.

const MAX_BODY_BYTES = 400 * 1024;
const RATE_LIMIT_PER_WINDOW = 5;
const RATE_WINDOW_MS = 10 * 60_000;
const MAX_SUBMISSIONS_PER_EMAIL_PER_HOUR = 3;

const PREFERRED_CONTACT_METHODS = new Set(["email", "phone", "text"]);
const TRANSACTION_PREFERENCES = new Set(["local", "ship", "either", "not_sure"]);
const COLLECTION_SIZES = new Set([
  "under_100",
  "100_to_500",
  "500_to_1000",
  "1000_to_5000",
  "5000_to_10000",
  "10000_plus",
  "not_sure",
]);
const TIMELINES = new Set(["asap", "within_week", "within_month", "no_rush"]);
const CONDITIONS = new Set(["NM", "LP", "MP", "HP", "DMG"]);
const FINISHES = new Set([
  "nonfoil",
  "foil",
  "etched",
  "glossy",
  "ripple",
  "surge",
  "rainbow",
  "galaxy",
  "textured",
  "mana",
  "gilded",
  "halo",
]);
const MATCH_STATUSES = new Set(["matched", "ambiguous", "unmatched"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLen);
}

function cleanStringArray(v: unknown, maxItems: number, maxItemLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const cleaned = cleanString(item, maxItemLen);
    if (cleaned) out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return out;
}

interface ContactInput {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  preferredContactMethod?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
  transactionPreference?: unknown;
}

interface CollectionInput {
  collectionSize?: unknown;
  collectionTypes?: unknown;
  collectionEras?: unknown;
  timeline?: unknown;
  valuableCardsNotes?: unknown;
  notes?: unknown;
  referralSource?: unknown;
}

interface CardInput {
  scryfallId?: unknown;
  cardName?: unknown;
  setCode?: unknown;
  setName?: unknown;
  collectorNumber?: unknown;
  condition?: unknown;
  finish?: unknown;
  quantity?: unknown;
  imageUrl?: unknown;
  scryfallPriceCents?: unknown;
  sellerNotes?: unknown;
  matchStatus?: unknown;
  rawInput?: unknown;
  /** SellCardLine.localId — a client-only correlation key, never a DB id. */
  clientCardId?: unknown;
}

interface PhotoInput {
  path?: unknown;
  originalFilename?: unknown;
  /** Set when this photo was attached to a specific card (see CardInput.clientCardId), rather than the general collection uploader. */
  cardLocalId?: unknown;
}

interface SubmitBody {
  hp_ref?: unknown;
  website?: unknown;
  draftId?: unknown;
  accessToken?: unknown;
  contact?: ContactInput;
  collection?: CollectionInput;
  cards?: CardInput[];
  photos?: PhotoInput[];
  agreedToTerms?: unknown;
}

type SellSubmissionInsert = Database["public"]["Tables"]["sell_submissions"]["Insert"];
type SellSubmissionCardInsert =
  Database["public"]["Tables"]["sell_submission_cards"]["Insert"];
type SellSubmissionPhotoInsert =
  Database["public"]["Tables"]["sell_submission_photos"]["Insert"];

function normalizeCard(input: CardInput): SellSubmissionCardInsert | null {
  const rawInput = cleanString(input.rawInput, 500);
  let cardName = cleanString(input.cardName, 200);
  if (!cardName) {
    cardName = rawInput ? rawInput.slice(0, 200) : null;
  }
  if (!cardName) return null; // nothing usable on this line — drop it

  const scryfallIdRaw = typeof input.scryfallId === "string" ? input.scryfallId.trim() : "";
  const scryfallId = UUID_RE.test(scryfallIdRaw) ? scryfallIdRaw : null;

  const conditionRaw = typeof input.condition === "string" ? input.condition.toUpperCase() : "";
  const condition = CONDITIONS.has(conditionRaw)
    ? (conditionRaw as Database["public"]["Enums"]["card_condition"])
    : null;

  const finishRaw = typeof input.finish === "string" ? input.finish.toLowerCase() : "";
  const finish = (
    FINISHES.has(finishRaw) ? finishRaw : "nonfoil"
  ) as Database["public"]["Enums"]["card_finish"];

  const matchStatusRaw = typeof input.matchStatus === "string" ? input.matchStatus : "";
  const matchStatus = (
    MATCH_STATUSES.has(matchStatusRaw) ? matchStatusRaw : "matched"
  ) as Database["public"]["Enums"]["sell_card_match_status"];

  const qtyRaw = Number(input.quantity);
  const quantity =
    Number.isFinite(qtyRaw) && qtyRaw >= 1 ? Math.min(Math.floor(qtyRaw), 100_000) : 1;

  const priceRaw = Number(input.scryfallPriceCents);
  const scryfallPriceCents =
    Number.isFinite(priceRaw) && priceRaw >= 0 && priceRaw <= 10_000_000
      ? Math.round(priceRaw)
      : null;

  return {
    submission_id: "", // filled in by the caller once the submission id is known
    scryfall_id: scryfallId,
    card_name: cardName,
    set_code: cleanString(input.setCode, 20),
    set_name: cleanString(input.setName, 120),
    collector_number: cleanString(input.collectorNumber, 20),
    condition,
    finish,
    quantity,
    image_url: cleanString(input.imageUrl, 500),
    scryfall_price_cents: scryfallPriceCents,
    seller_notes: cleanString(input.sellerNotes, 500),
    match_status: matchStatus,
    raw_input: rawInput,
    client_card_id: cleanString(input.clientCardId, 100),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit("sell-submit", ip, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many submissions. Please wait a bit and try again.");
    }

    const body = (await readJsonBody(req, MAX_BODY_BYTES)) as SubmitBody;

    // Honeypot: a real seller never fills this hidden field. Return a
    // normal-looking success without writing anything, same pattern as
    // /api/subscribe.
    const honeypot = cleanString(body.hp_ref ?? body.website, 200);
    if (honeypot) {
      return sendJson(res, 200, { ok: true, referenceNumber: "GG-S-000000" });
    }

    if (body.agreedToTerms !== true) {
      throw new HttpError(
        400,
        "Please confirm you own or are authorized to sell these items before submitting.",
      );
    }

    const contact = body.contact ?? {};
    const firstName = cleanString(contact.firstName, 100);
    const lastName = cleanString(contact.lastName, 100);
    const email = normalizeEmail(contact.email);
    if (!firstName || !lastName || !email) {
      throw new HttpError(400, "Please provide your first name, last name, and a valid email.");
    }
    const phone = cleanString(contact.phone, 30);
    const preferredContactMethodRaw =
      typeof contact.preferredContactMethod === "string" ? contact.preferredContactMethod : "";
    const preferredContactMethod = (
      PREFERRED_CONTACT_METHODS.has(preferredContactMethodRaw)
        ? preferredContactMethodRaw
        : "email"
    ) as Database["public"]["Enums"]["sell_preferred_contact_method"];
    const city = cleanString(contact.city, 100);
    const state = cleanString(contact.state, 50);
    const zip = cleanString(contact.zip, 20);
    const transactionPreferenceRaw =
      typeof contact.transactionPreference === "string" ? contact.transactionPreference : "";
    const transactionPreference = (
      TRANSACTION_PREFERENCES.has(transactionPreferenceRaw)
        ? transactionPreferenceRaw
        : "not_sure"
    ) as Database["public"]["Enums"]["sell_transaction_preference"];

    const collection = body.collection ?? {};
    const collectionSizeRaw =
      typeof collection.collectionSize === "string" ? collection.collectionSize : "";
    const collectionSize = COLLECTION_SIZES.has(collectionSizeRaw)
      ? (collectionSizeRaw as Database["public"]["Enums"]["sell_collection_size"])
      : null;
    const collectionTypes = cleanStringArray(collection.collectionTypes, 20, 60);
    const collectionEras = cleanStringArray(collection.collectionEras, 10, 40);
    const timelineRaw = typeof collection.timeline === "string" ? collection.timeline : "";
    const timeline = TIMELINES.has(timelineRaw)
      ? (timelineRaw as Database["public"]["Enums"]["sell_timeline"])
      : null;
    const valuableCardsNotes = cleanString(collection.valuableCardsNotes, 2000);
    const notes = cleanString(collection.notes, 4000);
    const referralSource = cleanString(collection.referralSource, 100);

    const rawCards = Array.isArray(body.cards) ? body.cards.slice(0, MAX_CARDS_PER_SUBMISSION) : [];
    const cards = rawCards.map(normalizeCard).filter((c): c is SellSubmissionCardInsert => c !== null);

    // Photos: verify against what Storage actually has, never trust the
    // client's claimed list on its own.
    const admin = getSupabaseAdmin();
    let photoRows: SellSubmissionPhotoInsert[] = [];
    const draftIdRaw = typeof body.draftId === "string" ? body.draftId : "";
    if (isValidDraftId(draftIdRaw)) {
      const confirmed = await listDraftPhotos(admin, draftIdRaw);
      const confirmedByName = new Map(confirmed.map((f) => [f.name, f]));
      const claimed = Array.isArray(body.photos) ? body.photos.slice(0, MAX_PHOTOS_PER_SUBMISSION) : [];
      for (const p of claimed) {
        const path = typeof p.path === "string" ? p.path : "";
        if (!path.startsWith(`${draftIdRaw}/`)) continue;
        const objectName = path.slice(draftIdRaw.length + 1);
        const confirmedObj = confirmedByName.get(objectName);
        if (!confirmedObj) continue; // never fabricate a row for an unverified path
        photoRows.push({
          submission_id: "",
          storage_path: path,
          original_filename: cleanString(p.originalFilename, 200) ?? objectName,
          mime_type: confirmedObj.metadata?.mimetype ?? "application/octet-stream",
          size_bytes: confirmedObj.metadata?.size ?? 0,
          client_card_id: cleanString(p.cardLocalId, 100),
        });
      }
      photoRows = photoRows.slice(0, MAX_PHOTOS_PER_SUBMISSION);
    }

    if (cards.length === 0 && photoRows.length === 0 && !notes && !valuableCardsNotes) {
      throw new HttpError(
        400,
        "Tell us what you're selling — add at least one card, a few photos, or a short description.",
      );
    }

    // Best-effort DB-backed duplicate/spam guard (per-IP in-memory limiting
    // above is a first line of defense; this survives cold starts).
    const { count: recentFromEmail } = await admin
      .from("sell_submissions")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString());
    if ((recentFromEmail ?? 0) >= MAX_SUBMISSIONS_PER_EMAIL_PER_HOUR) {
      throw new HttpError(
        429,
        "We've already received a submission from this email recently. If you need help, please contact us directly.",
      );
    }

    // Resolve an optional signed-in user from a server-verified token. Never
    // trust a client-supplied user id directly.
    let userId: string | null = null;
    const authHeader = String(req.headers["authorization"] ?? "");
    const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const accessToken = bearerToken || (typeof body.accessToken === "string" ? body.accessToken : "");
    if (accessToken) {
      const { data: userData } = await admin.auth.getUser(accessToken);
      if (userData?.user) userId = userData.user.id;
    }

    const totalCards = cards.reduce((sum, c) => sum + (c.quantity ?? 1), 0);
    const matchedValueCents = cards
      .filter((c) => c.match_status === "matched" && c.scryfall_price_cents != null)
      .reduce((sum, c) => sum + (c.scryfall_price_cents as number) * (c.quantity ?? 1), 0);
    const hasPriceData = cards.some(
      (c) => c.match_status === "matched" && c.scryfall_price_cents != null,
    );

    const insertPayload: Omit<SellSubmissionInsert, "reference_number"> = {
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      preferred_contact_method: preferredContactMethod,
      city,
      state,
      zip,
      transaction_preference: transactionPreference,
      collection_size: collectionSize,
      collection_types: collectionTypes,
      collection_eras: collectionEras,
      timeline,
      valuable_cards_notes: valuableCardsNotes,
      notes,
      referral_source: referralSource,
      total_cards: totalCards,
      photo_count: photoRows.length,
      estimated_value_cents: hasPriceData ? matchedValueCents : null,
    };

    const { data: submission, error: insertError } = await admin
      .from("sell_submissions")
      .insert(insertPayload as SellSubmissionInsert)
      .select("id, reference_number")
      .single();

    if (insertError || !submission) {
      console.error("[/api/sell/submit] insert failed:", insertError);
      throw new HttpError(500, "We couldn't save your submission. Please try again.");
    }

    if (cards.length > 0) {
      const { error: cardsError } = await admin
        .from("sell_submission_cards")
        .insert(cards.map((c) => ({ ...c, submission_id: submission.id })));
      if (cardsError) {
        console.error("[/api/sell/submit] card insert failed:", cardsError, "submission:", submission.id);
        // The submission itself is already saved — do not fail the whole
        // request over the card list. Staff can still see the submission
        // and follow up; nothing the seller entered before this point is
        // silently lost from their perspective (the confirmation still
        // reflects what was actually saved).
      }
    }
    if (photoRows.length > 0) {
      const { error: photosError } = await admin
        .from("sell_submission_photos")
        .insert(photoRows.map((p) => ({ ...p, submission_id: submission.id })));
      if (photosError) {
        console.error("[/api/sell/submit] photo insert failed:", photosError, "submission:", submission.id);
      }
    }

    // Emails are best-effort: a failure here must never undo or fail an
    // otherwise-successful submission. sendTrackedEmail is idempotent
    // (unique idempotency_key), so a retried call from a client-side retry
    // can never double-send either message.
    try {
      await sendSellSubmissionConfirmation(submission.id);
    } catch (err) {
      console.error("[/api/sell/submit] confirmation email failed:", err, "submission:", submission.id);
    }
    try {
      await sendSellSubmissionAdminNotification(submission.id);
    } catch (err) {
      console.error("[/api/sell/submit] admin notification email failed:", err, "submission:", submission.id);
    }

    return sendJson(res, 200, { ok: true, referenceNumber: submission.reference_number });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/sell/submit] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}
