// Content for the "sell other things" pages: people selling Pokémon cards,
// One Piece cards or video games. Geega Games doesn't buy these itself — it
// connects the seller with a trusted buying partner (unnamed on purpose), who
// meets up around St. Louis or buys by mail. Rendered by SellReferralPage.
//
// Content rules:
//   * Never say or imply that Geega Games buys these. "Our buying partner"
//     makes the offer; we pass the details along with the seller's consent.
//   * No specific payout, price or turnaround promises — the partner sets
//     those. The one approved claim (owner, 2026-09-25): the partner "buys
//     very competitively".
//   * Keep the tips factual and evergreen (no card prices, nothing that
//     goes stale with the next set).

import type { ReferralCategory } from "../store/lib/referralTypes.js";

export interface ReferralPage {
  category: ReferralCategory;
  path: string;
  /** Short noun used in sentences: "Pokémon cards". */
  noun: string;
  title: string;
  description: string;
  heading: string;
  intro: string;
  items: { title: string; text: string }[];
  tipsHeading: string;
  tips: { title: string; text: string }[];
  /** Category-specific FAQ entries; shared ones are added by the page. */
  faq: { question: string; answer: string }[];
  descriptionPlaceholder: string;
}

export const REFERRAL_PAGES: ReferralPage[] = [
  {
    category: "pokemon",
    path: "/sell-pokemon-cards",
    noun: "Pokémon cards",
    title: "Sell Pokémon Cards in St. Louis — Meet Up or Ship | Geega Games",
    description:
      "Sell your Pokémon cards in St. Louis — binders, graded slabs, sealed product or whole collections. Our trusted buying partner buys very competitively. Meet up or ship.",
    heading: "Sell your Pokémon cards in St. Louis",
    intro:
      "Old binders, graded slabs, sealed boxes, or a shoebox of cards from when you were a kid — tell us what you have and we'll connect you with the trusted Pokémon buyer we work with, who buys very competitively. Meet up around St. Louis, or ship from anywhere in the US.",
    items: [
      {
        title: "Vintage cards",
        text: "Wizards of the Coast–era cards (1999–2003): Base Set, Jungle, Fossil, Team Rocket, Neo and more, including 1st Edition and shadowless.",
      },
      {
        title: "Modern chase cards",
        text: "Alternate arts, special illustration rares, gold and other secret rares from recent sets.",
      },
      { title: "Graded cards", text: "PSA, BGS and CGC slabs, vintage or modern." },
      {
        title: "Sealed product",
        text: "Booster boxes, Elite Trainer Boxes, booster packs and collection boxes.",
      },
      { title: "Japanese cards", text: "Japanese singles and sealed product have their own market." },
      {
        title: "Whole collections",
        text: "Binders, boxes and bulk — sorted or not. Describe it as best you can.",
      },
    ],
    tipsHeading: "How to tell if your Pokémon cards are worth something",
    tips: [
      {
        title: "Look for the 1st Edition stamp",
        text: "Early English cards printed by Wizards of the Coast can have a small black \"Edition 1\" stamp on the left side, just below the artwork. 1st Edition copies are usually worth far more than unlimited ones.",
      },
      {
        title: "Check Base Set cards for \"shadowless\"",
        text: "The earliest Base Set print runs have no drop shadow along the right edge of the artwork box. Shadowless cards sell for more than the later printings.",
      },
      {
        title: "Find the rarity symbol",
        text: "Bottom corner of the card: a circle is common, a diamond is uncommon and a star is rare. Holographic rares have a shiny artwork box.",
      },
      {
        title: "Secret rares are numbered past the set",
        text: "A collector number higher than the set size — like 201/165 — marks a secret rare, which are among the most valuable cards in modern sets.",
      },
      {
        title: "Condition is everything",
        text: "Whitening on the edges, scratches, creases and bends all lower value. Don't try to clean cards, and put anything that looks valuable in a sleeve.",
      },
      {
        title: "Leave sealed product sealed",
        text: "Unopened booster boxes, Elite Trainer Boxes and packs are often worth more unopened than the cards inside.",
      },
    ],
    faq: [
      {
        question: "What about Japanese Pokémon cards?",
        answer:
          "Include them, and mention in the form which cards are Japanese — they're priced separately from English cards. Our buying partner will let you know what they can make an offer on.",
      },
      {
        question: "My cards are graded. Does that change anything?",
        answer:
          "Just list the grading company and grade (for example, PSA 9) in your description — a photo of the slab label helps.",
      },
    ],
    descriptionPlaceholder:
      "e.g. A binder of Base Set and Jungle cards from the '90s, a few PSA 9s, and 2 sealed booster boxes.",
  },
  {
    category: "one_piece",
    path: "/sell-one-piece-cards",
    noun: "One Piece cards",
    title: "Sell One Piece Cards — St. Louis Meetups or Ship | Geega Games",
    description:
      "Sell your One Piece cards — manga rares, alt arts, Leaders, sealed boxes or whole collections. Our trusted buying partner buys very competitively. St. Louis meetups or ship.",
    heading: "Sell your One Piece cards",
    intro:
      "Alt arts, manga rares, sealed booster boxes or a binder full of playsets — tell us what you have and we'll connect you with the trusted One Piece Card Game buyer we work with, who buys very competitively. Meet up around St. Louis, or ship from anywhere in the US.",
    items: [
      {
        title: "Chase rares",
        text: "Manga rares, alternate arts, Secret Rares (SEC) and Special cards (SP).",
      },
      { title: "Leaders", text: "Including alternate-art Leader cards." },
      { title: "Sealed product", text: "Booster boxes, booster packs and starter decks." },
      { title: "English and Japanese", text: "Both have collectors — just tell us which you have." },
      { title: "Graded cards", text: "PSA, BGS and CGC slabs." },
      {
        title: "Playsets & collections",
        text: "Binders, deck boxes and whole collections — sorted or not.",
      },
    ],
    tipsHeading: "What makes One Piece cards valuable",
    tips: [
      {
        title: "Check the rarity code",
        text: "Printed at the bottom of the card next to the card number: C (common), UC (uncommon), R (rare), SR (super rare), SEC (secret rare), L (leader) and more. SEC and SR cards are the first ones to look at.",
      },
      {
        title: "Alternate arts and manga rares",
        text: "Many cards also exist in parallel versions with different artwork — including manga rares, drawn in the style of the manga's panels. These are usually the most valuable version of a card.",
      },
      {
        title: "The card number tells you the set",
        text: "Codes like OP01 or ST01 at the bottom show which booster set or starter deck a card came from.",
      },
      {
        title: "English vs. Japanese",
        text: "Both are collected, but they're priced separately, so let us know which language your cards are.",
      },
      {
        title: "Keep sealed product sealed",
        text: "Unopened booster boxes and packs are often worth more than their contents, especially from older sets.",
      },
      {
        title: "Protect the good ones",
        text: "Sleeve anything that looks valuable. Edge wear and scratches on alt arts lower their value quickly.",
      },
    ],
    faq: [
      {
        question: "Do you buy starter decks and bulk One Piece cards?",
        answer:
          "Include them in your description — our buying partner will let you know what they can make an offer on. Collections are usually easiest to sell all together.",
      },
    ],
    descriptionPlaceholder:
      "e.g. About 300 English cards from OP01–OP05, a manga rare, a few alt-art Leaders and one sealed booster box.",
  },
  {
    category: "video_games",
    path: "/sell-video-games",
    noun: "video games",
    title: "Sell Video Games in St. Louis — Retro & Modern | Geega Games",
    description:
      "Sell your video games in St. Louis — retro and modern games, consoles, complete-in-box or whole collections. Our trusted buying partner buys very competitively. Meet up or ship.",
    heading: "Sell your video games in St. Louis",
    intro:
      "Retro cartridges, a shelf of disc games, consoles and controllers, or a whole collection — tell us what you have and we'll connect you with the trusted video game buyer we work with, who buys very competitively. Meet up around St. Louis, or ship from anywhere in the US.",
    items: [
      {
        title: "Retro games & consoles",
        text: "NES, Super Nintendo, Nintendo 64, GameCube, Sega Genesis, PlayStation 1 and 2, and more.",
      },
      {
        title: "Handhelds",
        text: "Game Boy, Game Boy Color and Advance, Nintendo DS and 3DS, PSP and their games.",
      },
      { title: "Modern games & consoles", text: "Nintendo Switch, PlayStation and Xbox." },
      {
        title: "Complete-in-box & sealed",
        text: "Games with their original box and manual, and factory-sealed games.",
      },
      { title: "Accessories", text: "Controllers, memory cards and other original accessories." },
      {
        title: "Whole collections",
        text: "A closet, a basement or a whole game room — describe it as best you can.",
      },
    ],
    tipsHeading: "Getting the most for your games",
    tips: [
      {
        title: "Complete in box is worth more",
        text: "A game with its original box and manual (\"complete in box\", or CIB) usually sells for noticeably more than the cartridge or disc alone. Keep them together.",
      },
      {
        title: "Sealed games are their own category",
        text: "If a game is still factory sealed, don't open it — sealed copies are valued very differently from opened ones.",
      },
      {
        title: "Don't peel labels or stickers",
        text: "Torn or damaged cartridge labels lower value more than an old price sticker does, so leave removal to the buyer.",
      },
      {
        title: "Keep consoles with their cables and controllers",
        text: "A console with its original controllers and cables is easier to sell than one on its own.",
      },
      {
        title: "Say whether things work",
        text: "If you can test your consoles and games, mention it. If you can't — or something doesn't work — say that too; the buyer will factor it in.",
      },
      {
        title: "Photos of labels and boxes help",
        text: "A photo of the game spines on a shelf, or of cartridge labels, is often all a buyer needs to get started.",
      },
    ],
    faq: [
      {
        question: "Do you buy consoles or games that don't work?",
        answer:
          "Mention it in the form either way. Our buying partner will tell you whether they can make an offer on items that need repair.",
      },
    ],
    descriptionPlaceholder:
      "e.g. An N64 with 2 controllers and 15 loose games, a few complete-in-box GameCube games, and a PS2 that doesn't read discs.",
  },
];

export function referralPageFor(category: ReferralCategory): ReferralPage {
  const page = REFERRAL_PAGES.find((p) => p.category === category);
  if (!page) throw new Error(`No referral page for ${category}`);
  return page;
}
