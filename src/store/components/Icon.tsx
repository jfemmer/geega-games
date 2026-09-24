// A tiny, dependency-free icon set for the storefront header. Deliberately
// separate from src/admin/components/ui/Icon.tsx — the storefront never
// imports from src/admin (see src/store/lib/sellTypes.ts, sellApi.ts) so the
// admin dashboard's lazy-loaded chunk never leaks into the customer bundle.

export type StoreIconName =
  | "user"
  | "cart"
  | "logout"
  | "deck"
  | "heart"
  | "bell"
  | "truck"
  | "tag"
  | "close";

const PATHS: Record<StoreIconName, string> = {
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  cart: "M3 3h2l2.4 12.2a2 2 0 0 0 2 1.8h7.2a2 2 0 0 0 2-1.6L20 8H6M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  logout: "M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9",
  deck: "M12 2 2 7l10 5 10-5-10-5Z M2 17l10 5 10-5 M2 12l10 5 10-5",
  heart:
    "M12 21s-6.7-4.35-9.33-8.2C1.02 10.28 1.6 6.9 4.2 5.3a5.5 5.5 0 0 1 7.3 1.2 5.5 5.5 0 0 1 7.3-1.2c2.6 1.6 3.18 4.98 1.53 7.5C18.7 16.65 12 21 12 21Z",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  truck:
    "M1 4h14v12H1zM15 8h4l3 3v5h-7M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  tag: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8ZM7 7h.01",
  close: "M18 6 6 18M6 6l12 12",
};

export function Icon({
  name,
  size = 20,
  filled = false,
}: {
  name: StoreIconName;
  size?: number;
  /** Solid fill instead of outline-only — used for the wishlist heart's "saved" state. */
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
