import * as React from "react";
import crypto from "node:crypto";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { notifyStaff } from "./staffPush.js";
import { sendTrackedEmail, type SendEmailResult } from "./emailService.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";
import {
  PhotoRequestConfirmation,
  PhotoRequestPhotos,
  photoRequestConfirmationSubject,
  photoRequestConfirmationText,
  photoRequestPhotosSubject,
  photoRequestPhotosText,
  type PhotoRequestCardData,
} from "./emails/PhotoRequestEmails.js";
import { PHOTO_REQUEST_REPLY_HOURS } from "../../src/store/lib/photoRequestTypes.js";

// Photo requests: staff push on arrival, a receipt for the shopper, and the
// email that delivers staff's photos. Like the other *Emails modules, every
// function takes only an id and loads the rest server-side, and each email
// has an idempotency key, so a retried request never sends twice.

export const PHOTO_REQUEST_BUCKET = "photo-request-photos";

type Result = SendEmailResult | { status: "skipped"; reason: string };

const CONDITION_NAMES: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

const FINISH_NAMES: Record<string, string> = { foil: "Foil", etched: "Etched foil", glossy: "Glossy" };

interface RequestRow {
  id: string;
  reference_number: string;
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
}

async function loadRequest(id: string): Promise<RequestRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("photo_requests")
    .select(
      "id, reference_number, card_name, set_code, set_name, collector_number, condition, finish, card_path, first_name, email, note",
    )
    .eq("id", id)
    .single();
  return error ? null : data;
}

/** "Sol Ring — Commander Masters #395 · Near Mint · Foil" */
export function photoRequestCardLabel(r: Pick<RequestRow, "card_name" | "set_name" | "set_code" | "collector_number" | "condition" | "finish">): string {
  const set = r.set_name ?? r.set_code?.toUpperCase() ?? null;
  const printing = [set, r.collector_number ? `#${r.collector_number}` : null].filter(Boolean).join(" ");
  const details = [
    printing || null,
    r.condition ? (CONDITION_NAMES[r.condition] ?? r.condition) : null,
    r.finish && r.finish !== "nonfoil" ? (FINISH_NAMES[r.finish] ?? r.finish) : null,
  ].filter(Boolean);
  return details.length ? `${r.card_name} — ${details.join(" · ")}` : r.card_name;
}

function cardData(r: RequestRow): PhotoRequestCardData {
  const site = siteUrl();
  return {
    firstName: r.first_name,
    referenceNumber: r.reference_number,
    cardLabel: photoRequestCardLabel(r),
    cardUrl: r.card_path ? `${site}${r.card_path}` : null,
    siteUrl: site,
    logoUrl: logoUrl(),
    supportEmail: ServerEnv.replyTo(),
  };
}

/** Push to staff devices. Never throws (notifyStaff is best-effort). */
export async function notifyStaffOfPhotoRequest(id: string): Promise<void> {
  const r = await loadRequest(id);
  if (!r) return;
  await notifyStaff({
    key: `photo_request:${r.id}`,
    kind: "photo_request",
    title: `Photo request · ${r.card_name}`,
    body: [photoRequestCardLabel(r).split(" — ")[1] ?? null, r.first_name, r.note ? `"${r.note}"` : null]
      .filter(Boolean)
      .join(" · "),
    url: `/admin_dashboard/inventory?tab=photo-requests&request=${r.id}`,
    tag: `photo_request:${r.id}`,
  });
}

export async function sendPhotoRequestConfirmation(id: string): Promise<Result> {
  const r = await loadRequest(id);
  if (!r) return { status: "skipped", reason: "request-not-found" };
  const data = { ...cardData(r), replyHours: PHOTO_REQUEST_REPLY_HOURS };
  return sendTrackedEmail({
    emailType: "photo_request_confirmation",
    idempotencyKey: `photo-request-confirmation-${r.id}`,
    to: r.email,
    from: ServerEnv.fromOrders(),
    replyTo: ServerEnv.replyTo(),
    subject: photoRequestConfirmationSubject(data),
    react: React.createElement(PhotoRequestConfirmation, data),
    text: photoRequestConfirmationText(data),
  });
}

const EXT_BY_TYPE: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Email staff's photos to the shopper as attachments. `paths` must already
 * be verified to exist under this request's folder in PHOTO_REQUEST_BUCKET.
 * The idempotency key covers the exact set of photos, so a double-click
 * sends once, while a later "send more photos" goes out as a new email.
 */
export async function sendPhotoRequestPhotos(
  id: string,
  paths: string[],
  staffMessage: string | null,
): Promise<Result> {
  const r = await loadRequest(id);
  if (!r) return { status: "skipped", reason: "request-not-found" };
  if (paths.length === 0) return { status: "skipped", reason: "no-photos" };

  const storage = getSupabaseAdmin().storage.from(PHOTO_REQUEST_BUCKET);
  const files = await Promise.all(
    paths.map(async (path) => {
      const { data, error } = await storage.download(path);
      if (error || !data) throw new Error(`Could not read ${path}: ${error?.message ?? "missing"}`);
      return { path, blob: data };
    }),
  );

  const slug = r.card_name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "card";
  const attachments = await Promise.all(
    files.map(async ({ blob }, i) => {
      const type = blob.type || "image/jpeg";
      return {
        filename: `${slug}-${i + 1}.${EXT_BY_TYPE[type] ?? "jpg"}`,
        content: Buffer.from(await blob.arrayBuffer()),
        contentType: type,
      };
    }),
  );

  const data = { ...cardData(r), photoCount: attachments.length, staffMessage };
  const photosHash = crypto.createHash("sha256").update([...paths].sort().join("|")).digest("hex").slice(0, 16);
  return sendTrackedEmail({
    emailType: "photo_request_photos",
    idempotencyKey: `photo-request-photos-${r.id}-${photosHash}`,
    to: r.email,
    from: ServerEnv.fromOrders(),
    replyTo: ServerEnv.replyTo(),
    subject: photoRequestPhotosSubject(data),
    react: React.createElement(PhotoRequestPhotos, data),
    text: photoRequestPhotosText(data),
    attachments,
  });
}
