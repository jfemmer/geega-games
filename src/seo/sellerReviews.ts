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
//   * The headline ("1,687 five-star reviews on TCGplayer") is TCGplayer's
//     own count of our five-star reviews —
//     SELLER_REVIEW_SUMMARY.fiveStarReviews — not how many reviews are pasted
//     below. It says how many five-star reviews there are and nothing about
//     an average, so it stays true whatever else is on the record. Change the
//     count and its date together, from the TCGplayer page. Never estimate
//     or round up.
//
// Source: screenshots of the TCGplayer seller feedback page supplied by the
// owner, 2026-09-26 (the reviews); the owner's count, 2026-10-05 (the
// five-star total).

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

/** How many five-star reviews buyers have left us on TCGplayer, as TCGplayer shows it. */
export interface FiveStarReviewCount {
  count: number;
  /** ISO date (YYYY-MM-DD) the count was read off TCGplayer. */
  asOf: string;
}

export interface SellerReviewSummary {
  /** e.g. "99.8%" — the positive-feedback figure TCGplayer shows. */
  positivePercent: string | null;
  /** e.g. "1,200+" — the sales count TCGplayer shows. */
  sales: string | null;
  /**
   * The headline: "1,687 five-star reviews on TCGplayer". SELLER_REVIEWS is
   * only the handful quoted on the site, so its length is not the size of our
   * record. null → the headline describes the reviews on file instead
   * ("5 out of 5 from 13 TCGplayer reviews").
   */
  fiveStarReviews: FiveStarReviewCount | null;
}

export const SELLER_REVIEW_SUMMARY: SellerReviewSummary = {
  positivePercent: null,
  sales: null,
  // Owner, 2026-10-05: "have it say 1687 5 star reviews" (first given as 795
  // earlier the same morning).
  fiveStarReviews: { count: 1687, asOf: "2026-10-05" },
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

export interface SellerReviewStats {
  /** How many reviews are copied onto the site. */
  onFile: number;
  /** Their average, 1–5; 0 when there are none. */
  average: number;
  /** That average as shown: "5", "4.9". */
  averageLabel: string;
  /**
   * How many five-star reviews we have on TCGplayer in all — TCGplayer's own
   * count — or null when it isn't on file.
   */
  fiveStarTotal: number | null;
}

/**
 * The figures behind the reviews headline. With TCGplayer's count on file it
 * reads "1,687 five-star reviews on TCGplayer"; without one it describes the
 * reviews on file ("5 out of 5 from 13 TCGplayer reviews"). A count smaller
 * than the five-star reviews already on file is out of date, so it is ignored
 * rather than allowed to shrink the record.
 */
export function sellerReviewStats(
  reviews: readonly SellerReview[] = SELLER_REVIEWS,
  summary: SellerReviewSummary = SELLER_REVIEW_SUMMARY,
): SellerReviewStats {
  const onFile = reviews.length;
  const average = onFile > 0 ? reviews.reduce((sum, review) => sum + review.rating, 0) / onFile : 0;
  const averageLabel = Number.isInteger(average) ? String(average) : average.toFixed(1);
  const fiveStarOnFile = reviews.filter((review) => review.rating === 5).length;
  const counted = summary.fiveStarReviews?.count ?? 0;
  const fiveStarTotal = counted > 0 && counted >= fiveStarOnFile ? counted : null;
  return { onFile, average, averageLabel, fiveStarTotal };
}
