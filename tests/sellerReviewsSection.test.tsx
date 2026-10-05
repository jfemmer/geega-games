// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SellerReviewsSection, ShopRatingLine } from "../src/store/components/SellLandingSections";
import {
  SELLER_REVIEWS,
  SELLER_REVIEW_SUMMARY,
  sellerReviewStats,
  type SellerReview,
  type SellerReviewSummary,
} from "../src/seo/sellerReviews";
import { GOOGLE_REVIEW_URL, TCGPLAYER_SELLER_URL } from "../src/seo/site";

afterEach(cleanup);

/** "1,687 five-star reviews" for the count on file. */
function fiveStarText(): string {
  const count = SELLER_REVIEW_SUMMARY.fiveStarReviews?.count;
  if (!count) throw new Error("The headline needs our TCGplayer count (SELLER_REVIEW_SUMMARY.fiveStarReviews).");
  return `${count.toLocaleString("en-US")} five-star reviews`;
}

describe("SellerReviewsSection", () => {
  it("links past customers to our Google review form and shows the TCGplayer record", () => {
    render(<SellerReviewsSection />);
    const google = screen.getByRole("link", { name: /leave a google review/i });
    expect(google).toHaveAttribute("href", GOOGLE_REVIEW_URL);
    expect(google).toHaveAttribute("target", "_blank");
    expect(google).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: /buyer feedback on tcgplayer/i })).toHaveAttribute(
      "href",
      TCGPLAYER_SELLER_URL,
    );
  });

  it("quotes a few reviews at first and the rest on request", async () => {
    const user = userEvent.setup();
    const withText = SELLER_REVIEWS.filter((r) => r.text).length;
    render(<SellerReviewsSection />);
    expect(screen.getAllByRole("listitem")).toHaveLength(Math.min(6, withText));
    await user.click(screen.getByRole("button", { name: `Show ${withText - 6} more reviews` }));
    expect(screen.getAllByRole("listitem")).toHaveLength(withText);
    await user.click(screen.getByRole("button", { name: "Show fewer reviews" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  // The headline is our five-star count on TCGplayer. It used to describe
  // only the reviews pasted into the site ("5 out of 5 from 13 TCGplayer
  // reviews").
  it("gives our five-star count on TCGplayer in the headline, not the number quoted", () => {
    const { fiveStarTotal, onFile } = sellerReviewStats();
    expect(fiveStarTotal).toBe(SELLER_REVIEW_SUMMARY.fiveStarReviews?.count);
    expect(fiveStarTotal).toBeGreaterThan(onFile);

    render(<SellerReviewsSection />);
    const headline = document.querySelector(".gg-reviews-summary");
    expect(headline).toHaveTextContent(`${fiveStarText()} on TCGplayer`);
    expect(headline?.querySelector("strong")).toHaveTextContent(fiveStarText());
    expect(headline?.querySelector('[role="img"]')).toHaveAttribute("aria-label", "5 out of 5 stars");
    // No average is claimed for the whole record, and the old count is gone.
    expect(headline).not.toHaveTextContent(/out of 5/);
    expect(headline).not.toHaveTextContent(`${onFile} TCGplayer reviews`);
  });

  it("says the quotes are only some of them, and never offers to show “all”", () => {
    render(<SellerReviewsSection />);
    expect(screen.getByText(/Some of those reviews are copied below, word for word/)).toBeInTheDocument();
    expect(screen.queryByText(/These are copied word for word/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  });
});

describe("ShopRatingLine", () => {
  it("gives the same count by the sell buttons and links to the reviews", () => {
    render(<ShopRatingLine />);
    const link = screen.getByRole("link", { name: `${fiveStarText()} from our TCGplayer customers` });
    expect(link).toHaveAttribute("href", "#reviews");
    expect(screen.getByRole("img", { name: "5 out of 5 stars" })).toBeInTheDocument();
  });
});

describe("sellerReviewStats", () => {
  const review = (rating: number): SellerReview => ({ buyer: "a****1", date: "2026-01-01", rating, text: null });
  const summary = (fiveStarReviews: SellerReviewSummary["fiveStarReviews"]): SellerReviewSummary => ({
    positivePercent: null,
    sales: null,
    fiveStarReviews,
  });

  it("gives TCGplayer's five-star count when it is on file", () => {
    const stats = sellerReviewStats([review(5), review(5)], summary({ count: 1687, asOf: "2026-10-05" }));
    expect(stats).toEqual({ onFile: 2, average: 5, averageLabel: "5", fiveStarTotal: 1687 });
  });

  it("describes the reviews on file when there is no count", () => {
    expect(sellerReviewStats([review(5), review(4)], summary(null))).toEqual({
      onFile: 2,
      average: 4.5,
      averageLabel: "4.5",
      fiveStarTotal: null,
    });
    expect(sellerReviewStats([review(5), review(5), review(4)], summary(null)).averageLabel).toBe("4.7");
    expect(sellerReviewStats([], summary(null))).toEqual({
      onFile: 0,
      average: 0,
      averageLabel: "0",
      fiveStarTotal: null,
    });
  });

  it("keeps the count when a review on file isn't five stars — it only counts the five-star ones", () => {
    const stats = sellerReviewStats([review(5), review(3)], summary({ count: 1687, asOf: "2026-10-05" }));
    expect(stats.fiveStarTotal).toBe(1687);
    expect(stats.averageLabel).toBe("4");
  });

  it("ignores a count smaller than the five-star reviews on file — that number is out of date", () => {
    const reviews = [review(5), review(5), review(5), review(4)];
    expect(sellerReviewStats(reviews, summary({ count: 2, asOf: "2026-01-01" })).fiveStarTotal).toBeNull();
    expect(sellerReviewStats(reviews, summary({ count: 3, asOf: "2026-01-01" })).fiveStarTotal).toBe(3);
    expect(sellerReviewStats(reviews, summary({ count: 0, asOf: "2026-01-01" })).fiveStarTotal).toBeNull();
  });
});

describe("the TCGplayer count on file", () => {
  it("is a whole number of reviews with a real date", () => {
    const counted = SELLER_REVIEW_SUMMARY.fiveStarReviews;
    if (!counted) throw new Error("The headline needs our TCGplayer count (SELLER_REVIEW_SUMMARY.fiveStarReviews).");
    expect(Number.isInteger(counted.count)).toBe(true);
    expect(counted.count).toBeGreaterThanOrEqual(SELLER_REVIEWS.filter((r) => r.rating === 5).length);
    expect(counted.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(counted.asOf))).toBe(false);
  });
});
