import { supabase } from "./supabase";

// Matches the columns in your Supabase `cards` table.
export type Card = {
  id: number;
  name: string;
  set: string | null;
  type: string | null;
  quantity: number;
  image_url: string | null;
  price_usd: number;
  condition: string;
  foil: boolean;
};

export const CONDITION_LABELS: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

export async function fetchCards(): Promise<Card[]> {
  const { data, error } = await supabase
    .from("cards")
    .select("id, name, set, type, quantity, image_url, price_usd, condition, foil")
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Card[];
}