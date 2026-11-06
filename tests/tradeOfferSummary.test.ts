import { describe, expect, it } from "vitest";
import { offerChangeSummary } from "../src/store/lib/tradeCenter";
import { customerCard } from "./helpers/tradeFixtures";

// The final offer's one-line reason (above the card-by-card list): what
// changed between the credit approved before shipping and the final one.

const approved = (over: Parameters<typeof customerCard>[0] = {}) =>
  customerCard({
    reviewStatus: "approved",
    approvedQuantity: 1,
    approvedUnitCents: 8000,
    inspected: true,
    receivedQuantity: 1,
    finalQuantity: 1,
    finalUnitCents: 8000,
    reportedCondition: "NM",
    verifiedCondition: "NM",
    flags: [],
    ...over,
  });

describe("offerChangeSummary", () => {
  it("is null when every card arrived as approved", () => {
    expect(offerChangeSummary([approved({ id: "a" }), approved({ id: "b" })])).toBeNull();
  });

  it("counts the cards graded lower, together, in the customer's words", () => {
    const lp = { verifiedCondition: "LP" as const, finalUnitCents: 7200 };
    expect(offerChangeSummary([approved({ id: "a", ...lp }), approved({ id: "b", ...lp }), approved({ id: "c" })])).toBe(
      "2 cards were graded Lightly Played instead of Near Mint. Each card's reason is below.",
    );
  });

  it("says when cards weren't in the package, couldn't be taken, or were priced differently", () => {
    expect(
      offerChangeSummary([
        approved({ id: "a", approvedQuantity: 3, receivedQuantity: 2, finalQuantity: 2 }),
        approved({ id: "b", finalQuantity: 0, flags: ["counterfeit"] }),
        approved({ id: "c", finalUnitCents: 9000 }),
      ]),
    ).toBe("1 card wasn't in the package. 1 card couldn't be taken. 1 card was priced differently. Each card's reason is below.");
  });
});
