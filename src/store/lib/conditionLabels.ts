// Card condition codes, as shoppers read them. Pure module — the storefront
// and the server-side catalog pages (api/catalog-page.ts) share it.
export const CONDITION_LABELS: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};
