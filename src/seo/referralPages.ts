// Content for the "sell other things" pages: people selling Pokémon cards,
// One Piece cards or video games. Geega Games doesn't buy these itself — it
// connects the seller with a trusted buying partner (unnamed on purpose), who
// meets up around St. Louis or buys by mail. Rendered by SellReferralPage.
//
// Content rules:
//   * Never say or imply that Geega Games buys these. "Our buying partner"
//     makes the offer; we pass the details along with the seller's consent.
//   * No specific payout, price or turnaround promises, and nothing about how
//     the partner pays or prices — the partner sets those. The one approved
//     claim (owner, 2026-09-25): the partner "buys very competitively" (use
//     those words, not a paraphrase).
//   * Keep the tips factual and evergreen (no card prices, nothing that
//     goes stale with the next set). Dated facts say when they were true.
//
// Seller research (2026-09-27) behind the wording: sellers' top worries are
// lowball offers, not knowing what they have, the work of listing everything,
// meeting strangers from Marketplace, fees and returns, and offers that change
// later. So the pages lead with "free, no obligation, no sorting", explain the
// partner setup up front, compare honestly with selling it yourself, and show
// how to judge any offer.

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
  /**
   * One research-backed section for what most worries sellers in this
   * market (2026-09-25): grading for Pokémon, reprints and rotation for One
   * Piece, trade-in offers for video games. Dated facts say when.
   */
  insight: { heading: string; paragraphs: string[] };
  /** "Why not just sell it yourself?": an honest comparison with listing it. */
  sellYourself: { intro: string; points: string[] };
  /** Where to look up sold prices, for "How to tell if an offer is fair". */
  priceCheck: string;
  /** Category-specific FAQ entries; shared ones are added by the page. */
  faq: { question: string; answer: string }[];
  descriptionPlaceholder: string;
}

const CARD_SELL_YOURSELF_POINTS = [
  "Looking up, photographing and listing every card",
  "Fees of about 13% or more on eBay and TCGplayer, plus shipping supplies",
  "Packing every order, and handling returns and buyer claims",
  "Haggling, no-shows and meeting strangers from Marketplace",
];

export const REFERRAL_PAGES: ReferralPage[] = [
  {
    category: "pokemon",
    path: "/sell-pokemon-cards",
    noun: "Pokémon cards",
    title: "Sell Pokémon Cards in St. Louis — Meet Up or Ship | Geega Games",
    description:
      "Get a free, no-obligation offer on your Pokémon cards in St. Louis — binders, graded slabs, sealed product or whole collections. Our trusted buying partner buys very competitively.",
    heading: "Sell your Pokémon cards in St. Louis",
    intro:
      "Your childhood binder, graded slabs, sealed boxes or a whole collection — tell us what you have. With your OK, we'll pass it to the Pokémon buyer we know and trust, who buys very competitively and will contact you about an offer.",
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
    insight: {
      heading: "Should you get your cards graded before selling?",
      paragraphs: [
        "Grading (PSA, BGS or CGC) can raise the price of a high-value card in top condition, but it's slow and costly: in 2026, PSA's cheapest tiers ran about $25–30 a card with waits of several months, and its Regular tier about $80 a card.",
        "It usually only makes sense for cards worth a few hundred dollars raw and in excellent shape. For most cards, selling raw now is simpler and nets about the same — without the wait or the risk of a disappointing grade.",
        "Already graded? Just list the grading company, the grade and the certification number in the form.",
      ],
    },
    sellYourself: {
      intro:
        "Listing cards yourself on eBay, TCGplayer or Facebook Marketplace can get the most money for a single valuable card. For a binder or a whole collection, it usually means:",
      points: CARD_SELL_YOURSELF_POINTS,
    },
    priceCheck:
      "Look up recent sold prices for your best few cards — eBay's sold listings or TCGplayer's market price — rather than asking prices.",
    faq: [
      {
        question: "Are my old Pokémon cards worth anything?",
        answer:
          "Some are worth a lot. Cards from 1999–2003 (Base Set, Jungle, Fossil, Team Rocket and Neo), 1st Edition and shadowless cards, holo rares and modern secret rares are the first ones to check — the tips on this page show what to look for. You don't need to work it out before asking for an offer.",
      },
      {
        question: "Where can I sell Pokémon cards in St. Louis?",
        answer:
          "You can sell to a local game store, list cards yourself on TCGplayer or eBay, or use Facebook Marketplace. For a binder or a whole collection, the easiest route is to tell us what you have here: we'll connect you with our buying partner, who buys very competitively and meets up around St. Louis. Our guide to where to sell cards in St. Louis compares every option.",
      },
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
    title: "Sell One Piece Cards in St. Louis — Meet Up or Ship | Geega Games",
    description:
      "Get a free, no-obligation offer on your One Piece cards in St. Louis — manga rares, alt arts, Leaders, sealed boxes or whole collections. Our trusted buying partner buys very competitively.",
    heading: "Sell your One Piece cards in St. Louis",
    intro:
      "Alt arts, manga rares, sealed booster boxes, or decks you've stopped playing since rotation — tell us what you have. With your OK, we'll pass it to the One Piece Card Game buyer we know and trust, who buys very competitively and will contact you about an offer.",
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
    insight: {
      heading: "One Piece prices move fast",
      paragraphs: [
        "Bandai reprints cards and whole sets when they sell out, and reprinted cards have fallen sharply on the secondary market — in some cases by around 40% during 2026. Prices can shift week to week, so an offer based on today's market is worth more than a guess from last month.",
        "Rotation matters too. Bandai's first Standard rotation, on April 1, 2026, moved the earliest block of cards — the OP-01 to OP-04 era — out of Standard play. They're still legal in Extra Regulation and alt arts are still collected, but cards people mainly wanted for Standard decks can lose value.",
        "For the most accurate offer, include each notable card's set code (like OP05), whether it's English or Japanese, and whether it's an alt art or manga rare.",
      ],
    },
    sellYourself: {
      intro:
        "Listing cards yourself on TCGplayer, eBay or Facebook Marketplace can get the most money for a single valuable card. For a binder or a whole collection, it usually means:",
      points: CARD_SELL_YOURSELF_POINTS,
    },
    priceCheck:
      "Look up recent sold prices for your best few cards — eBay's sold listings or TCGplayer's market price — rather than asking prices. English and Japanese versions are priced separately.",
    faq: [
      {
        question: "Are my One Piece cards worth anything?",
        answer:
          "Most commons aren't worth much, but alt arts, manga rares, Secret Rares (SEC), Special cards (SP) and sealed booster boxes can be. Check the rarity code at the bottom of each card — the tips on this page explain them — or just describe what you have and let our buying partner tell you.",
      },
      {
        question: "Did rotation make my older One Piece cards worthless?",
        answer:
          "No. Cards from the first block (the OP-01 to OP-04 era) left Standard on April 1, 2026, but they're still legal in Extra Regulation, and alt arts and manga rares are still collected. Rotation can lower prices for cards people mainly wanted for Standard decks.",
      },
      {
        question: "Where can I sell One Piece cards in St. Louis?",
        answer:
          "Some local game stores buy One Piece cards, St. Louis has local buy/sell/trade groups, and you can list cards yourself online. For alt arts, manga rares or a whole collection, tell us what you have here and we'll connect you with our buying partner, who buys very competitively and meets up around St. Louis or buys by mail.",
      },
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
      "Get a free, no-obligation offer on your video games in St. Louis — retro and modern games, consoles, complete-in-box or whole collections. Our trusted buying partner buys very competitively.",
    heading: "Sell your video games in St. Louis",
    intro:
      "Old games collecting dust, a console you've upgraded from, or a whole collection — tell us what you have. With your OK, we'll pass it to the video game buyer we know and trust, who buys very competitively and will contact you about an offer.",
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
        title: "Reset modern consoles",
        text: "Before you hand over a Switch, PlayStation or Xbox, sign out of your accounts and reset it to factory settings to protect your data.",
      },
      {
        title: "Photos of labels and boxes help",
        text: "A photo of the game spines on a shelf, or of cartridge labels, is often all a buyer needs to get started.",
      },
    ],
    insight: {
      heading: "Get a second offer before you trade in",
      paragraphs: [
        "Chain-store trade-in counters are quick, but their offers on older games are often well below what collectors pay, and some won't take retro games or older consoles at all.",
        "Before you trade in a box of old games, it's worth asking for a second offer. It's free, and you can compare it with anything else.",
      ],
    },
    sellYourself: {
      intro:
        "Listing games yourself on eBay or Facebook Marketplace can get the most money for a rare title. For a shelf or a box of games, it usually means:",
      points: [
        "Testing, photographing and listing every game",
        "Selling fees, plus boxes and shipping for every order",
        "Returns when something arrives \"not working\"",
        "Haggling, no-shows and \"is this still available?\" messages",
      ],
    },
    priceCheck:
      "Look up recent sold prices for your best few games — PriceCharting or eBay's sold listings — rather than asking prices. Loose, complete-in-box and sealed copies are priced separately.",
    faq: [
      {
        question: "Are my old video games worth anything?",
        answer:
          "Some are worth a lot, many are worth a little. Complete-in-box copies, factory-sealed games and some Nintendo, Sega and PlayStation titles are the first ones to check — the tips on this page show what matters. You don't need to know before you ask.",
      },
      {
        question: "Where can I sell video games in St. Louis?",
        answer:
          "Chain stores and pawn shops are quick but usually offer the least, and some won't take older games. Local game shops vary a lot. Listing games yourself on eBay or Facebook Marketplace can pay the most for your best games, but it's the most work. For a collection, tell us what you have here and we'll connect you with our buying partner, who buys very competitively and meets up around St. Louis.",
      },
      {
        question: "Can I sell games without their cases or manuals?",
        answer:
          "Yes, include them. Loose cartridges and discs are part of most collections — just say which games are loose and which are complete. Our buying partner will tell you what they can make an offer on.",
      },
      {
        question: "I can't test my games or consoles. Can I still ask?",
        answer: "Yes. Say they're untested, and our buying partner will take that into account.",
      },
      {
        question: "Do you buy consoles or games that don't work?",
        answer:
          "Mention it in the form either way. Our buying partner will tell you whether they can make an offer on items that need repair.",
      },
      {
        question: "Should I sell games one at a time or as a lot?",
        answer:
          "A rare game can bring more on its own if you're willing to list, photograph and ship it. For a shelf of everyday games, selling them together is much faster — ask for an offer on everything, then decide.",
      },
      {
        question: "I'm selling a relative's collection. Where do I start?",
        answer:
          "Don't sort, clean or test anything. Take a few photos of what's there — shelves, boxes, consoles — and describe it as best you can. That's enough to get started.",
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
