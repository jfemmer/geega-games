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

  // The headline is our whole record on TCGplayer. It used to count only the
  // reviews pasted into the site ("from 13 TCGplayer reviews").
  it("counts every TCGplayer review in the headline, not just the ones quoted", () => {
    const { total, averageLabel, onFile } = sellerReviewStats();
    expect(total).toBe(SELLER_REVIEW_SUMMARY.ratings?.count);
    expect(total).toBeGreaterThan(onFile);

    render(<SellerReviewsSection />);
    expect(document.querySelector(".gg-reviews-summary")).toHaveTextContent(
      `${averageLabel} out of 5 from ${total.toLocaleString("en-US")} TCGplayer reviews`,
    );
  });

  it("says the quotes are only some of them, and never offers to show “all”", () => {
    render(<SellerReviewsSection />);
    expect(screen.getByText(/Some of those reviews are copied below, word for word/)).toBeInTheDocument();
    expect(screen.queryByText(/These are copied word for word/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  });
});

describe("ShopRatingLine", () => {
  it("shows the same count by the sell buttons and links to the reviews", () => {
    const { total, averageLabel } = sellerReviewStats();
    render(<ShopRatingLine />);
    const link = screen.getByRole("link", {
      name: `Rated ${averageLabel} out of 5 by our TCGplayer customers (${total.toLocaleString("en-US")} reviews)`,
    });
    expect(link).toHaveAttribute("href", "#reviews");
  });
});

describe("sellerReviewStats", () => {
  const review = (rating: number): SellerReview => ({ buyer: "a****1", date: "2026-01-01", rating, text: null });
  const summary = (ratings: SellerReviewSummary["ratings"]): SellerReviewSummary => ({
    positivePercent: null,
    sales: null,
    ratings,
  });

  it("uses TCGplayer's own totals when they are on file", () => {
    const stats = sellerReviewStats(
      [review(5), review(5)],
      summary({ count: 795, average: 5, asOf: "2026-10-05" }),
    );
    expect(stats).toEqual({ total: 795, average: 5, averageLabel: "5", onFile: 2 });
  });

  it("shows one decimal when the average isn't a whole number", () => {
    const stats = sellerReviewStats([], summary({ count: 1204, average: 4.86, asOf: "2026-10-05" }));
    expect(stats.averageLabel).toBe("4.9");
    expect(stats.total).toBe(1204);
  });

  it("counts the reviews on file when there are no totals", () => {
    expect(sellerReviewStats([review(5), review(4)], summary(null))).toEqual({
      total: 2,
      average: 4.5,
      averageLabel: "4.5",
      onFile: 2,
    });
    expect(sellerReviewStats([], summary(null))).toEqual({ total: 0, average: 0, averageLabel: "0", onFile: 0 });
  });

  it("ignores a total smaller than what's on file — that number is out of date", () => {
    const stats = sellerReviewStats(
      [review(5), review(5), review(4)],
      summary({ count: 2, average: 5, asOf: "2026-01-01" }),
    );
    expect(stats.total).toBe(3);
    expect(stats.averageLabel).toBe("4.7");
  });
});

describe("the TCGplayer totals on file", () => {
  it("are a whole number of reviews, a real average and a real date", () => {
    const totals = SELLER_REVIEW_SUMMARY.ratings;
    if (!totals) throw new Error("The headline needs our TCGplayer totals (SELLER_REVIEW_SUMMARY.ratings).");
    expect(Number.isInteger(totals.count)).toBe(true);
    expect(totals.count).toBeGreaterThanOrEqual(SELLER_REVIEWS.length);
    expect(totals.average).toBeGreaterThanOrEqual(1);
    expect(totals.average).toBeLessThanOrEqual(5);
    expect(totals.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(totals.asOf))).toBe(false);
  });
});
