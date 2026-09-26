// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SellerReviewsSection } from "../src/store/components/SellLandingSections";
import { SELLER_REVIEWS } from "../src/seo/sellerReviews";
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
    await user.click(screen.getByRole("button", { name: `Show all ${withText} reviews` }));
    expect(screen.getAllByRole("listitem")).toHaveLength(withText);
  });
});
