// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import type { LotRecord } from "../src/admin/pages/consignments/consignmentAdminApi";

// Admin > Consignments > a consignment > Cards: pasting a CSV adds lines;
// nothing can be received until the lines are checked and every one matches,
// and any edit after checking needs a fresh check; inspection sends exactly
// the grade, count and prices entered, and a partial acceptance needs a
// reason the consignor will see.

const api = vi.hoisted(() => ({ previewReceive: vi.fn(), receiveCards: vi.fn(), inspectLot: vi.fn() }));
vi.mock("../src/admin/pages/consignments/consignmentAdminApi", async (orig) => ({
  ...(await orig<typeof import("../src/admin/pages/consignments/consignmentAdminApi")>()),
  consignmentAdminApi: api,
}));
vi.mock("../src/admin/components/cards/ScryfallSearch", () => ({ ScryfallSearch: () => <div>search</div> }));

const { ReceiveCardsPanel } = await import("../src/admin/pages/consignments/ReceiveCardsPanel");
const { ConsignmentLotsPanel } = await import("../src/admin/pages/consignments/ConsignmentLotsPanel");

const resolved = (index: number, ok: boolean, problems: string[] = []) => ({
  index,
  sourceRow: index + 2,
  ok,
  problems,
  printing: ok
    ? { scryfallId: `id-${index}`, oracleId: null, cardName: index ? "Arcane Signet" : "Sol Ring", setCode: "cmr", setName: "Commander Legends", collectorNumber: index ? "297" : "472", rarity: "uncommon", imageUrl: null, language: "en", finishes: ["nonfoil", "foil"] }
    : null,
  finish: "nonfoil",
  declaredCondition: null,
  quantity: 1,
  marketPriceCents: 100,
  listPriceCents: null,
  minPriceCents: null,
  notes: null,
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(cleanup);

describe("ReceiveCardsPanel", () => {
  function paste() {
    render(
      <ToastProvider>
        <ReceiveCardsPanel consignmentId="c1" onReceived={vi.fn()} onCancel={vi.fn()} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "CSV upload or paste" }));
    fireEvent.change(screen.getByLabelText(/Or paste rows/), {
      target: { value: "Name,Set,Collector Number,Quantity,List Price\nSol Ring,CMR,472,2,3.50\nArcane Signet,CMR,297,1,4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add pasted rows" }));
  }

  it("won't receive until every line is checked and matched", async () => {
    paste();
    const receive = screen.getByRole("button", { name: "Receive 3 copies" });
    expect(receive).toBeDisabled();

    api.previewReceive.mockResolvedValueOnce({ ok: false, copies: 3, lines: [resolved(0, true), resolved(1, false, ["No printing CMR #297."])] });
    fireEvent.click(screen.getByRole("button", { name: "Check cards" }));
    expect(await screen.findByText("No printing CMR #297.")).toBeInTheDocument();
    expect(receive).toBeDisabled();
    expect(api.previewReceive.mock.calls[0][0]).toMatchObject([
      { name: "Sol Ring", setCode: "CMR", collectorNumber: "472", quantity: 2, listPriceCents: 350, sourceRow: 2 },
      { name: "Arcane Signet", quantity: 1, listPriceCents: 400, sourceRow: 3 },
    ]);

    api.previewReceive.mockResolvedValueOnce({ ok: true, copies: 3, lines: [resolved(0, true), resolved(1, true)] });
    fireEvent.click(screen.getByRole("button", { name: "Check cards" }));
    await waitFor(() => expect(receive).toBeEnabled());

    // Any change after checking needs a new check.
    fireEvent.change(screen.getByLabelText("Quantity for Sol Ring CMR #472"), { target: { value: "3" } });
    expect(screen.getByRole("button", { name: "Receive 4 copies" })).toBeDisabled();
  });

  it("sends the lines and how they arrived", async () => {
    paste();
    api.previewReceive.mockResolvedValue({ ok: true, copies: 3, lines: [resolved(0, true), resolved(1, true)] });
    api.receiveCards.mockResolvedValue({ batchId: "b1", lines: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Check cards" }));
    const receive = screen.getByRole("button", { name: "Receive 3 copies" });
    await waitFor(() => expect(receive).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Tracking number"), { target: { value: "9400" } });
    fireEvent.click(receive);
    await waitFor(() => expect(api.receiveCards).toHaveBeenCalledTimes(1));
    const [id, lines, shipment] = api.receiveCards.mock.calls[0];
    expect(id).toBe("c1");
    expect(lines).toHaveLength(2);
    expect(shipment).toMatchObject({ method: "mail", trackingNumber: "9400" });
  });
});

describe("ConsignmentLotsPanel", () => {
  const lot: LotRecord = {
    id: "lot1",
    batch_id: "b1",
    scryfall_id: "s1",
    card_name: "Sol Ring",
    set_code: "cmr",
    set_name: "Commander Legends",
    collector_number: "472",
    rarity: "uncommon",
    image_url: null,
    language: "en",
    finish: "nonfoil",
    declared_condition: "NM",
    condition: null,
    quantity_submitted: 3,
    quantity_accepted: 0,
    quantity_rejected: 0,
    market_price_cents: 125,
    list_price_cents: 150,
    min_price_cents: null,
    rejection_reason: null,
    internal_notes: null,
    status: "under_inspection",
    inspected_at: null,
    inspected_by: null,
    decided_at: null,
    decided_by: null,
  };
  const batch = { id: "b1", batch_number: 1, received_at: "2026-10-28T12:00:00Z", method: "mail" as const, carrier: "USPS", tracking_number: null, notes: null, created_by: "helper@x.com" };

  it("needs a reason for a partial acceptance, then sends exactly what was entered", async () => {
    const changed = vi.fn();
    api.inspectLot.mockResolvedValue({ status: "accepted" });
    render(
      <ToastProvider>
        <ConsignmentLotsPanel batches={[batch]} lots={[lot]} events={[]} onChanged={changed} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Copies accepted"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Graded condition"), { target: { value: "LP" } });
    fireEvent.change(within(dialog).getByLabelText("Consignor's minimum ($)"), { target: { value: "1.00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Say why the other copies aren't accepted");
    expect(api.inspectLot).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Why the other copies/), { target: { value: "One was a proxy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(api.inspectLot).toHaveBeenCalledTimes(1));
    expect(api.inspectLot.mock.calls[0]).toEqual([
      "lot1",
      { step: "accept", quantityAccepted: 2, condition: "LP", finish: "nonfoil", listPriceCents: 150, minPriceCents: 100, reason: "One was a proxy", allowBelowMinimum: false },
    ]);
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });
});
