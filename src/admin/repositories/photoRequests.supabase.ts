import { supabase } from "../../supabase";
import { adminFetch } from "./apiClient";
import type { PhotoRequest } from "../types";
import {
  PHOTO_REQUEST_MAX_PHOTOS,
  PHOTO_REQUEST_MAX_PHOTO_BYTES,
} from "../../store/lib/photoRequestTypes";

// LIVE repository for Inventory → Photo requests (public.photo_requests).
// Same split as referralLeads.supabase.ts:
//   * reads use the browser client directly (staff-only SELECT policy);
//   * every write goes through /api/admin/photo-requests/:id (service_role —
//     `authenticated` has no write grant on the table);
//   * photos go straight from the browser to the private
//     photo-request-photos bucket through signed upload URLs.

const BUCKET = "photo-request-photos";
const VIEW_LINK_TTL_SECONDS = 60 * 30;

/** Longest side of a photo after downsizing — plenty for a condition check, small enough to email. */
const MAX_PHOTO_EDGE = 2000;
const JPEG_QUALITY = 0.86;

interface Row {
  id: string;
  reference_number: string;
  created_at: string;
  updated_at: string;
  inventory_item_id: string | null;
  card_name: string;
  set_code: string | null;
  set_name: string | null;
  collector_number: string | null;
  condition: string | null;
  finish: string | null;
  card_path: string | null;
  first_name: string;
  email: string;
  note: string | null;
  status: string;
  photo_paths: string[];
  staff_message: string | null;
  sent_at: string | null;
  send_count: number;
  closed_at: string | null;
  inventory_items: {
    image_url: string | null;
    storage_location: string | null;
    quantity: number;
    status: string;
  } | null;
}

function mapRow(row: Row): PhotoRequest {
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    inventoryItemId: row.inventory_item_id,
    cardName: row.card_name,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    condition: row.condition,
    finish: row.finish,
    cardPath: row.card_path,
    firstName: row.first_name,
    email: row.email,
    note: row.note,
    status: (row.status as PhotoRequest["status"]) ?? "new",
    photoPaths: row.photo_paths ?? [],
    staffMessage: row.staff_message,
    sentAt: row.sent_at,
    sendCount: row.send_count,
    closedAt: row.closed_at,
    listing: row.inventory_items
      ? {
          imageUrl: row.inventory_items.image_url,
          storageLocation: row.inventory_items.storage_location,
          quantity: row.inventory_items.quantity,
          status: row.inventory_items.status,
        }
      : null,
  };
}

/** Downsize a phone photo to a JPEG that emails well. Falls back to the original file. */
async function preparePhoto(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    return blob ?? file;
  } catch {
    return file;
  }
}

export type PhotoRequestFilter = "open" | "sent" | "closed" | "all";

export const photoRequestsRepository = {
  async list(filter: PhotoRequestFilter): Promise<PhotoRequest[]> {
    let q = supabase
      .from("photo_requests")
      .select("*, inventory_items(image_url, storage_location, quantity, status)")
      .limit(300);
    if (filter === "open") q = q.eq("status", "new").order("created_at", { ascending: true });
    else {
      if (filter !== "all") q = q.eq("status", filter);
      q = q.order("created_at", { ascending: false });
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as Row[]).map(mapRow);
  },

  /** Requests still waiting on a photo — drives the tab badge. */
  async openCount(): Promise<number> {
    const { count, error } = await supabase
      .from("photo_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "new");
    if (error) throw new Error(error.message);
    return count ?? 0;
  },

  async photoUrls(paths: string[]): Promise<string[]> {
    if (paths.length === 0) return [];
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, VIEW_LINK_TTL_SECONDS);
    if (error || !data) return [];
    return data.map((e) => (e.error ? null : e.signedUrl)).filter((u): u is string => Boolean(u));
  },

  /** Downsize + upload photos for a request; returns their storage paths. */
  async uploadPhotos(id: string, files: File[], onProgress?: (done: number) => void): Promise<string[]> {
    if (files.length > PHOTO_REQUEST_MAX_PHOTOS) {
      throw new Error(`You can send up to ${PHOTO_REQUEST_MAX_PHOTOS} photos at a time.`);
    }
    const blobs = await Promise.all(files.map(preparePhoto));
    for (const blob of blobs) {
      if (blob.size > PHOTO_REQUEST_MAX_PHOTO_BYTES) throw new Error("A photo is over 10 MB. Try a smaller one.");
    }
    const { uploads } = await adminFetch<{ uploads: { path: string; signedUrl: string }[] }>(
      `/api/admin/photo-requests/${id}`,
      {
        method: "POST",
        body: {
          action: "upload_urls",
          files: blobs.map((b) => ({ mimeType: b.type || "image/jpeg", sizeBytes: b.size })),
        },
      },
    );
    let done = 0;
    await Promise.all(
      uploads.map(async (u, i) => {
        const res = await fetch(u.signedUrl, {
          method: "PUT",
          headers: { "Content-Type": blobs[i].type || "image/jpeg" },
          body: blobs[i],
        });
        if (!res.ok) throw new Error("A photo didn't upload. Check your connection and try again.");
        done += 1;
        onProgress?.(done);
      }),
    );
    return uploads.map((u) => u.path);
  },

  async send(id: string, paths: string[], message: string): Promise<{ deduped: boolean }> {
    return adminFetch<{ ok: true; deduped: boolean }>(`/api/admin/photo-requests/${id}`, {
      method: "POST",
      body: { action: "send", paths, message },
    });
  },

  async setStatus(id: string, status: "closed" | "new"): Promise<void> {
    await adminFetch(`/api/admin/photo-requests/${id}`, { method: "PATCH", body: { status } });
  },
};
