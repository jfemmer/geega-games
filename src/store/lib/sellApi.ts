import { supabase } from "../../supabase";
import type { SellCardLine, SellPhoto, SellPrinting } from "./sellTypes";

// Thin fetch wrappers around /api/sell/*. Deliberately independent of
// src/admin/repositories — this is a separate, public-facing surface with
// different trust assumptions (often-anonymous callers, tighter validation).

interface RawCardPrinting {
  scryfallId: string;
  cardName: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  rarity: string;
  imageUrl: string;
  availableFinishes: string[];
  treatments: string[];
  scryfallPriceCents: number | null;
  releasedAt: string | null;
}

function mapPrinting(raw: RawCardPrinting): SellPrinting {
  return {
    scryfallId: raw.scryfallId,
    cardName: raw.cardName,
    setName: raw.setName,
    setCode: raw.setCode,
    collectorNumber: raw.collectorNumber,
    rarity: raw.rarity,
    imageUrl: raw.imageUrl || null,
    availableFinishes: raw.availableFinishes ?? [],
    treatments: raw.treatments ?? [],
    scryfallPriceCents: raw.scryfallPriceCents ?? null,
    releasedAt: raw.releasedAt ?? null,
  };
}

export interface SellScryfallSearchResult {
  printings: SellPrinting[];
  totalCards: number | null;
  hasMore: boolean;
  page: number;
}

export async function searchSellPrintings(
  query: string,
  page = 1,
): Promise<SellScryfallSearchResult> {
  const params = new URLSearchParams({ q: query });
  if (page > 1) params.set("page", String(page));
  const res = await fetch(`/api/sell/scryfall-search?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (body && typeof body.message === "string" && body.message) ||
        "Card search failed. Please try again.",
    );
  }
  return {
    printings: ((body?.data ?? []) as RawCardPrinting[]).map(mapPrinting),
    totalCards: body?.totalCards ?? null,
    hasMore: Boolean(body?.hasMore),
    page: body?.page ?? page,
  };
}

interface SignedUpload {
  fileName: string;
  path?: string;
  token?: string;
  signedUrl?: string;
  error?: string;
}

/**
 * Uploads one photo: requests a signed upload URL, then PUTs the file bytes
 * directly to Storage (no bytes pass through our own API). Mutates nothing —
 * returns the storage path on success so the caller can update its own
 * SellPhoto state.
 */
export async function uploadSellPhoto(
  draftId: string,
  photo: SellPhoto,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const signRes = await fetch("/api/sell/photo-uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      draftId,
      files: [
        {
          fileName: photo.file.name,
          mimeType: photo.file.type || "application/octet-stream",
          sizeBytes: photo.file.size,
        },
      ],
    }),
  });
  const signBody = await signRes.json().catch(() => null);
  if (!signRes.ok) {
    throw new Error(
      (signBody && typeof signBody.message === "string" && signBody.message) ||
        "Could not start the photo upload.",
    );
  }
  const upload = (signBody?.uploads ?? [])[0] as SignedUpload | undefined;
  if (!upload || upload.error || !upload.signedUrl) {
    throw new Error(upload?.error || "Could not start the photo upload.");
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", upload.signedUrl!);
    xhr.setRequestHeader("Content-Type", photo.file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("The photo upload failed. Please try again."));
    };
    xhr.onerror = () => reject(new Error("The photo upload failed. Please check your connection."));
    xhr.send(photo.file);
  });

  return upload.path!;
}

export interface SubmitSellFormResult {
  ok: boolean;
  referenceNumber?: string;
  /** Guest submissions only: proof this browser made it, for linking to an account. */
  claim?: { id: string; token: string };
  message?: string;
}

export async function submitSellForm(payload: {
  draftId: string;
  hp_ref: string;
  contact: unknown;
  collection: unknown;
  cards: SellCardLine[];
  photos: {
    path: string;
    originalFilename: string;
    cardLocalId?: string | null;
    side?: "front" | "back" | null;
  }[];
  agreedToTerms: boolean;
  /** "quick_quote" from the one-screen photo form; omitted by the full /sell flow. */
  source?: "quick_quote";
}): Promise<SubmitSellFormResult> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const res = await fetch("/api/sell/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      draftId: payload.draftId,
      hp_ref: payload.hp_ref,
      contact: payload.contact,
      collection: payload.collection,
      cards: payload.cards.map((c) => ({
        scryfallId: c.scryfallId,
        cardName: c.cardName,
        setCode: c.setCode,
        setName: c.setName,
        collectorNumber: c.collectorNumber,
        condition: c.condition,
        finish: c.finish,
        quantity: c.quantity,
        imageUrl: c.imageUrl,
        scryfallPriceCents: c.scryfallPriceCents,
        sellerNotes: c.sellerNotes || undefined,
        matchStatus: c.matchStatus,
        rawInput: c.rawInput,
        clientCardId: c.localId,
      })),
      photos: payload.photos,
      agreedToTerms: payload.agreedToTerms,
      source: payload.source,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    return {
      ok: false,
      message: (body && typeof body.message === "string" && body.message) ||
        "We couldn't submit your collection. Please try again.",
    };
  }
  return {
    ok: true,
    referenceNumber: body.referenceNumber,
    claim:
      typeof body.submissionId === "string" && typeof body.claimToken === "string"
        ? { id: body.submissionId, token: body.claimToken }
        : undefined,
  };
}

export interface SellOfferLookup {
  id: string;
  reference_number: string;
  first_name: string | null;
  offer_value_cents: number;
  offer_sent_at: string;
  offer_response: "accepted" | "declined" | "countered" | null;
  counter_offer_cents: number | null;
  offer_responded_at: string | null;
  allow_counter: boolean;
  payout_method?: "paypal" | "store_credit" | null;
  store_credit_bonus_percent?: number | null;
}

/**
 * Looks up a sent offer by reference number + email — see
 * sell_submission_offer_lookup(), a SECURITY DEFINER RPC requiring an exact
 * match on both together (same anti-enumeration pattern as
 * guest_order_lookup). Returns null for no match, an unsent offer, or a
 * wrong ref/email — all indistinguishable, by design.
 */
export async function lookupSellOffer(
  referenceNumber: string,
  email: string,
): Promise<SellOfferLookup | null> {
  const { data, error } = await supabase.rpc("sell_submission_offer_lookup", {
    p_reference_number: referenceNumber.trim(),
    p_email: email.trim(),
  });
  if (error) throw new Error(error.message);
  return (data as SellOfferLookup | null) ?? null;
}

export interface RespondToSellOfferResult {
  ok: boolean;
  response?: "accepted" | "declined" | "countered";
  message?: string;
}

/** Submits the seller's response — see /api/sell/respond-to-offer.ts, which independently re-verifies everything here rather than trusting this call. */
export async function respondToSellOffer(payload: {
  referenceNumber: string;
  email: string;
  response: "accepted" | "declined" | "countered";
  counterOfferCents?: number;
  payoutMethod?: "paypal" | "store_credit";
}): Promise<RespondToSellOfferResult> {
  // Store credit is held on an account, so the server needs to know who's
  // signed in (it links the submission to them).
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  const res = await fetch("/api/sell/respond-to-offer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    return {
      ok: false,
      message: (body && typeof body.message === "string" && body.message) ||
        "We couldn't submit your response. Please try again.",
    };
  }
  return { ok: true, response: body.response };
}
