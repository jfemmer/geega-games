// A tiny, dependency-free icon set for the storefront header. Deliberately
// separate from src/admin/components/ui/Icon.tsx — the storefront never
// imports from src/admin (see src/store/lib/sellTypes.ts, sellApi.ts) so the
// admin dashboard's lazy-loaded chunk never leaks into the customer bundle.

export type StoreIconName = "user" | "cart" | "logout";

const PATHS: Record<StoreIconName, string> = {
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  cart: "M3 3h2l2.4 12.2a2 2 0 0 0 2 1.8h7.2a2 2 0 0 0 2-1.6L20 8H6M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  logout: "M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9",
};

export function Icon({ name, size = 20 }: { name: StoreIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
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
