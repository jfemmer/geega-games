// Shared shapes for the Pokémon / One Piece / video game referral form
// (ReferralLeadForm) and POST /api/referral-leads. Geega Games doesn't buy
// these itself: with the seller's consent it passes their details to a
// trusted buying partner. Pure module — the API imports it too.

export const REFERRAL_CATEGORIES = [
  { value: "pokemon", label: "Pokémon cards" },
  { value: "one_piece", label: "One Piece cards" },
  { value: "video_games", label: "Video games & consoles" },
] as const;

export type ReferralCategory = (typeof REFERRAL_CATEGORIES)[number]["value"];

export function isReferralCategory(value: unknown): value is ReferralCategory {
  return REFERRAL_CATEGORIES.some((c) => c.value === value);
}

export function referralCategoryLabel(value: string): string {
  return REFERRAL_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export const REFERRAL_SIZE_OPTIONS = [
  { value: "few_items", label: "Just a few items" },
  { value: "small", label: "A small collection" },
  { value: "large", label: "A large collection" },
  { value: "not_sure", label: "Not sure" },
] as const;

export type ReferralSize = (typeof REFERRAL_SIZE_OPTIONS)[number]["value"];

export const REFERRAL_HANDOFF_OPTIONS = [
  { value: "local", label: "Meet up in the St. Louis area" },
  { value: "ship", label: "Ship it" },
  { value: "either", label: "Either works" },
] as const;

export type ReferralHandoff = (typeof REFERRAL_HANDOFF_OPTIONS)[number]["value"] | "not_sure";

export const REFERRAL_CONTACT_METHODS = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone call" },
  { value: "text", label: "Text" },
] as const;

export type ReferralContactMethod = (typeof REFERRAL_CONTACT_METHODS)[number]["value"];

export function optionLabel(
  options: readonly { value: string; label: string }[],
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return options.find((o) => o.value === value)?.label ?? value;
}

/** Hard server limits, mirrored in the form so a seller never loses input silently. */
export const REFERRAL_MAX_DESCRIPTION = 4000;
/** Matches CollectionPhotoUpload's MAX_PHOTOS, which the referral form reuses. */
export const REFERRAL_MAX_PHOTOS = 30;
