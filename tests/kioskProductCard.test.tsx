// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import KioskProductCard from "../src/store/components/KioskProductCard";
import type { CatalogCard } from "../src/store/lib/useCatalog";

// The card on the yard sale page and the in-store kiosk looks like the
// shop's own (ProductCard), foil shimmer included.

function card(overrides: Partial<CatalogCard> = {}): CatalogCard {
  return {
    id: "c1", oracleId: null, name: "Sheoldred, the Apocalypse", set: "dmu", setName: "Dominaria United", collectorNumber: "107",
    type: null, rarity: "mythic", quantity: 1, imageUrl: "https://cards.scryfall.io/normal/front/x/c1.jpg", priceCents: 6499,
    condition: "NM", finish: "nonfoil", foil: false, scryfallId: null, isDeal: false, originalPriceCents: null,
    dealDiscountPercent: null, dealSource: null, dealNote: null, variantType: null, ...overrides,
  };
}

afterEach(cleanup);

describe("the kiosk and yard sale card", () => {
  it("shimmers when the card is foil, like the shop's cards", () => {
    const { container } = render(
      <KioskProductCard card={card({ finish: "foil", foil: true })} quantityInList={0} onAdd={() => {}} salePriceCents={5800} />,
    );
    expect(container.querySelector(".gg-card-imgwrap")).toHaveClass("gg-card-imgwrap--foil");
    expect(container.querySelector(".gg-card-foil-shimmer")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("img", { name: "Sheoldred, the Apocalypse, Dominaria United" })).toBeInTheDocument();
  });

  it("doesn't on a non-foil card", () => {
    const { container } = render(<KioskProductCard card={card()} quantityInList={0} onAdd={() => {}} />);
    expect(container.querySelector(".gg-card-imgwrap")).not.toHaveClass("gg-card-imgwrap--foil");
    expect(container.querySelector(".gg-card-foil-shimmer")).toBeNull();
  });

  it("gives etched and other foil finishes the shimmer too", () => {
    const { container } = render(<KioskProductCard card={card({ finish: "etched", foil: true })} quantityInList={0} onAdd={() => {}} />);
    expect(container.querySelector(".gg-card-foil-shimmer")).not.toBeNull();
  });
});
