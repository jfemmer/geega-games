import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";
import { HttpError } from "./http.js";

// Shared server-side helpers for the Sell Your Cards / Sell Your Collection
// system (/api/sell/*). Kept separate from admin's api/_lib/scan.ts (a
// similar-shaped domain) since these run for PUBLIC, often-anonymous callers
// and have different trust assumptions.

type Admin = SupabaseClient<Database>;

export const SELL_PHOTOS_BUCKET = "sell-photos";

// Soft UI guidance is "~20-30 photos" — this is the hard server ceiling
// (a little above that) so a legitimate large-collection seller never has
// photos silently dropped, while still bounding abuse.
export const MAX_PHOTOS_PER_SUBMISSION = 40;
// Individually-entered cards are for sellers with an organized/short list —
// a huge collection is meant to go through photos instead (the whole point
// of this feature per the product brief), so this cap is generous but not
// unlimited.
export const MAX_CARDS_PER_SUBMISSION = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A client-generated draft id namespaces photo uploads before the real
 * submission row exists yet. It is never treated as a secret or as proof of
 * ownership — it is purely a Storage folder prefix. */
export function isValidDraftId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

export function buildSellPhotoPath(draftId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const unique = crypto.randomUUID();
  return `${draftId}/${unique}-${safeName}`;
}

/**
 * List what was ACTUALLY uploaded to Storage under a draft's prefix. This is
 * the source of truth when creating sell_submission_photos rows — a client
 * cannot fabricate a photo row by simply POSTing metadata for a file it never
 * uploaded, since the row is only ever created for objects this listing
 * confirms exist.
 */
export async function listDraftPhotos(
  admin: Admin,
  draftId: string,
): Promise<{ name: string; metadata: { size?: number; mimetype?: string } | null }[]> {
  const { data, error } = await admin.storage
    .from(SELL_PHOTOS_BUCKET)
    .list(draftId, { limit: MAX_PHOTOS_PER_SUBMISSION + 10 });
  if (error) throw new HttpError(500, "Could not verify uploaded photos.");
  return (data ?? []).filter((f) => f.name && f.id);
}

const ALLOWED_PHOTO_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export function isAllowedPhotoMimeType(mime: string): boolean {
  return ALLOWED_PHOTO_MIME_TYPES.has(mime.toLowerCase());
}
