// Real buyer feedback for Geega Games, copied from our public TCGplayer
// seller page. Rendered by SellerReviewsSection (home page and sell pages).
//
// Content rules (FTC rule on fake reviews and testimonials, effective
// 2024-10-21):
//   * Only paste feedback that actually appears on the TCGplayer page below,
//     word for word. Never write, reword or "improve" a review.
//   * Don't cherry-pick: add new reviews in date order, good or bad, and
//     keep star ratings as TCGplayer shows them.
//   * `buyer` is exactly what TCGplayer shows (it masks names, e.g. "v****1").
//   * Reviews with no comment are kept (they count toward the record) but
//     have no text to show, so the section only quotes ones with text.
//
// Source: screenshots of the TCGplayer seller feedback page supplied by the
// owner, 2026-09-26.

export { TCGPLAYER_SELLER_URL } from "./site.js";

export interface SellerReview {
  /** As shown on TCGplayer, e.g. "v****1". */
  buyer: string;
  /** ISO date (YYYY-MM-DD) the feedback was left. */
  date: string;
  /** Stars, 1–5, as shown on TCGplayer. */
  rating: number;
  /** The feedback text, verbatim; null when the buyer left no comment. */
  text: string | null;
}

export interface SellerReviewSummary {
  /** e.g. "99.8%" — the positive-feedback figure TCGplayer shows. */
  positivePercent: string | null;
  /** e.g. "1,200+" — the sales count TCGplayer shows. */
  sales: string | null;
}

export const SELLER_REVIEW_SUMMARY: SellerReviewSummary = {
  positivePercent: null,
  sales: null,
};

/** Newest first. */
export const SELLER_REVIEWS: SellerReview[] = [
  { buyer: "a****9", date: "2026-09-14", rating: 5, text: "Awesome seller. Fast shipping!" },
  { buyer: "m****0", date: "2026-09-12", rating: 5, text: "A+ great packaging and card condition! Thanks!" },
  { buyer: "b****8", date: "2026-09-10", rating: 5, text: "Card arrived quickly and in great condition, thank you!" },
  { buyer: "j****0", date: "2026-09-10", rating: 5, text: null },
  { buyer: "c****E", date: "2026-09-09", rating: 5, text: null },
  { buyer: "r****3", date: "2026-09-09", rating: 5, text: "Cards arrived as advertised & were packed well!" },
  { buyer: "j****e", date: "2026-09-05", rating: 5, text: "Nice card exactly as described, with fast shipping too! Thanks!" },
  {
    buyer: "m****6",
    date: "2026-09-04",
    rating: 5,
    text: "Card arrived on time and in the advertised condition. Packaging was among the best I have seen. Great care was taken to ensure no damage in transit. Great seller!",
  },
  { buyer: "p****1", date: "2026-09-03", rating: 5, text: "Very fast and the cards are perfect, also love the packaging!" },
  { buyer: "s****8", date: "2026-09-03", rating: 5, text: "Came quickly and well packaged" },
  { buyer: "s****1", date: "2026-09-01", rating: 5, text: "Really fast shipping thank you" },
  {
    buyer: "h****9",
    date: "2026-08-31",
    rating: 5,
    text: "Cards came in protective sleeves, which was a nice surprise. Plain white envelope shipping with some extra padding to protect the cards, which was appreciated. 10/10 great job.",
  },
  {
    buyer: "v****1",
    date: "2026-05-15",
    rating: 5,
    text: "Well packed and secured. Made it to me in time and no issues with the order.",
  },
];
