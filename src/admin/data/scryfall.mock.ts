// MOCK Scryfall catalog — a stand-in for live Scryfall search in local/dev.
//
// Unlike a real integration this is a small curated set, but it deliberately
// includes MULTIPLE printings per card name (different sets, collector numbers,
// treatments, finishes) so the exact-printing UX is exercised without a network
// call. In production, ScryfallRepository hits /api/admin/scryfall/search and
// normalizes real responses via services/scryfall.ts.

import type { ScryfallCard } from "../services/scryfall.types";

/** A tinted SVG data-URI "card image" so variants look visually distinct. */
function img(hue: number, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680" viewBox="0 0 488 680">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},45%,32%)"/>
      <stop offset="1" stop-color="hsl(${hue},55%,22%)"/>
    </linearGradient></defs>
    <rect width="488" height="680" rx="26" fill="url(#g)"/>
    <rect x="26" y="26" width="436" height="628" rx="14" fill="none" stroke="hsl(45,70%,62%)" stroke-width="4" opacity="0.65"/>
    <rect x="46" y="70" width="396" height="300" rx="8" fill="hsl(${hue},40%,42%)" opacity="0.5"/>
    <text x="244" y="230" font-family="Georgia, serif" font-size="40" fill="hsl(45,70%,80%)" text-anchor="middle">✦</text>
    <text x="244" y="470" font-family="Georgia, serif" font-size="22" fill="hsl(45,60%,88%)" text-anchor="middle">${label}</text>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function imageUris(hue: number, label: string) {
  const u = img(hue, label);
  return { small: u, normal: u, large: u, png: u, art_crop: u };
}

let idSeq = 1000;
function sid(): string {
  idSeq += 1;
  return `mockscry-${idSeq.toString(16)}`;
}

interface Seed {
  name: string;
  oracle: string;
  setName: string;
  set: string;
  cn: string;
  rarity: string;
  type: string;
  hue: number;
  finishes: string[];
  usd?: string;
  usdFoil?: string;
  usdEtched?: string;
  frame?: string;
  frameEffects?: string[];
  borderColor?: string;
  promo?: boolean;
  promoTypes?: string[];
  fullArt?: boolean;
  variation?: boolean;
  artist?: string;
}

function card(seed: Seed): ScryfallCard {
  return {
    object: "card",
    id: sid(),
    oracle_id: seed.oracle,
    name: seed.name,
    lang: "en",
    released_at: "2021-06-18",
    layout: "normal",
    type_line: seed.type,
    rarity: seed.rarity,
    set: seed.set.toLowerCase(),
    set_name: seed.setName,
    collector_number: seed.cn,
    artist: seed.artist ?? "Studio Illustrator",
    image_uris: imageUris(seed.hue, `${seed.set} #${seed.cn}`),
    finishes: seed.finishes,
    nonfoil: seed.finishes.includes("nonfoil"),
    foil: seed.finishes.includes("foil"),
    frame: seed.frame ?? "2015",
    frame_effects: seed.frameEffects ?? [],
    border_color: seed.borderColor ?? "black",
    full_art: seed.fullArt ?? false,
    textless: false,
    promo: seed.promo ?? false,
    promo_types: seed.promoTypes ?? [],
    variation: seed.variation ?? false,
    prices: {
      usd: seed.usd ?? null,
      usd_foil: seed.usdFoil ?? null,
      usd_etched: seed.usdEtched ?? null,
    },
  };
}

/** A double-faced (transform) card with per-face images, for layout coverage. */
function dfc(): ScryfallCard {
  const front = imageUris(275, "MID #287 front");
  const back = imageUris(200, "MID #287 back");
  return {
    object: "card",
    id: sid(),
    oracle_id: "oracle-fable",
    name: "Fable of the Mirror-Breaker // Reflection of Kiki-Rikki",
    lang: "en",
    released_at: "2022-02-18",
    layout: "modal_dfc",
    rarity: "rare",
    set: "neo",
    set_name: "Kamigawa: Neon Dynasty",
    collector_number: "141",
    artist: "Studio Illustrator",
    card_faces: [
      {
        name: "Fable of the Mirror-Breaker",
        mana_cost: "{2}{R}",
        type_line: "Enchantment — Saga",
        oracle_text: "Create a 2/2 red Goblin Shaman creature token…",
        artist: "Studio Illustrator",
        image_uris: front,
      },
      {
        name: "Reflection of Kiki-Rikki",
        mana_cost: "",
        type_line: "Enchantment Creature — Goblin Shaman",
        oracle_text: "Whenever this creature attacks…",
        artist: "Studio Illustrator",
        image_uris: back,
      },
    ],
    finishes: ["nonfoil", "foil"],
    nonfoil: true,
    foil: true,
    frame: "2015",
    frame_effects: [],
    border_color: "black",
    full_art: false,
    textless: false,
    promo: false,
    promo_types: [],
    prices: { usd: "12.99", usd_foil: "18.50", usd_etched: null },
  };
}

/**
 * The mock catalog. Multiple printings for popular cards demonstrate exact
 * printing / art-variant selection (e.g. Lightning Bolt across many sets and
 * treatments).
 */
export const SCRYFALL_MOCK_CARDS: ScryfallCard[] = [
  // Lightning Bolt — many printings & treatments.
  card({ name: "Lightning Bolt", oracle: "oracle-bolt", setName: "Magic 2010", set: "M10", cn: "146", rarity: "common", type: "Instant", hue: 8, finishes: ["nonfoil", "foil"], usd: "3.99", usdFoil: "24.00" }),
  card({ name: "Lightning Bolt", oracle: "oracle-bolt", setName: "Beta", set: "LEB", cn: "161", rarity: "common", type: "Instant", hue: 20, finishes: ["nonfoil"], usd: "899.00", frame: "1997", borderColor: "black" }),
  card({ name: "Lightning Bolt", oracle: "oracle-bolt", setName: "Modern Horizons 2", set: "MH2", cn: "422", rarity: "common", type: "Instant", hue: 12, finishes: ["nonfoil", "foil"], usd: "5.50", usdFoil: "12.00", frame: "1997", frameEffects: ["showcase"] }),
  card({ name: "Lightning Bolt", oracle: "oracle-bolt", setName: "Secret Lair Drop", set: "SLD", cn: "1", rarity: "rare", type: "Instant", hue: 16, finishes: ["nonfoil", "foil", "etched"], usd: "9.99", usdFoil: "14.00", usdEtched: "22.00", borderColor: "borderless", promo: true, promoTypes: ["boosterfun"] }),
  card({ name: "Lightning Bolt", oracle: "oracle-bolt", setName: "Ravnica: Clue Edition", set: "CLU", cn: "141", rarity: "common", type: "Instant", hue: 4, finishes: ["nonfoil"], usd: "2.50" }),

  // Rhystic Study — a couple of printings.
  card({ name: "Rhystic Study", oracle: "oracle-rhystic", setName: "Prophecy", set: "PCY", cn: "45", rarity: "common", type: "Enchantment", hue: 210, finishes: ["nonfoil"], usd: "28.00", frame: "1997" }),
  card({ name: "Rhystic Study", oracle: "oracle-rhystic", setName: "Jumpstart", set: "JMP", cn: "496", rarity: "uncommon", type: "Enchantment", hue: 220, finishes: ["nonfoil"], usd: "24.50" }),
  card({ name: "Rhystic Study", oracle: "oracle-rhystic", setName: "Secret Lair Drop", set: "SLD", cn: "203", rarity: "rare", type: "Enchantment", hue: 230, finishes: ["nonfoil", "foil", "etched"], usd: "39.00", usdFoil: "55.00", usdEtched: "72.00", borderColor: "borderless", promo: true, promoTypes: ["boosterfun"] }),

  // Ragavan — regular + extended-art + showcase.
  card({ name: "Ragavan, Nimble Pilferer", oracle: "oracle-ragavan", setName: "Modern Horizons 2", set: "MH2", cn: "138", rarity: "mythic", type: "Legendary Creature — Monkey Pirate", hue: 22, finishes: ["nonfoil", "foil"], usd: "54.99", usdFoil: "91.00" }),
  card({ name: "Ragavan, Nimble Pilferer", oracle: "oracle-ragavan", setName: "Modern Horizons 2", set: "MH2", cn: "492", rarity: "mythic", type: "Legendary Creature — Monkey Pirate", hue: 26, finishes: ["nonfoil", "foil"], usd: "69.00", usdFoil: "120.00", frameEffects: ["extendedart"] }),
  card({ name: "Ragavan, Nimble Pilferer", oracle: "oracle-ragavan", setName: "Modern Horizons 2", set: "MH2", cn: "382", rarity: "mythic", type: "Legendary Creature — Monkey Pirate", hue: 30, finishes: ["nonfoil", "foil", "etched"], usd: "88.00", usdFoil: "140.00", usdEtched: "210.00", frameEffects: ["showcase"] }),

  // Sol Ring — common staple, several printings.
  card({ name: "Sol Ring", oracle: "oracle-solring", setName: "Commander 2021", set: "C21", cn: "263", rarity: "uncommon", type: "Artifact", hue: 45, finishes: ["nonfoil"], usd: "1.75" }),
  card({ name: "Sol Ring", oracle: "oracle-solring", setName: "Secret Lair Drop", set: "SLD", cn: "88", rarity: "rare", type: "Artifact", hue: 48, finishes: ["nonfoil", "foil"], usd: "12.00", usdFoil: "20.00", borderColor: "borderless", promo: true, promoTypes: ["boosterfun"] }),

  // A DFC for multi-face coverage.
  dfc(),

  // Sheoldred, the Apocalypse.
  card({ name: "Sheoldred, the Apocalypse", oracle: "oracle-sheoldred", setName: "Dominaria United", set: "DMU", cn: "107", rarity: "mythic", type: "Legendary Creature — Phyrexian Praetor", hue: 340, finishes: ["nonfoil", "foil"], usd: "72.50", usdFoil: "95.00" }),
  card({ name: "Sheoldred, the Apocalypse", oracle: "oracle-sheoldred", setName: "Dominaria United", set: "DMU", cn: "396", rarity: "mythic", type: "Legendary Creature — Phyrexian Praetor", hue: 345, finishes: ["nonfoil", "foil"], usd: "120.00", usdFoil: "180.00", frameEffects: ["showcase"], borderColor: "borderless" }),

  // Counterspell.
  card({ name: "Counterspell", oracle: "oracle-counter", setName: "Modern Horizons 2", set: "MH2", cn: "267", rarity: "common", type: "Instant", hue: 215, finishes: ["nonfoil", "foil"], usd: "1.99", usdFoil: "6.00" }),
];
