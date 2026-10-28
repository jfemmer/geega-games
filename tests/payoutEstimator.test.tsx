// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PayoutEstimator } from "../src/store/components/consignment/PayoutEstimator";
import { parseEstimatorConfig, type EstimatorConfig } from "../src/store/lib/consignmentApi";
import { ESTIMATE_DISCLAIMER, ESTIMATE_FOOTNOTE } from "../src/store/lib/consignmentMath";

// The Consignment Payout Estimator: the disclaimer is always on screen above
// the calculator, results update as inputs change, a signed consignor only
// sees the channels they approved, and their insurance election is shown but
// never changed.

const config = parseEstimatorConfig({
  asOf: "2026-10-28T16:00:00Z",
  channels: {
    website: {
      effectiveFrom: "2026-10-01T05:00:00Z",
      marketplaceBps: 0,
      marketplaceThresholdCents: null,
      marketplaceAboveThresholdBps: null,
      marketplaceBase: "item",
      perOrderCents: 0,
      perOrderSmallCents: null,
      perOrderSmallMaxCents: null,
      processingBps: 290,
      processingFixedCents: 30,
      processingBase: "item_shipping_tax",
    },
    tcgplayer: {
      effectiveFrom: "2026-10-01T05:00:00Z",
      marketplaceBps: 1075,
      marketplaceThresholdCents: null,
      marketplaceAboveThresholdBps: null,
      marketplaceBase: "item_shipping",
      perOrderCents: 0,
      perOrderSmallCents: null,
      perOrderSmallMaxCents: null,
      processingBps: 250,
      processingFixedCents: 30,
      processingBase: "item_shipping_tax",
    },
    ebay: {
      effectiveFrom: "2026-10-01T05:00:00Z",
      marketplaceBps: 1325,
      marketplaceThresholdCents: 750000,
      marketplaceAboveThresholdBps: 235,
      marketplaceBase: "item_shipping_tax",
      perOrderCents: 40,
      perOrderSmallCents: 30,
      perOrderSmallMaxCents: 1000,
      processingBps: 0,
      processingFixedCents: 0,
      processingBase: "item_shipping_tax",
    },
  },
  insurance: {
    effectiveFrom: "2026-10-04T05:00:00Z",
    service: "USPS Ground Advantage",
    includedCoverageCents: 10000,
    brackets: [
      { maxValueCents: 10000, premiumCents: 0 },
      { maxValueCents: 20000, premiumCents: 450 },
      { maxValueCents: 60000, premiumCents: 905 },
    ],
    stepCents: 10000,
    stepPremiumCents: 150,
    maxInsurableCents: 500000,
    sourceUrl: "https://pe.usps.com/text/dmm300/Notice123.htm",
  },
  commission: { effectiveFrom: "2026-10-01T05:00:00Z", tiers: [{ maxPriceCents: 15000, rateBps: 2000 }, { maxPriceCents: null, rateBps: 1000 }] },
  settings: {
    defaultPostageCents: 500,
    buyerTerms: {
      website: { shippingCents: 550, freeShippingAtCents: 7500, salesTaxBps: 0 },
      tcgplayer: { shippingCents: 0, freeShippingAtCents: null, salesTaxBps: 700 },
      ebay: { shippingCents: 0, freeShippingAtCents: null, salesTaxBps: 700 },
    },
    estimatorInsuranceDefault: false,
    inspectionDays: 3,
    initialTermDays: 90,
  },
}) as EstimatorConfig;

const payout = () => screen.getByText("Estimated Consignor Payout").parentElement!.querySelector(".gg-pe-total__value")!.textContent;

describe("PayoutEstimator", () => {
  afterEach(cleanup);

  it("parses the database's rates", () => {
    expect(config).not.toBeNull();
    expect(Object.keys(config.channels)).toEqual(["website", "tcgplayer", "ebay"]);
  });

  it("always shows the disclaimer above the calculator, and the footnote under the payout", () => {
    const { container } = render(<PayoutEstimator config={config} />);
    const disclaimer = screen.getByText(ESTIMATE_DISCLAIMER);
    expect(disclaimer).toBeVisible();
    expect(container.querySelector(".gg-pe")!.firstElementChild).toBe(disclaimer);
    expect(screen.getByText(ESTIMATE_FOOTNOTE)).toBeVisible();
  });

  it("estimates a $200 website sale and updates as the price changes", () => {
    render(<PayoutEstimator config={config} />);
    // $200 - $6.10 processing - $5.00 postage = $188.90; 10% commission → $170.01
    expect(payout()).toBe("$170.01");
    fireEvent.change(screen.getByLabelText("Estimated card sale price"), { target: { value: "150.00" } });
    // $150 - $4.65 - $5.00 = $140.35; 20% → $28.07; payout $112.28
    expect(payout()).toBe("$112.28");
    fireEvent.change(screen.getByLabelText("Estimated card sale price"), { target: { value: "150.01" } });
    expect(screen.getByText(/Geega Games commission \(10%\)/)).toBeInTheDocument();
  });

  it("adds the insurance premium when switched on, and compares both", () => {
    render(<PayoutEstimator config={config} />);
    const insurance = screen.getByRole("group", { name: "Additional shipping insurance" });
    fireEvent.click(within(insurance).getByLabelText("Yes"));
    // $188.90 - $4.50 = $184.40; commission $18.44 → $165.96
    expect(payout()).toBe("$165.96");
    expect(screen.getByText(/lowers your estimated payout by about/)).toHaveTextContent("$4.05");
  });

  it("only offers the channels a signed consignor approved, and shows their election without changing it", () => {
    render(<PayoutEstimator config={config} allowedChannels={["website", "ebay"]} insuranceElection={false} />);
    const channels = screen.getByRole("group", { name: "Sales channel" });
    expect(within(channels).queryByLabelText("TCGplayer")).toBeNull();
    expect(within(channels).getByLabelText("eBay")).toBeInTheDocument();
    expect(screen.getByText(/Your signed election: additional insurance declined/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Compare sales channels" })).toBeInTheDocument();
  });

  it("labels the default postage as an estimate, not a USPS quote", () => {
    render(<PayoutEstimator config={config} />);
    expect(screen.getByText(/An estimate, not a USPS quote/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Estimated outbound postage"), { target: { value: "4.10" } });
    expect(screen.getByRole("button", { name: /Use the typical \$5.00/ })).toBeInTheDocument();
  });

  it("asks for a price instead of estimating nonsense", () => {
    render(<PayoutEstimator config={config} />);
    fireEvent.change(screen.getByLabelText("Estimated card sale price"), { target: { value: "abc" } });
    expect(screen.getByText("Enter a sale price and postage to see an estimate.")).toBeInTheDocument();
    expect(screen.getByText(ESTIMATE_DISCLAIMER)).toBeVisible();
  });
});
