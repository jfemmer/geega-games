// What staff can get push notifications for. Shared by the admin app (the
// per-device toggles and in-app sounds) and the API (api/_lib/staffPush.ts,
// api/admin/push.ts), and mirrored by the staff_push_subscriptions.kinds
// check constraint. Pure module — no browser or Node APIs.

export const STAFF_PUSH_KINDS = [
  { value: "order", label: "New online orders", hint: "Paid orders waiting to be packed." },
  { value: "buying_lead", label: "New buying leads", hint: "Sell Your Cards submissions and quick photo quotes." },
  { value: "partner_lead", label: "New partner leads", hint: "Pokémon, One Piece and video game sellers." },
  { value: "signup", label: "New customer sign-ups", hint: "Someone creates a Geega Games account." },
  { value: "offer_response", label: "Offer responses", hint: "A seller accepts, declines or counters your offer." },
  { value: "pickup", label: "Pickup requests", hint: "Kiosk requests to pull cards for pickup." },
] as const;

export type StaffPushKind = (typeof STAFF_PUSH_KINDS)[number]["value"];

export const ALL_STAFF_PUSH_KINDS: StaffPushKind[] = STAFF_PUSH_KINDS.map((k) => k.value);

export function isStaffPushKind(value: unknown): value is StaffPushKind {
  return STAFF_PUSH_KINDS.some((k) => k.value === value);
}
