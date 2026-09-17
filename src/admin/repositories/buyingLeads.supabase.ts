import { supabase } from "../../supabase";
import { adminFetch } from "./apiClient";
import type {
  BuyingLeadCard,
  BuyingLeadDetail,
  BuyingLeadPhoto,
  BuyingLeadPriority,
  BuyingLeadStatus,
  BuyingLeadSummary,
  BuyingLeadsQuery,
} from "../types";
import type { Database } from "../../types/database";

// LIVE BuyingLeadsRepository — real Sell Your Cards / Sell Your Collection
// submissions. Reads use the browser client directly (staff-scoped RLS on
// sell_submissions / sell_submission_cards / sell_submission_photos — see
// the sell_submissions migration); there is no mock counterpart because this
// is a brand-new feature with nothing to fall back to. Writes go through
// /api/admin/sell-submissions/:id (service_role — there is no UPDATE grant
// to `authenticated` at all on these tables).
//
// Photos: the bucket is private with a staff-only storage.objects SELECT
// policy, so signed URLs can be minted directly from the admin's own
// authenticated browser session (same pattern as scan.supabase.ts's
// card-scans images) — no dedicated API endpoint needed just to view one.

const SELL_PHOTOS_BUCKET = "sell-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 30;
const LARGE_COLLECTION_SIZES = new Set(["5000_to_10000", "10000_plus"]);

type SubmissionRow = Database["public"]["Tables"]["sell_submissions"]["Row"];
type CardRow = Database["public"]["Tables"]["sell_submission_cards"]["Row"];
type PhotoRow = Database["public"]["Tables"]["sell_submission_photos"]["Row"];

function mapSummary(row: SubmissionRow): BuyingLeadSummary {
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    city: row.city,
    state: row.state,
    zip: row.zip,
    createdAt: row.created_at,
    totalCards: row.total_cards,
    photoCount: row.photo_count,
    collectionSize: row.collection_size,
    preferredContactMethod: row.preferred_contact_method,
    transactionPreference: row.transaction_preference,
    status: row.status as BuyingLeadStatus,
    priority: row.priority as BuyingLeadPriority,
    favorited: row.favorited,
    estimatedValueCents: row.estimated_value_cents,
  };
}

function mapCard(row: CardRow): BuyingLeadCard {
  return {
    id: row.id,
    scryfallId: row.scryfall_id,
    cardName: row.card_name,
    setName: row.set_name,
    setCode: row.set_code,
    collectorNumber: row.collector_number,
    imageUrl: row.image_url,
    condition: row.condition,
    finish: row.finish,
    quantity: row.quantity,
    scryfallPriceCents: row.scryfall_price_cents,
    sellerNotes: row.seller_notes,
    matchStatus: row.match_status,
    clientCardId: row.client_card_id,
  };
}

async function signPhotoUrls(rows: PhotoRow[]): Promise<Map<string, string>> {
  const paths = rows.map((r) => r.storage_path);
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  const { data, error } = await supabase.storage
    .from(SELL_PHOTOS_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return map;
  for (const entry of data) {
    if (entry.signedUrl && !entry.error) map.set(entry.path ?? "", entry.signedUrl);
  }
  return map;
}

export const buyingLeadsRepository = {
  async list(query: BuyingLeadsQuery): Promise<BuyingLeadSummary[]> {
    let q = supabase
      .from("sell_submissions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (query.status && query.status !== "all") {
      q = q.eq("status", query.status);
    }
    if (query.hasPhotos) {
      q = q.gt("photo_count", 0);
    }
    if (query.hasCardList) {
      q = q.gt("total_cards", 0);
    }
    if (query.largeCollection) {
      q = q.in("collection_size", Array.from(LARGE_COLLECTION_SIZES));
    }
    const term = query.search?.trim();
    if (term) {
      const like = `%${term.replace(/[%_]/g, "")}%`;
      q = q.or(
        [
          `first_name.ilike.${like}`,
          `last_name.ilike.${like}`,
          `email.ilike.${like}`,
          `phone.ilike.${like}`,
          `reference_number.ilike.${like}`,
          `city.ilike.${like}`,
          `zip.ilike.${like}`,
        ].join(","),
      );
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ((data ?? []) as SubmissionRow[]).map(mapSummary);
  },

  async get(id: string): Promise<BuyingLeadDetail | null> {
    const { data: row, error } = await supabase
      .from("sell_submissions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;

    const [{ data: cardRows }, { data: photoRows }] = await Promise.all([
      supabase
        .from("sell_submission_cards")
        .select("*")
        .eq("submission_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("sell_submission_photos")
        .select("*")
        .eq("submission_id", id)
        .order("created_at", { ascending: true }),
    ]);

    const photos = (photoRows ?? []) as PhotoRow[];
    const urlByPath = await signPhotoUrls(photos);

    return {
      ...mapSummary(row as SubmissionRow),
      userId: row.user_id,
      collectionTypes: row.collection_types ?? [],
      collectionEras: row.collection_eras ?? [],
      timeline: row.timeline,
      valuableCardsNotes: row.valuable_cards_notes,
      notes: row.notes,
      internalNotes: row.internal_notes,
      referralSource: row.referral_source,
      offerValueCents: row.offer_value_cents,
      purchaseAmountCents: row.purchase_amount_cents,
      contactedAt: row.contacted_at,
      closedAt: row.closed_at,
      cards: ((cardRows ?? []) as CardRow[]).map(mapCard),
      photos: photos.map((p) => ({
        id: p.id,
        originalFilename: p.original_filename,
        mimeType: p.mime_type,
        sizeBytes: p.size_bytes,
        signedUrl: urlByPath.get(p.storage_path) ?? null,
        clientCardId: p.client_card_id,
      })) as BuyingLeadPhoto[],
    };
  },

  async setStatus(id: string, status: BuyingLeadStatus): Promise<void> {
    await adminFetch(`/api/admin/sell-submissions/${id}`, { method: "PATCH", body: { status } });
  },
  async setInternalNotes(id: string, internalNotes: string): Promise<void> {
    await adminFetch(`/api/admin/sell-submissions/${id}`, { method: "PATCH", body: { internalNotes } });
  },
  async setPriority(id: string, priority: BuyingLeadPriority): Promise<void> {
    await adminFetch(`/api/admin/sell-submissions/${id}`, { method: "PATCH", body: { priority } });
  },
  async setFavorited(id: string, favorited: boolean): Promise<void> {
    await adminFetch(`/api/admin/sell-submissions/${id}`, { method: "PATCH", body: { favorited } });
  },
  async setOfferValueCents(id: string, offerValueCents: number | null): Promise<void> {
    await adminFetch(`/api/admin/sell-submissions/${id}`, { method: "PATCH", body: { offerValueCents } });
  },
  async setPurchaseAmountCents(id: string, purchaseAmountCents: number | null): Promise<void> {
    await adminFetch(`/api/admin/sell-submissions/${id}`, {
      method: "PATCH",
      body: { purchaseAmountCents },
    });
  },

  /** Counts per status, for the filter tab badges. */
  async counts(): Promise<Record<string, number>> {
    const { data, error } = await supabase.from("sell_submissions").select("status");
    if (error) throw new Error(error.message);
    const out: Record<string, number> = { all: 0 };
    for (const row of (data ?? []) as { status: string }[]) {
      out.all += 1;
      out[row.status] = (out[row.status] ?? 0) + 1;
    }
    return out;
  },
};
