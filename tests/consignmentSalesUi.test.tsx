// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import type { LotRecord, SaleRecord } from "../src/admin/pages/consignments/consignmentAdminApi";

// Admin > Consignments > Sales and payouts: a sale is offered for settlement
// only after its inspection period; the settle dialog shows the proposed
// expenses and the payout before saving, and asks why when staff change a
// proposed figure. A payout covers the settled sales staff tick.

const api = vi.hoisted(() => ({ settlement: vi.fn(), settleSale: vi.fn(), recordPayout: vi.fn(), unsettleSale: vi.fn(), cancelSale: vi.fn(), markSaleDelivered: vi.fn(), voidPayout: vi.fn() }));
vi.mock("../src/admin/pages/consignments/consignmentAdminApi", async (orig) => ({
  ...(await orig<typeof import("../src/admin/pages/consignments/consignmentAdminApi")>()),
  consignmentAdminApi: api,
}));

const { ConsignmentSalesPanel } = await import("../src/admin/pages/consignments/ConsignmentSalesPanel");

const DAY = 86_400_000;
const sale = (over: Partial<SaleRecord>): SaleRecord => ({
  id: "s1",
  lot_id: "lot1",
  channel: "website",
  order_id: "o1",
  external_order_ref: null,
  quantity: 1,
  unit_price_cents: 22500,
  gross_cents: 22500,
  sold_at: new Date(Date.now() - 10 * DAY).toISOString(),
  shipped_at: new Date(Date.now() - 9 * DAY).toISOString(),
  delivered_at: new Date(Date.now() - 5 * DAY).toISOString(),
  payable_at: new Date(Date.now() - 2 * DAY).toISOString(),
  status: "open",
  marketplace_fee_cents: null,
  processing_fee_cents: null,
  postage_cents: null,
  insurance_cents: null,
  other_expense_cents: null,
  other_expense_note: null,
  net_sale_cents: null,
  commission_rate_bps: null,
  commission_cents: null,
  payout_cents: null,
  settled_at: null,
  settled_by: null,
  payout_id: null,
  cancelled_at: null,
  cancel_reason: null,
  restocked: false,
  flag: null,
  notes: null,
  ...over,
});
const lot = { id: "lot1", card_name: "Jace, the Mind Sculptor" } as LotRecord;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(cleanup);

function show(sales: SaleRecord[], onChanged = vi.fn()) {
  render(
    <ToastProvider>
      <ConsignmentSalesPanel consignmentId="c1" sales={sales} payouts={[]} lots={[lot]} onChanged={onChanged} />
    </ToastProvider>,
  );
  return onChanged;
}

describe("ConsignmentSalesPanel", () => {
  it("offers settlement only once the inspection period is over", () => {
    show([sale({ id: "early", payable_at: new Date(Date.now() + DAY).toISOString() }), sale({ id: "ready" })]);
    expect(screen.getAllByRole("button", { name: "Settle" })).toHaveLength(1);
    expect(screen.getByText(/Inspection until/)).toBeInTheDocument();
  });

  it("previews the payout, and asks why a proposed expense was changed", async () => {
    api.settlement.mockResolvedValue({
      saleId: "ready",
      expenses: { marketplaceFeeCents: 0, processingFeeCents: 675, postageCents: 675, insuranceCents: 0, otherExpenseCents: 0 },
      basis: ["Processing: 2.90% + $0.30 on $300.00 charged = $9.00."],
      warnings: [],
      preview: { grossCents: 22500, expensesCents: 1350, netSaleCents: 21150, commissionRateBps: 1000, commissionCents: 2115, payoutCents: 19035 },
    });
    api.settleSale.mockResolvedValue({ payoutCents: 19000 });
    const changed = show([sale({ id: "ready" })]);
    fireEvent.click(screen.getByRole("button", { name: "Settle" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("$190.35")).toBeInTheDocument());

    fireEvent.change(within(dialog).getByLabelText("Postage (after buyer's shipping) ($)"), { target: { value: "7.20" } });
    // $225.00 − $13.95 = $211.05; 10% = $21.11 (half up); payout $189.94.
    expect(within(dialog).getByText("$189.94")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Settle sale" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Say why you changed the proposed expenses");
    expect(api.settleSale).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("Why you changed the proposed expenses"), { target: { value: "Label re-bought" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Settle sale" }));
    await waitFor(() => expect(api.settleSale).toHaveBeenCalledTimes(1));
    expect(api.settleSale.mock.calls[0]).toEqual([
      "ready",
      { marketplaceFeeCents: 0, processingFeeCents: 675, postageCents: 720, insuranceCents: 0, otherExpenseCents: 0 },
      "",
      "Label re-bought",
    ]);
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });

  it("records a payout for the settled sales ticked", async () => {
    api.recordPayout.mockResolvedValue({ payoutId: "p1" });
    show([sale({ id: "a", status: "settled", payout_cents: 19035, settled_at: "2026-10-27T00:00:00Z" }), sale({ id: "b", status: "settled", payout_cents: 1000, settled_at: "2026-10-27T00:00:00Z" })]);
    fireEvent.click(screen.getByRole("button", { name: "Record a payout" }));
    const dialog = await screen.findByRole("dialog");
    const boxes = within(dialog).getAllByRole("checkbox");
    fireEvent.click(boxes[1]);
    fireEvent.change(within(dialog).getByLabelText("Reference"), { target: { value: "PP-9" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record $190.35 payout" }));
    await waitFor(() => expect(api.recordPayout).toHaveBeenCalledTimes(1));
    expect(api.recordPayout.mock.calls[0][0]).toMatchObject({ consignmentId: "c1", saleIds: ["a"], method: "paypal", reference: "PP-9" });
  });
});
