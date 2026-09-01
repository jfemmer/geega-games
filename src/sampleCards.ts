// Sample inventory so the storefront looks complete before the backend is wired.
// When Supabase is connected, replace SAMPLE_CARDS with a fetch that returns the
// same shape — the UI components do not need to change.
export type Card = {
  id: string;
  name: string;
  set: string;
  type: string;
  color: "W" | "U" | "B" | "R" | "G" | "C";
  condition: "NM" | "LP" | "MP" | "HP" | "DMG";
  foil: boolean;
  priceUsd: number;
  quantity: number;
  image: string;
};

export const SAMPLE_CARDS: Card[] = [
  { id: "c1", name: "Lightning Bolt", set: "Double Masters 2022", type: "Instant", color: "R", condition: "NM", foil: false, priceUsd: 4.25, quantity: 8, image: "/cards/c1.png" },
  { id: "c2", name: "Sol Ring", set: "Commander Masters", type: "Artifact", color: "C", condition: "NM", foil: true, priceUsd: 3.10, quantity: 12, image: "/cards/c2.png" },
  { id: "c3", name: "Counterspell", set: "Modern Horizons 2", type: "Instant", color: "U", condition: "LP", foil: false, priceUsd: 1.75, quantity: 20, image: "/cards/c3.png" },
  { id: "c4", name: "Llanowar Elves", set: "Dominaria", type: "Creature", color: "G", condition: "NM", foil: false, priceUsd: 0.50, quantity: 40, image: "/cards/c4.png" },
  { id: "c5", name: "Swords to Plowshares", set: "Strixhaven Mystical Archive", type: "Instant", color: "W", condition: "NM", foil: true, priceUsd: 2.90, quantity: 6, image: "/cards/c5.png" },
  { id: "c6", name: "Dark Ritual", set: "Tempest", type: "Instant", color: "B", condition: "MP", foil: false, priceUsd: 1.20, quantity: 15, image: "/cards/c6.png" },
  { id: "c7", name: "Birds of Paradise", set: "Double Masters 2022", type: "Creature", color: "G", condition: "NM", foil: true, priceUsd: 6.75, quantity: 5, image: "/cards/c7.png" },
  { id: "c8", name: "Wrath of God", set: "Dominaria Remastered", type: "Sorcery", color: "W", condition: "LP", foil: false, priceUsd: 3.40, quantity: 9, image: "/cards/c8.png" },
];

export const COLOR_LABELS: Record<Card["color"], string> = {
  W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless",
};

export const CONDITION_LABELS: Record<Card["condition"], string> = {
  NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played", HP: "Heavily Played", DMG: "Damaged",
};