// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import type { MyConsignment } from "../src/store/lib/consignmentApi";
import type { LotQuantities, LotRecord } from "../src/admin/pages/consignments/consignmentAdminApi";

// The consignor's account shows why a card's proceeds are held (6.4), when
// payment is due, the package's insurance record (5.6), and lets them ask for
// unsold cards back (7.4). Staff start a return with exactly the copies they
// pick, and approve it.

const consignorApi = vi.hoisted(() => ({ loadMyConsignments: vi.fn(), requestReturn: vi.fn(), downloadStatement: vi.fn() }));
vi.mock("../src/store/lib/consignmentApi", async (orig) => ({
  ...(await orig<typeof import("../src/store/lib/consignmentApi")>()),
  ...consignorApi,
  useEstimatorConfig: () => ({ status: "loading" }),
}));
vi.mock("../src/store/lib/router", () => ({ Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a> }));

const adminApi = vi.hoisted(() => ({ requestReturn: vi.fn(), approveReturn: vi.fn(), advanceReturn: vi.fn(), cancelReturn: vi.fn(), closeConsignment: vi.fn() }));
vi.mock("../src/admin/pages/consignments/consignmentAdminApi", async (orig) => ({
  ...(await orig<typeof import("../src/admin/pages/consignments/consignmentAdminApi")>()),
  consignmentAdminApi: adminApi,
}));

const { MyConsignments } = await import("../src/store/components/consignment/MyConsignments");
const { ConsignmentReturnsPanel } = await import("../src/admin/pages/consignments/ConsignmentReturnsPanel");

const consignment: MyConsignment = {
  id: "c1",
  consignmentNumber: 1001,
  status: "active",
  signedAt: "2026-10-01T00:00:00Z",
  termStartedAt: "2026-10-05T00:00:00Z",
  termEndsAt: "2027-01-03T00:00:00Z",
  initialTermDays: 90,
  elections: { channels: { website: true }, additionalInsurance: true },
  agreements: [
    {
      id: "a1",
      status: "signed",
      versionNumber: 1,
      invitedAt: "2026-09-30T00:00:00Z",
      expiresAt: "2026-10-14T00:00:00Z",
      signedAt: "2026-10-01T00:00:00Z",
      agreementSha256: "f".repeat(64),
      hasPdf: true,
      pdfSha256: null,
      terms: { commissionTiers: [], channels: {}, inspectionDays: 3 } as never,
    },
  ],
  cards: [
    {
      id: "lot1", cardName: "Sol Ring", setCode: "cmr", setName: "Commander Legends", collectorNumber: "472", finish: "nonfoil", imageUrl: null,
      status: "listed", quantitySubmitted: 4, quantityAccepted: 3, quantityRejected: 1, declaredCondition: "NM", condition: "NM",
      listPriceCents: 300, minPriceCents: null, rejectionReason: "One proxy", receivedAt: "2026-10-04T00:00:00Z", returnable: { accepted: 2, rejected: 1 },
    },
  ],
  sales: [
    {
      id: "s1", cardName: "Jace", setCode: "wwk", collectorNumber: "31", channel: "website", quantity: 1, unitPriceCents: 20000, grossCents: 20000,
      soldAt: "2026-10-20T12:00:00Z", shippedAt: "2026-10-21T12:00:00Z", deliveredAt: "2026-10-26T20:00:00Z", payableAt: "2026-10-30T05:00:00Z",
      status: "open", cancelReason: null, settlement: null, payoutId: null, payoutDueOn: "2026-10-30",
      holds: [{ reason: "Buyer says the corner is bent", openedAt: "2026-10-27T00:00:00Z", resolvedAt: null, resolution: null }],
      shipment: { carrier: "USPS", service: "GroundAdvantage", declaredValueCents: 20000, includedCoverageCents: 10000, insuredValueCents: 20000, insurancePremiumCents: 455, claim: null },
    },
  ],
  payouts: [],
  adjustments: [],
  returns: [],
};

beforeEach(() => {
  for (const fn of [...Object.values(consignorApi), ...Object.values(adminApi)]) fn.mockReset();
});
afterEach(cleanup);

describe("the consignor's account", () => {
  it("shows a hold and its reason, and the package's insurance", async () => {
    consignorApi.loadMyConsignments.mockResolvedValue([consignment]);
    render(<MyConsignments />);
    expect(await screen.findByText(/On hold: Buyer says the corner is bent/)).toBeInTheDocument();
    // A held card shows no payment date.
    expect(screen.queryByText(/Payment due/)).not.toBeInTheDocument();
    expect(screen.getByText(/insured for \$200\.00 \(\$4\.55\)/)).toBeInTheDocument();
  });

  it("asks for chosen cards back and refreshes", async () => {
    consignorApi.loadMyConsignments.mockResolvedValue([consignment]);
    consignorApi.requestReturn.mockResolvedValue({ ok: true, returnId: "r1" });
    render(<MyConsignments />);
    fireEvent.click(await screen.findByRole("button", { name: "Ask for cards back" }));
    fireEvent.change(screen.getByLabelText(/Unsold \(of 2\)/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(consignorApi.requestReturn).toHaveBeenCalledTimes(1));
    expect(consignorApi.requestReturn.mock.calls[0][0]).toEqual({
      consignmentId: "c1",
      lines: [
        { lotId: "lot1", pool: "accepted", quantity: 1 },
        { lotId: "lot1", pool: "rejected", quantity: 1 },
      ],
      endsConsignment: false,
    });
    await waitFor(() => expect(consignorApi.loadMyConsignments).toHaveBeenCalledTimes(2));
  });
});

describe("ConsignmentReturnsPanel", () => {
  const lots = [{ id: "lot1", card_name: "Sol Ring" }] as LotRecord[];
  const quantities: LotQuantities[] = [{ lot_id: "lot1", accepted: 3, on_sale: 2, pending: 0, sold: 1, unlisted: 0, returning_accepted: 0, rejected: 1, returning_rejected: 0 }];

  it("starts a return with the copies picked", async () => {
    adminApi.requestReturn.mockResolvedValue({ returnId: "r1" });
    render(
      <ToastProvider>
        <ConsignmentReturnsPanel consignmentId="c1" status="active" returns={[]} lots={lots} quantities={quantities} onChanged={vi.fn()} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Return cards" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Unsold copies of Sol Ring to return"), { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start return" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("at most 2 unsold copies");
    fireEvent.change(within(dialog).getByLabelText("Unsold copies of Sol Ring to return"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Declined copies of Sol Ring to return"), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start return" }));
    await waitFor(() => expect(adminApi.requestReturn).toHaveBeenCalledTimes(1));
    expect(adminApi.requestReturn.mock.calls[0][0]).toEqual({ consignmentId: "c1", lines: [{ lotId: "lot1", pool: "accepted", quantity: 2 }], endsConsignment: false, note: "" });
  });

  it("approves a requested return", async () => {
    adminApi.approveReturn.mockResolvedValue({ ok: true });
    const changed = vi.fn();
    render(
      <ToastProvider>
        <ConsignmentReturnsPanel
          consignmentId="c1"
          status="active"
          returns={[
            {
              id: "r1", return_number: 1, requested_by: "consignor", ends_consignment: true, status: "requested", shipping_cost_cents: null, we_pay_shipping: false,
              shipping_paid_at: null, carrier: null, tracking_number: null, insured_value_cents: null, shipped_at: null, delivered_at: null, note: null,
              requested_at: "2026-10-28T00:00:00Z", approved_at: null, cancel_reason: null, lines: [{ id: "l1", lot_id: "lot1", pool: "accepted", quantity: 2 }],
            },
          ]}
          lots={lots}
          quantities={quantities}
          onChanged={changed}
        />
      </ToastProvider>,
    );
    expect(screen.getByText("2 × Sol Ring")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve and take off sale" }));
    await waitFor(() => expect(adminApi.approveReturn).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });
});
