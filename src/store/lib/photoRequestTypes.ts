// Shared by the storefront (card page "Request a photo" form), the API
// (/api/photo-requests, /api/admin/photo-requests/:id) and the admin
// Inventory → Photo requests tab. Pure module — no browser or Node APIs.

export const PHOTO_REQUEST_STATUSES = [
  { value: "new", label: "Waiting" },
  { value: "sent", label: "Photos sent" },
  { value: "closed", label: "Closed" },
] as const;

export type PhotoRequestStatus = (typeof PHOTO_REQUEST_STATUSES)[number]["value"];

export function isPhotoRequestStatus(value: unknown): value is PhotoRequestStatus {
  return PHOTO_REQUEST_STATUSES.some((s) => s.value === value);
}

export function photoRequestStatusLabel(status: string): string {
  return PHOTO_REQUEST_STATUSES.find((s) => s.value === status)?.label ?? status;
}

/** The reply promise shown to shoppers (owner-approved: within 24 hours). */
export const PHOTO_REQUEST_REPLY_HOURS = 24;

/**
 * Photo requests are only offered on cards priced $5 and up (owner's call,
 * 2026-09-27): photographing a cheaper card costs more time than it earns.
 */
export const PHOTO_REQUEST_MIN_PRICE_CENTS = 500;
/** "$5", for copy. */
export const PHOTO_REQUEST_MIN_PRICE_LABEL = `$${PHOTO_REQUEST_MIN_PRICE_CENTS / 100}`;

/**
 * Whether a listing can get a photo request. Uses the regular price, so a
 * card on sale doesn't lose (or flicker) the option: the higher of the
 * current price and the pre-sale price.
 */
export function photoRequestAllowed(
  priceCents: number | null | undefined,
  originalPriceCents?: number | null,
): boolean {
  return Math.max(priceCents ?? 0, originalPriceCents ?? 0) >= PHOTO_REQUEST_MIN_PRICE_CENTS;
}

export const PHOTO_REQUEST_MAX_NOTE = 500;
export const PHOTO_REQUEST_MAX_STAFF_MESSAGE = 1000;

/** Photos staff can send per request (front, back, close-ups). */
export const PHOTO_REQUEST_MAX_PHOTOS = 6;

/** Staff photos: formats every email client can show. */
export const PHOTO_REQUEST_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PHOTO_REQUEST_MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Hours before a waiting request counts as overdue on the dashboard. */
export function isPhotoRequestOverdue(createdAt: string, now: number = Date.now()): boolean {
  return now - new Date(createdAt).getTime() > PHOTO_REQUEST_REPLY_HOURS * 60 * 60 * 1000;
}
