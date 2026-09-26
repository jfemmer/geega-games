// Real buyer feedback for Geega Games, copied from our public TCGplayer
// seller page. Rendered by SellerReviewsSection on the sell pages.
//
// Content rules (FTC rule on fake reviews and testimonials, effective
// 2024-10-21):
//   * Only paste feedback that actually appears on the TCGplayer page below.
//     Never write, edit for meaning, or "improve" a review. Trimming
//     whitespace or fixing an obvious typo is the most we do.
//   * Don't cherry-pick only the glowing ones: take the most recent reviews
//     in order.
//   * `buyer` is what TCGplayer itself shows (usually a first name or
//     initials). Never add a surname that isn't there.
//   * Leave `summary` fields null until they're copied from the live page.
//
// While `reviews` is empty, the section shows only the link to the
// TCGplayer page so visitors can check our record themselves.

export const TCGPLAYER_SELLER_URL = "https://www.tcgplayer.com/sellers/Geega-Games/2a2a200d";

export interface SellerReview {
  /** As shown on TCGplayer, e.g. "Jordan" or "J.M.". */
  buyer: string;
  /** ISO date (YYYY-MM-DD) the feedback was left. */
  date: string;
  /** The feedback text, verbatim. */
  text: string;
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

export const SELLER_REVIEWS: SellerReview[] = [];
