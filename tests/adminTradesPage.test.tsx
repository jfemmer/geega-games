// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import { NAV_ITEMS, SECTION_TITLES } from "../src/admin/components/layout/nav";
import { NAV_BADGES } from "../src/admin/utils/navBadges";
import type { StaffTrade, TradeSettings } from "../src/store/lib/tradeCenter";
import {
  TRADE_ID,
  TRADE_SETTINGS,
  privileges,
  record,
  shipment,
  staffCard,
  staffDeposit,
  staffTrade,
  tradeSummary,
  wantedItem,
} from "./helpers/tradeFixtures";

// Admin → Trades: the list of online trades, each trade's drawer at every
// step (review and approval with the deposit, waiting for confirmation, the
// shipment and its scans, proof of shipping, the deposit, inspection and the
// final offer, payment, wrapping up, an expired reservation), the Deposits,
// Reserved, Customers and Economics tabs, and the trade settings. The repository is a
// stand-in: these tests are about what staff see and exactly what each
// button sends.

const repo = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
  reserved: vi.fn(),
  customers: vi.fn(),
  deposits: vi.fn(),
  economics: vi.fn(),
  setCustomerFlags: vi.fn(),
  review: vi.fn(),
  requestRevision: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  setDeposit: vi.fn(),
  extend: vi.fn(),
  verifyShipment: vi.fn(),
  markReceived: vi.fn(),
  cardsArrived: vi.fn(),
  reinstate: vi.fn(),
  expireNow: vi.fn(),
  cancelByStore: vi.fn(),
  refundDeposit: vi.fn(),
  forfeitDeposit: vi.fn(),
  retryRefund: vi.fn(),
  resolveDispute: vi.fn(),
  clearFault: vi.fn(),
  inspect: vi.fn(),
  confirmAsDescribed: vi.fn(),
  sendFinalOffer: vi.fn(),
  reopenInspection: vi.fn(),
  setWanted: vi.fn(),
  markReturned: vi.fn(),
  importCard: vi.fn(),
  recordPayment: vi.fn(),
  markCashPaid: vi.fn(),
  setPostage: vi.fn(),
  message: vi.fn(),
  setMeetup: vi.fn(),
  completeLocal: vi.fn(),
  saveMeetupDraft: vi.fn(),
}));
vi.mock("../src/admin/repositories/tradeCenter.supabase", () => ({ tradeCenterRepository: repo }));

const { TradesPage } = await import("../src/admin/pages/trades/TradesPage");

const navigate = vi.fn();
const renderPage = (query = "") =>
  render(
    <ToastProvider>
      <TradesPage query={new URLSearchParams(query)} onNavigate={navigate} />
    </ToastProvider>,
  );

/** Opens a trade from a link (as staff alerts do) with the drawer showing `trade`. */
async function openTrade(trade: StaffTrade, { owner = true, settings = TRADE_SETTINGS }: { owner?: boolean; settings?: TradeSettings } = {}) {
  repo.get.mockResolvedValue({ trade, settings, owner });
  renderPage(`trade=${trade.id}`);
  const dialog = await screen.findByRole("dialog", { name: /Trade TR.1001/ });
  await within(dialog).findByRole("heading", { name: "Customer" });
  return dialog;
}

/** Every change answers with the trade as it now stands. */
const answer = (trade: StaffTrade, owner = true) => ({ trade, settings: TRADE_SETTINGS, owner });

const REVIEW = staffTrade({
  offered: [
    staffCard({ id: "o1", quantity: 1, customerNote: "Sleeved since opening" }),
    staffCard({ id: "o2", cardName: "Ragavan, Nimble Pilferer", setCode: "MH2", collectorNumber: "138", reportedCondition: "LP", referencePriceCents: 5200, conditionPercent: 90, estimatedUnitCents: 4680, quantity: 2 }),
    staffCard({ id: "o4", cardName: "Mox Diamond", setCode: "STH", collectorNumber: "138", finish: "foil", quantity: 1, referencePriceCents: null, estimatedUnitCents: null, eligibility: "needs_review", customerEstimateCents: 45000 }),
  ],
});

const APPROVED = [
  staffCard({ id: "o1", quantity: 1, reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 8000 }),
  staffCard({ id: "o2", cardName: "Ragavan, Nimble Pilferer", setCode: "MH2", collectorNumber: "138", reportedCondition: "LP", referencePriceCents: 5200, conditionPercent: 90, estimatedUnitCents: 4680, quantity: 2, reviewStatus: "approved", approvedQuantity: 2, approvedUnitCents: 4680 }),
  staffCard({ id: "o4", cardName: "Mox Diamond", setCode: "STH", collectorNumber: "138", finish: "foil", quantity: 1, reviewStatus: "rejected", approvedQuantity: 0 }),
];

beforeEach(() => {
  for (const fn of Object.values(repo)) fn.mockReset();
  navigate.mockReset();
  repo.list.mockResolvedValue({
    trades: [
      tradeSummary(),
      tradeSummary({
        id: "t-2",
        tradeNumber: 998,
        status: "in_transit",
        customerName: "Bo Diaz",
        approvedValueCents: 21500,
        inboundAcceptedAt: "2026-10-23T12:00:00Z",
        depositStatus: "refund_pending",
        depositCents: 2000,
        depositPaidCents: 2000,
        needsStaff: false,
      }),
      tradeSummary({ id: "t-3", tradeNumber: 997, status: "tracking_submitted", customerName: "Cy Ho", reviewFlag: "late_acceptance", depositStatus: "paid", depositCents: 2000, depositPaidCents: 2000 }),
    ],
    counts: { waiting: 1, open: 2, all: 9, pending_review: 1, in_transit: 1 },
    settings: TRADE_SETTINGS,
    owner: true,
  });
  repo.settings.mockResolvedValue({ settings: TRADE_SETTINGS, owner: true });
});

afterEach(() => {
  cleanup();
});

describe("the list", () => {
  it("shows what's waiting on staff and whether trading is open, and filters and searches on the server", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("TR-1001")).toBeInTheDocument();
    expect(repo.list).toHaveBeenLastCalledWith("waiting", "", null);
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Trading is open: 80% store credit on cards worth $15.00 or more.");
    const row = screen.getByText("TR-1001").closest("tr")!;
    expect(row).toHaveTextContent("Ann Lee");
    expect(row).toHaveTextContent("$160.00estimate");
    expect(within(row).getAllByText("To review").length).toBeGreaterThan(0);
    // The deposit, and why a trade is waiting on staff besides its status.
    const bo = screen.getByText("TR-998").closest("tr")!;
    expect(bo).toHaveTextContent("Refund pending$20.00");
    expect(bo).toHaveTextContent("Shipped");
    const cy = screen.getByText("TR-997").closest("tr")!;
    expect(cy).toHaveTextContent("Late first scan: decide");

    await user.click(screen.getByRole("tab", { name: /^Open/ }));
    await waitFor(() => expect(repo.list).toHaveBeenLastCalledWith("open", "", null));
    await user.type(screen.getByLabelText("Search trades"), "ann");
    await waitFor(() => expect(repo.list).toHaveBeenLastCalledWith("open", "ann", null));
    await user.selectOptions(screen.getByLabelText("Status"), "in_transit");
    await waitFor(() => expect(repo.list).toHaveBeenLastCalledWith("in_transit", "ann", null));
    await user.selectOptions(screen.getByLabelText("Deposit"), "forfeiture_review");
    await waitFor(() => expect(repo.list).toHaveBeenLastCalledWith("in_transit", "ann", "forfeiture_review"));
    await user.click(screen.getByRole("tab", { name: /^Abandoned/ }));
    await waitFor(() => expect(repo.list).toHaveBeenLastCalledWith("abandoned", "ann", "forfeiture_review"));
  });

  it("says when trading is paused or off, and when it isn't set up at all", async () => {
    repo.list.mockResolvedValueOnce({ trades: [], counts: { waiting: 0, open: 0, all: 0 }, settings: { ...TRADE_SETTINGS, paused: true }, owner: true });
    renderPage();
    expect(await screen.findByText(/New trades are paused\./)).toBeInTheDocument();
    expect(screen.getByText("Nothing is waiting on you")).toBeInTheDocument();
    cleanup();

    repo.list.mockRejectedValueOnce(new Error("Trade settings aren't set up yet. Run the Trade Center database update first."));
    renderPage();
    expect(await screen.findByText("Trade settings aren't set up yet. Run the Trade Center database update first.")).toBeInTheDocument();
  });

  it("is in the admin menu after the Trade Evaluator, with its own badge", () => {
    const keys = NAV_ITEMS.map((item) => item.key);
    expect(keys.indexOf("trades")).toBe(keys.indexOf("trade-evaluator") + 1);
    expect(NAV_ITEMS.find((item) => item.key === "trades")).toMatchObject({ label: "Trades", path: "/admin_dashboard/trades" });
    expect(SECTION_TITLES.trades).toBe("Trades");
    expect(NAV_BADGES.trades?.count).toBe("trades_waiting");
  });
});

describe("review", () => {
  it("prices every card at the TCG low staff type, then saves the review and approves in one go", async () => {
    const user = userEvent.setup();
    const dialog = await openTrade(REVIEW);
    expect(within(dialog).getByText("Approve or reject every card first (3 left).")).toBeInTheDocument();
    const approve = within(dialog).getByRole("button", { name: "Approve and email the customer" });
    expect(approve).toBeDisabled();

    // Each card links to TCGplayer to look up its TCG low; the market estimate is there for reference.
    const sheoldred = within(dialog).getByText("Sheoldred, the Apocalypse").closest("li")!;
    const lookup = within(sheoldred).getByRole("link", { name: /Look up TCG low/ });
    expect(lookup).toHaveAttribute(
      "href",
      "https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=Sheoldred%2C%20the%20Apocalypse&view=grid",
    );
    expect(lookup).toHaveAttribute("target", "_blank");
    expect(within(sheoldred).getByText(/Market estimate \$80\.00 × 100% = \$80\.00 each/)).toBeInTheDocument();

    // Approving a card leaves its value empty: staff type its TCG low, nothing comes from the estimate.
    await user.click(within(within(dialog).getByRole("group", { name: "Decision for Sheoldred, the Apocalypse" })).getByRole("button", { name: "Approve" }));
    expect(within(dialog).getByLabelText("TCG low each for Sheoldred, the Apocalypse")).toHaveValue("");

    // Ragavan at its market estimate in one go; the Mox has no market price, so it's left to decide.
    await user.click(within(dialog).getByRole("button", { name: "Approve the rest at market estimates" }));
    expect(within(dialog).getByText("Approve or reject every card first (1 left).")).toBeInTheDocument();
    await user.click(within(within(dialog).getByRole("group", { name: "Decision for Mox Diamond" })).getByRole("button", { name: "Approve" }));
    expect(within(dialog).getByText("Enter the TCG low for each card you approve (2 left).")).toBeInTheDocument();
    expect(approve).toBeDisabled();
    await user.type(within(dialog).getByLabelText("TCG low each for Sheoldred, the Apocalypse"), "76.50");
    expect(within(dialog).getByText("Enter the TCG low for each card you approve (1 left).")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("TCG low each for Mox Diamond"), "380");
    expect(within(dialog).queryByText(/Enter the TCG low for each card you approve/)).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("How many Ragavan, Nimble Pilferer to approve"), "1");
    // $76.50 + $46.80 + $380 approved → $402.64 credit, more than our $88.99 of cards (which take $111.24
    // of theirs at 80%); shipping our cards, $3.99, is paid by card, not out of the credit.
    const preview = within(dialog).getByText("Approved value").closest("dl")!;
    expect(within(preview).getByText("Approved value").nextElementSibling).toHaveTextContent("$503.30");
    expect(within(preview).getByText("Their cards needed to cover ours at 80%").nextElementSibling).toHaveTextContent("$111.24");
    expect(within(preview).getByText("Shipping our cards (paid by card, not credit)").nextElementSibling).toHaveTextContent("$3.99");
    expect(within(preview).getByText("They would pay by card").nextElementSibling).toHaveTextContent("$3.99");
    expect(within(preview).getByText("Credit left over").nextElementSibling).toHaveTextContent("$313.65");
    expect(approve).toBeEnabled();

    // The customer gets the confirmation window (Sundays don't count); nothing is reserved yet; no deposit on $88.99.
    expect(within(dialog).getByText(/to confirm \(48 hours; Sundays don’t count\)\. Nothing is reserved until they confirm\./)).toBeInTheDocument();
    expect(within(dialog).getByText("No deposit on this trade.")).toBeInTheDocument();

    repo.review.mockResolvedValue(answer(REVIEW));
    repo.approve.mockResolvedValue({
      ...answer(staffTrade({ status: "awaiting_confirmation", offered: APPROVED, approvedAt: "2026-10-25T12:00:00Z", confirmBy: "2099-10-27T19:00:00Z", needsStaff: false })),
      customerEmail: { status: "sent" },
    });
    await user.type(within(dialog).getByLabelText("Conditions (optional)"), "Mox must be the Stronghold printing");
    await user.click(within(dialog).getByRole("button", { name: "Save the review and approve" }));
    await waitFor(() => expect(repo.approve).toHaveBeenCalled());
    expect(repo.review).toHaveBeenCalledWith(TRADE_ID, [
      { id: "o1", reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 7650, reviewNote: null, internalNote: null },
      { id: "o2", reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 4680, reviewNote: null, internalNote: null },
      { id: "o4", reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 38000, reviewNote: null, internalNote: null },
    ]);
    // The deadline and the deposit are the server's: only a changed deposit setting is sent.
    expect(repo.approve).toHaveBeenCalledWith(TRADE_ID, { conditions: "Mox must be the Stronghold printing" });
    expect(await screen.findByText("Approved: waiting for the customer to confirm. The customer was emailed.")).toBeInTheDocument();
    const after = screen.getByRole("dialog");
    expect(within(after).getByRole("heading", { name: "Waiting for the customer to confirm" })).toBeInTheDocument();
    expect(within(after).getByText(/Confirm by:/).parentElement).toHaveTextContent("left");
  });

  it("previews and overrides the deposit when approving", async () => {
    const user = userEvent.setup();
    const big = staffTrade({ wantedTotalCents: 32000, offered: APPROVED });
    const dialog = await openTrade(big);
    expect(within(dialog).getByText(/\$20\.00: our cards are worth more than the deposit threshold/)).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("Deposit"), "waived");
    expect(within(dialog).getByText("No deposit on this trade.")).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("Deposit"), "required");
    repo.approve.mockResolvedValue(answer(staffTrade({ status: "awaiting_confirmation", offered: APPROVED })));
    await user.click(within(dialog).getByRole("button", { name: "Approve and email the customer" }));
    await waitFor(() => expect(repo.approve).toHaveBeenCalledWith(TRADE_ID, { conditions: "", depositOverride: "required" }));
  });

  it("won't approve while one of our cards has sold short", async () => {
    const short = staffTrade({ offered: APPROVED, wanted: [wantedItem({ status: "requested", available: 0 })] });
    const dialog = await openTrade(short);
    expect(within(dialog).getByText(/Some of our cards sold since the customer picked them \(The One Ring\)/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Approve and email the customer" })).toBeDisabled();
    expect(within(dialog).getByText("Sold out since it was added")).toBeInTheDocument();
  });

  it("won't approve before the mailing address is set", async () => {
    const dialog = await openTrade(staffTrade({ offered: APPROVED }), { settings: { ...TRADE_SETTINGS, shipTo: null } });
    expect(within(dialog).getByText("Add the address customers mail their cards to (Settings) before approving.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Approve and email the customer" })).toBeDisabled();
  });

  it("asks for changes or rejects, each with words for the customer", async () => {
    const user = userEvent.setup();
    const dialog = await openTrade(REVIEW);
    await user.click(within(dialog).getByRole("button", { name: "Ask for changes" }));
    const sendBack = within(dialog).getByRole("button", { name: "Send it back to the customer" });
    expect(sendBack).toBeDisabled();
    repo.requestRevision.mockResolvedValue(answer(staffTrade({ status: "revision_requested", offered: REVIEW.offered })));
    await user.type(within(dialog).getByLabelText("What should they change?"), "Is the Mox the foil?");
    await user.click(sendBack);
    await waitFor(() => expect(repo.requestRevision).toHaveBeenCalledWith(TRADE_ID, "Is the Mox the foil?"));
    expect(repo.review).not.toHaveBeenCalled();
    cleanup();

    const again = await openTrade(REVIEW);
    await user.click(within(within(again).getByRole("group", { name: "What to do with this trade" })).getByRole("button", { name: "Reject" }));
    repo.reject.mockResolvedValue(answer(staffTrade({ status: "rejected", offered: REVIEW.offered, closeReason: "Mostly bulk" })));
    await user.type(within(again).getByLabelText("Reason for the customer"), "Mostly bulk");
    await user.click(within(again).getByRole("button", { name: "Reject the trade" }));
    await waitFor(() => expect(repo.reject).toHaveBeenCalledWith(TRADE_ID, "Mostly bulk"));
  });
});

describe("receiving, inspection and the final offer", () => {
  const INSPECTING = staffTrade({ status: "under_inspection", approvedValueCents: 17360, receivedAt: "2026-10-25T12:00:00Z", offered: APPROVED });

  it("marks the package received", async () => {
    const user = userEvent.setup();
    const dialog = await openTrade(
      staffTrade({
        status: "in_transit",
        offered: APPROVED,
        shipment: shipment({ carrier: "USPS", tracking: "9400111899223197428490", acceptedAt: "2026-10-24T15:00:00Z", acceptanceSource: "carrier", shippedOnTime: true }),
      }),
    );
    expect(within(dialog).getByRole("link", { name: "9400111899223197428490" })).toHaveAttribute("href", expect.stringContaining("usps.com"));
    expect(within(dialog).getByText(/Carrier accepted it/).parentElement).toHaveTextContent("carrier scan · on time");
    repo.markReceived.mockResolvedValue({ ...answer(INSPECTING), customerEmail: { status: "failed" } });
    await user.click(within(dialog).getByRole("button", { name: "Mark the package received" }));
    await waitFor(() => expect(repo.markReceived).toHaveBeenCalledWith(TRADE_ID));
    expect(await screen.findByText("Marked received. The email to the customer didn't go out: let them know another way.")).toBeInTheDocument();
    expect(await within(screen.getByRole("dialog")).findByText("Inspect their cards")).toBeInTheDocument();
  });

  it("rescales a worse condition, saves only what changed, and confirms the rest", async () => {
    const user = userEvent.setup();
    const dialog = await openTrade(INSPECTING);
    expect(within(dialog).getByRole("button", { name: "Send the final offer" })).toBeDisabled();
    expect(within(dialog).getByText("Inspect the other 2 cards, or confirm them as approved.")).toBeInTheDocument();

    const ragavan = within(dialog).getByText("Ragavan, Nimble Pilferer").closest("li")!;
    await user.selectOptions(within(ragavan).getByLabelText("Condition"), "MP");
    expect(within(ragavan).getByLabelText("TCG low each")).toHaveValue("39.00"); // $46.80 at 75/90, to type over
    expect(within(ragavan).getByRole("link", { name: /Look up TCG low/ })).toHaveAttribute("href", expect.stringContaining("q=Ragavan%2C%20Nimble%20Pilferer"));
    await user.selectOptions(within(ragavan).getByLabelText("Arrived"), "1");
    expect(within(ragavan).getByLabelText("Taking")).toHaveValue("1");

    const ragavanDone = { ...APPROVED[1], inspected: true, receivedQuantity: 1, authenticity: "authentic" as const, verifiedCondition: "MP" as const, finalQuantity: 1, finalUnitCents: 3900 };
    repo.inspect.mockResolvedValue(answer({ ...INSPECTING, offered: [APPROVED[0], ragavanDone, APPROVED[2]] }));
    await user.click(within(dialog).getByRole("button", { name: "Save the inspection" }));
    await waitFor(() => expect(repo.inspect).toHaveBeenCalled());
    expect(repo.inspect).toHaveBeenCalledWith(TRADE_ID, [
      {
        id: "o2",
        receivedQuantity: 1,
        authenticity: "authentic",
        verifiedCondition: "MP",
        finalQuantity: 1,
        finalUnitCents: 3900,
        flags: [],
        inspectionNote: null,
        inspectionInternalNote: null,
      },
    ]);

    const sheoldredDone = { ...APPROVED[0], inspected: true, receivedQuantity: 1, authenticity: "authentic" as const, verifiedCondition: "NM" as const, finalQuantity: 1, finalUnitCents: 8000 };
    repo.confirmAsDescribed.mockResolvedValue(answer({ ...INSPECTING, offered: [sheoldredDone, ragavanDone, APPROVED[2]] }));
    await user.click(await within(dialog).findByRole("button", { name: "The other card arrived as approved" }));
    await waitFor(() => expect(repo.confirmAsDescribed).toHaveBeenCalledWith(TRADE_ID));

    // $80 + $39 = $119 of cards → $95.20 credit, against $88.99 of ours: $6.21 left over, and
    // $3.99 shipping paid by card.
    const final = within(dialog).getByText("Final offer").closest("div")!;
    await waitFor(() => expect(within(final).getByText("Credit left over").nextElementSibling).toHaveTextContent("$6.21"));
    expect(within(final).getByText("Trade credit at 80%").nextElementSibling).toHaveTextContent("$95.20");
    expect(within(final).getByText("They pay by card").nextElementSibling).toHaveTextContent("$3.99");
    // Cash instead: $6.21 of credit at 60/80 → $4.66.
    await user.click(within(final).getByLabelText(/Offer \$4\.66 cash for the credit left over instead/));
    repo.sendFinalOffer.mockResolvedValue(answer({ ...INSPECTING, status: "awaiting_final_approval", finalValueCents: 11900, finalCreditCents: 9520, offered: [sheoldredDone, ragavanDone, APPROVED[2]] }));
    await user.click(within(final).getByRole("button", { name: "Send the final offer" }));
    await waitFor(() => expect(repo.sendFinalOffer).toHaveBeenCalledWith(TRADE_ID, true));
  });

  it("won't take a counterfeit", async () => {
    const user = userEvent.setup();
    const dialog = await openTrade(INSPECTING);
    const sheoldred = within(dialog).getByText("Sheoldred, the Apocalypse").closest("li")!;
    await user.selectOptions(within(sheoldred).getByLabelText("Authentic?"), "counterfeit");
    expect(within(sheoldred).getByLabelText("Taking")).toHaveValue("0");
    expect(within(sheoldred).getByLabelText("Taking")).toBeDisabled();
    expect(within(sheoldred).getByLabelText("Counterfeit")).toBeChecked();
  });

  it("shows an adjustment the customer asked for and takes the offer back", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      status: "awaiting_final_approval",
      finalOfferAt: "2026-10-25T12:00:00Z",
      finalValueCents: 11900,
      finalCreditCents: 9520,
      offered: APPROVED,
      messages: [{ id: "m1", authorType: "customer", authorLabel: null, body: "Could you look at the Sheoldred again?", createdAt: "2026-10-25T13:00:00Z", visibleToCustomer: true }],
      events: [{ id: "e1", actorType: "customer", actorLabel: null, event: "adjustment_requested", fromStatus: "awaiting_final_approval", toStatus: "awaiting_final_approval", detail: { message_id: "m1" }, createdAt: "2026-10-25T13:00:00Z" }],
    });
    const dialog = await openTrade(trade);
    expect(within(dialog).getByText(/The customer asked for an adjustment/).parentElement).toHaveTextContent("Could you look at the Sheoldred again?");
    repo.reopenInspection.mockResolvedValue(answer({ ...trade, status: "under_inspection", finalOfferAt: null }));
    await user.click(within(dialog).getByRole("button", { name: "Take the offer back to revise" }));
    await waitFor(() => expect(repo.reopenInspection).toHaveBeenCalledWith(TRADE_ID));
  });
});

describe("payment and wrapping up", () => {
  it("records a payment taken another way (the owner only)", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({ status: "awaiting_payment", amountDueCents: 4099, offered: APPROVED });
    const dialog = await openTrade(trade);
    repo.recordPayment.mockResolvedValue(answer({ ...trade, status: "approved_for_fulfillment" }));
    await user.type(within(dialog).getByLabelText("Paid another way? Say how"), "Cash in store");
    await user.click(within(dialog).getByRole("button", { name: "Record the payment" }));
    await waitFor(() => expect(repo.recordPayment).toHaveBeenCalledWith(TRADE_ID, "Cash in store"));
    cleanup();

    const staffDialog = await openTrade(trade, { owner: false });
    expect(within(staffDialog).queryByRole("button", { name: "Record the payment" })).toBeNull();
    expect(within(staffDialog).getByText("If they paid in store, the store owner can record it here.")).toBeInTheDocument();
  });

  it("adds the cards taken to inventory, marks cash paid, and mails back what wasn't taken", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      status: "approved_for_fulfillment",
      orderId: "order-1",
      finalValueCents: 12680,
      finalCreditCents: 10144,
      shippingCents: 0,
      amountDueCents: 0,
      excessCents: 1245,
      excessHandling: "cash",
      cashPayoutCents: 934,
      creditIssuedCents: 8899,
      returnStatus: "pending",
      wanted: [wantedItem({ status: "fulfilled" }), wantedItem({ id: "w2", inventoryItemId: "i2", cardName: "Arcane Signet", quantity: 2, unitPriceCents: 450, status: "fulfilled" })],
      offered: [
        { ...APPROVED[0], inspected: true, receivedQuantity: 1, finalQuantity: 1, finalUnitCents: 8000, disposition: "accepted" },
        { ...APPROVED[1], inspected: true, receivedQuantity: 2, finalQuantity: 1, finalUnitCents: 4680, disposition: "imported" },
        { ...APPROVED[2], disposition: "rejected" },
      ],
    });
    const dialog = await openTrade(trade);
    expect(within(dialog).getByText("Cash owed for the credit left over").nextElementSibling).toHaveTextContent("$9.34");

    await user.click(within(dialog).getByRole("button", { name: "Open their order" }));
    expect(navigate).toHaveBeenCalledWith("/admin_dashboard/orders?order=order-1");

    // Into inventory at the market price, unless staff change it.
    expect(within(dialog).getByLabelText("Selling price each for Sheoldred, the Apocalypse")).toHaveValue("80.00");
    await user.type(within(dialog).getByLabelText("Storage location for Sheoldred, the Apocalypse"), "Binder 3");
    repo.importCard.mockResolvedValue(answer(trade));
    await user.click(within(dialog).getByRole("button", { name: "Add 1 to inventory" }));
    // At the condition it was traded at, unless staff change it; no stocked line to reprice.
    await waitFor(() => expect(repo.importCard).toHaveBeenCalledWith("o1", 8000, "Binder 3", { condition: "NM", updateLinePrice: false }));

    repo.markCashPaid.mockResolvedValue(answer({ ...trade, cashPaidAt: "2026-10-25T15:00:00Z" }));
    await user.type(within(dialog).getByLabelText("How you paid (optional)"), "Venmo");
    await user.click(within(dialog).getByRole("button", { name: "Mark the cash paid" }));
    await waitFor(() => expect(repo.markCashPaid).toHaveBeenCalledWith(TRADE_ID, "Venmo"));

    // One Ragavan arrived that we didn't take.
    const mailBack = within(dialog).getByText("Mail their cards back").closest("section")!;
    expect(mailBack).toHaveTextContent("1 × Ragavan, Nimble Pilferer");
    expect(mailBack).not.toHaveTextContent("Mox Diamond");
    repo.markReturned.mockResolvedValue(answer({ ...trade, returnStatus: "returned", returnedAt: "2026-10-25T16:00:00Z" }));
    await user.type(within(mailBack).getByLabelText("Tracking number (optional)"), "9400 1118 9922 3197 4284 90");
    await user.click(within(mailBack).getByRole("button", { name: "Mark returned and email the customer" }));
    await waitFor(() => expect(repo.markReturned).toHaveBeenCalledWith(TRADE_ID, { carrier: "USPS", trackingNumber: "9400 1118 9922 3197 4284 90" }));
  });

  it("adds a trade-in at the condition and price staff choose, and says when it joins a line we stock", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      status: "completed",
      orderId: "order-1",
      wanted: [wantedItem({ status: "fulfilled" })],
      offered: [
        {
          ...APPROVED[0],
          inspected: true,
          receivedQuantity: 2,
          finalQuantity: 2,
          finalUnitCents: 8000,
          disposition: "accepted",
          stockedLines: [
            { condition: "NM", quantity: 3, priceCents: 9000, isDeal: false },
            { condition: "LP", quantity: 1, priceCents: 7000, isDeal: true },
          ],
        },
      ],
    });
    const dialog = await openTrade(trade);
    const row = within(dialog).getByLabelText("Condition for Sheoldred, the Apocalypse").closest("li")!;
    expect(within(row).getByLabelText("Condition for Sheoldred, the Apocalypse")).toHaveValue("NM");
    expect(row).toHaveTextContent("Traded as Near Mint");
    // NM: joins our NM line at $90.00; at $80.00 typed, staff choose whether it keeps $90.00.
    expect(row).toHaveTextContent("You already stock 3 Near Mint at $90.00. These 2 copies join that line, which keeps $90.00.");
    const reprice = within(row).getByRole("checkbox", { name: "Change the price of the Sheoldred, the Apocalypse line to $80.00" });
    expect(reprice).not.toBeChecked();
    await user.click(reprice);
    expect(row).toHaveTextContent("and the whole line goes to $80.00.");
    expect(row).toHaveTextContent("all 5 copies");

    // LP: our LP line is on a deal, so it keeps its price.
    await user.selectOptions(within(row).getByLabelText("Condition for Sheoldred, the Apocalypse"), "LP");
    expect(row).toHaveTextContent("You already stock 1 Lightly Played at $70.00. These 2 copies join that line, which is on a deal: it keeps its deal price.");
    expect(within(row).queryByRole("checkbox")).toBeNull();

    // MP: nothing stocked, a new line at the price typed.
    await user.selectOptions(within(row).getByLabelText("Condition for Sheoldred, the Apocalypse"), "MP");
    expect(row).toHaveTextContent("Goes into inventory as a new line, Moderately Played, at the price above.");
    const price = within(row).getByLabelText("Selling price each for Sheoldred, the Apocalypse");
    await user.clear(price);
    await user.type(price, "65");
    repo.importCard.mockResolvedValue(answer(trade));
    await user.click(within(row).getByRole("button", { name: "Add 2 to inventory" }));
    await waitFor(() => expect(repo.importCard).toHaveBeenLastCalledWith("o1", 6500, "", { condition: "MP", updateLinePrice: false }));

    // Back to NM: changing the condition unticks the box, so a price change is never carried over by accident.
    await user.selectOptions(within(row).getByLabelText("Condition for Sheoldred, the Apocalypse"), "NM");
    const again = within(row).getByRole("checkbox", { name: "Change the price of the Sheoldred, the Apocalypse line to $65.00" });
    expect(again).not.toBeChecked();
    await user.click(again);
    await user.click(within(row).getByRole("button", { name: "Add 2 to inventory" }));
    await waitFor(() => expect(repo.importCard).toHaveBeenLastCalledWith("o1", 6500, "", { condition: "NM", updateLinePrice: true }));
  });

  it("shows a finished trade's shipping against its cost and the inventory-value difference, both shipments, and records the postage", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      status: "completed",
      wantedTotalCents: 20000,
      finalValueCents: 25000,
      finalCreditCents: 20000,
      shippingCents: 0,
      amountDueCents: 0,
      excessCents: 0,
      creditIssuedCents: 20000,
      paidAt: "2026-10-24T12:00:00Z",
      orderId: "order-9",
      outgoing: { status: "shipped", carrier: "USPS", tracking: "9400111899223197428490", shippedAt: "2026-10-25T15:00:00Z", deliveredAt: null },
      shipment: shipment({
        carrier: "UPS",
        tracking: "1Z999AA10123456784",
        shippedOn: "2026-10-20",
        packagingConfirmedAt: "2026-10-20T15:00:00Z",
        deliveredAt: "2026-10-22T15:00:00Z",
      }),
      offered: APPROVED,
    });
    const dialog = await openTrade(trade);
    // $250 in, $200 out, free shipping, no postage recorded: the $6 estimate, so $44 after shipping.
    const econ = within(dialog).getByRole("heading", { name: "Shipping and inventory value" }).parentElement!;
    expect(within(econ).getByText("Shipping charged").nextElementSibling).toHaveTextContent("Free");
    expect(within(econ).getByText("Estimated shipping cost").nextElementSibling).toHaveTextContent("$6.00");
    expect(within(econ).getByText(/Actual shipping cost/).nextElementSibling).toHaveTextContent("Not recorded");
    expect(within(econ).getByText("Net shipping expense").nextElementSibling).toHaveTextContent("$6.00");
    expect(within(econ).getByText("Gross inventory value difference").nextElementSibling).toHaveTextContent("+$50.00");
    expect(within(econ).getByText("Shipping-adjusted inventory value difference").nextElementSibling).toHaveTextContent("+$44.00");
    expect(econ).toHaveTextContent("It isn’t profit");
    // Both shipments, with the packaging confirmation.
    const shipments = within(dialog).getByRole("heading", { name: "Shipments" }).closest("section")!;
    expect(within(shipments).getByRole("link", { name: "1Z999AA10123456784" })).toHaveAttribute("href", expect.stringContaining("ups.com"));
    expect(shipments).toHaveTextContent("Customer says they shipped Tue, Oct 20");
    expect(shipments).toHaveTextContent("packaging confirmed");
    expect(shipments).toHaveTextContent("Our cards to the customer: Shipped");
    expect(within(shipments).getByRole("link", { name: "9400111899223197428490" })).toHaveAttribute("href", expect.stringContaining("usps.com"));
    // The postage, recorded by hand.
    repo.setPostage.mockResolvedValue(answer({ ...trade, outboundPostageCents: 540 }));
    await user.click(within(econ).getByRole("button", { name: "Record the postage" }));
    await user.type(within(econ).getByLabelText("What the postage for our cards cost"), "5.40");
    await user.click(within(econ).getByRole("button", { name: "Save postage" }));
    await waitFor(() => expect(repo.setPostage).toHaveBeenCalledWith(TRADE_ID, 540));
    const after = within(dialog).getByRole("heading", { name: "Shipping and inventory value" }).parentElement!;
    await waitFor(() => expect(within(after).getByText(/Actual shipping cost/).nextElementSibling).toHaveTextContent("$5.40"));
    expect(within(after).getByText("Shipping-adjusted inventory value difference").nextElementSibling).toHaveTextContent("+$44.60");
  });

  it("shows shipping by card apart from the credit while payment is due", async () => {
    // $150 of our cards, $187.50 accepted: $150 of credit covers the cards; the $3.99 shipping is paid by card.
    const trade = staffTrade({
      status: "awaiting_payment",
      wantedTotalCents: 15000,
      finalValueCents: 18750,
      finalCreditCents: 15000,
      shippingCents: 399,
      amountDueCents: 399,
      excessCents: 0,
      offered: APPROVED,
    });
    const dialog = await openTrade(trade);
    const money = within(dialog).getByRole("heading", { name: "What it adds up to" }).closest("section")!;
    expect(within(money).getByText("Our cards the credit doesn’t cover").nextElementSibling).toHaveTextContent("$0.00");
    expect(within(money).getByText(/Shipping our cards/).nextElementSibling).toHaveTextContent("$3.99");
    expect(within(money).getByText("The customer pays by card").nextElementSibling).toHaveTextContent("$3.99");
    expect(within(dialog).getByRole("heading", { name: "Waiting for $3.99" })).toBeInTheDocument();
  });

  it("leaves the cash payout to the owner", async () => {
    const trade = staffTrade({ status: "completed", excessHandling: "cash", cashPayoutCents: 934, excessCents: 1245, amountDueCents: 0, shippingCents: 0, finalCreditCents: 10144, offered: APPROVED });
    const dialog = await openTrade(trade, { owner: false });
    expect(within(dialog).queryByRole("button", { name: "Mark the cash paid" })).toBeNull();
    expect(within(dialog).getByText(/The store owner records it once it.s paid\./)).toBeInTheDocument();
  });
});

describe("everything else on a trade", () => {
  it("lowers how many of our cards are on it, or takes one off after asking", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({ status: "awaiting_shipment", offered: APPROVED, wanted: [wantedItem(), wantedItem({ id: "w2", inventoryItemId: "i2", cardName: "Arcane Signet", quantity: 2, unitPriceCents: 450 })] });
    const dialog = await openTrade(trade);
    repo.setWanted.mockResolvedValue(answer(trade));
    await user.selectOptions(within(dialog).getByLabelText("How many Arcane Signet"), "1");
    await waitFor(() =>
      expect(repo.setWanted).toHaveBeenLastCalledWith(TRADE_ID, [
        { inventoryItemId: "i1", quantity: 1 },
        { inventoryItemId: "i2", quantity: 1 },
      ]),
    );
    const ring = within(dialog).getByText("The One Ring").closest("li")!;
    await user.click(within(ring).getByRole("button", { name: "Take off the trade" }));
    await user.click(within(ring).getByRole("button", { name: "Take it off" }));
    await waitFor(() => expect(repo.setWanted).toHaveBeenLastCalledWith(TRADE_ID, [{ inventoryItemId: "i2", quantity: 2 }]));
  });

  it("sorts our cards by name or by color, under color headings, and remembers the choice", async () => {
    window.localStorage.removeItem("gg-trade-wanted-sort");
    const user = userEvent.setup();
    const trade = staffTrade({
      status: "awaiting_shipment",
      offered: APPROVED,
      wanted: [
        wantedItem({ id: "w1", inventoryItemId: "i1", cardName: "Sol Ring", colors: [], typeLine: "Artifact" }),
        wantedItem({ id: "w2", inventoryItemId: "i2", cardName: "Lightning Bolt", colors: ["R"], typeLine: "Instant" }),
        wantedItem({ id: "w3", inventoryItemId: "i3", cardName: "Counterspell", colors: ["U"], typeLine: "Instant" }),
        wantedItem({ id: "w4", inventoryItemId: "i4", cardName: "Abrupt Decay", colors: ["B", "G"], typeLine: "Instant" }),
      ],
    });
    const dialog = await openTrade(trade);
    const ours = within(dialog).getByRole("heading", { name: /Our cards/ }).closest("section")!;
    const names = () => within(ours).getAllByRole("listitem").filter((li) => li.classList.contains("gg-trd-card")).map((li) => li.querySelector(".gg-trd-card__name")!.textContent);
    const headings = () => Array.from(ours.querySelectorAll(".gg-trd-cards__group")).map((h) => h.textContent);

    // The trade's own order first.
    expect(names()).toEqual(["Sol Ring", "Lightning Bolt", "Counterspell", "Abrupt Decay"]);
    expect(headings()).toEqual([]);

    await user.selectOptions(within(ours).getByLabelText("Sort by"), "Name (A–Z)");
    expect(names()).toEqual(["Abrupt Decay", "Counterspell", "Lightning Bolt", "Sol Ring"]);

    await user.selectOptions(within(ours).getByLabelText("Sort by"), "Color");
    expect(names()).toEqual(["Counterspell", "Lightning Bolt", "Abrupt Decay", "Sol Ring"]);
    expect(headings()).toEqual(["Blue", "Red", "Multicolor", "Colorless"]);
    expect(window.localStorage.getItem("gg-trade-wanted-sort")).toBe("color");
    window.localStorage.removeItem("gg-trade-wanted-sort");
  });

  it("makes foils stand out: the shimmer over the picture and a Foil tag, and nothing on non-foils", async () => {
    const trade = staffTrade({
      status: "awaiting_shipment",
      offered: APPROVED,
      wanted: [
        wantedItem({ id: "w1", cardName: "The One Ring", imageUrl: "https://cards.scryfall.io/normal/front/a/b/ring.jpg?1" }),
        wantedItem({ id: "w2", inventoryItemId: "i2", cardName: "Arcane Signet", finish: "foil", imageUrl: "https://cards.scryfall.io/normal/front/c/d/signet.jpg?1" }),
        wantedItem({ id: "w3", inventoryItemId: "i3", cardName: "Sol Ring", finish: "etched", imageUrl: null }),
      ],
    });
    const dialog = await openTrade(trade);
    const row = (name: string) => within(dialog).getByText(name, { selector: ".gg-trd-card__name" }).closest("li")!;

    expect(row("The One Ring")).not.toHaveClass("gg-trd-card--foil");
    expect(row("The One Ring").querySelector(".gg-card-foil-shimmer")).toBeNull();
    expect(row("The One Ring").querySelector(".gg-trd-foiltag")).toBeNull();

    expect(row("Arcane Signet")).toHaveClass("gg-trd-card--foil");
    expect(row("Arcane Signet").querySelector(".gg-card-foil-shimmer")).not.toBeNull();
    expect(row("Arcane Signet").querySelector(".gg-trd-foiltag")).toHaveTextContent("Foil");
    // The picture still enlarges under the shimmer.
    expect(within(row("Arcane Signet")).getByRole("img", { name: "Arcane Signet" })).toBeInTheDocument();

    // Etched, with no picture: still tagged, still shimmering.
    expect(row("Sol Ring").querySelector(".gg-trd-foiltag")).toHaveTextContent("Etched foil");
    expect(row("Sol Ring").querySelector(".gg-card-foil-shimmer")).not.toBeNull();
  });

  it("shows a card's picture larger on hover", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      status: "awaiting_shipment",
      offered: APPROVED,
      wanted: [wantedItem({ imageUrl: "https://cards.scryfall.io/normal/front/a/b/ring.jpg?1" })],
    });
    const dialog = await openTrade(trade);
    const thumb = within(dialog).getByRole("img", { name: "The One Ring" });
    expect(thumb).toHaveAttribute("src", "https://cards.scryfall.io/small/front/a/b/ring.jpg?1");
    await user.hover(thumb);
    const big = await screen.findByRole("img", { name: "The One Ring, enlarged" });
    expect(big.querySelector("img")).toHaveAttribute("src", "https://cards.scryfall.io/large/front/a/b/ring.jpg?1");
    await user.unhover(thumb);
    await waitFor(() => expect(screen.queryByRole("img", { name: "The One Ring, enlarged" })).toBeNull());
  });

  it("gives more time on the running deadline, noting when the customer asked", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({ status: "awaiting_shipment", offered: APPROVED, shipBy: "2099-10-30T19:00:00Z", shipByOriginal: "2099-10-29T19:00:00Z" });
    const dialog = await openTrade(trade);
    expect(within(dialog).getByText(/Ship by:/).parentElement).toHaveTextContent("left");
    expect(within(dialog).getByText(/Originally/)).toBeInTheDocument();
    repo.extend.mockResolvedValue(answer(trade));
    await user.click(within(dialog).getByRole("button", { name: "Give more time…" }));
    await user.selectOptions(within(dialog).getByLabelText("Extend by"), "72");
    expect(within(dialog).getByText(/New deadline:/)).toHaveTextContent("(Sundays don't count)");
    await user.click(within(dialog).getByLabelText("The customer asked for it"));
    await user.type(within(dialog).getByLabelText("Reason (optional, staff only)"), "Waiting on a box");
    await user.click(within(dialog).getByRole("button", { name: "Extend" }));
    await waitFor(() => expect(repo.extend).toHaveBeenCalledWith(TRADE_ID, { kind: "shipping", hours: 72, customerRequested: true, reason: "Waiting on a box" }));
  });

  it("sends a message to the customer, or keeps a note for staff", async () => {
    const user = userEvent.setup();
    const dialog = await openTrade(REVIEW);
    repo.message.mockResolvedValue(answer(REVIEW));
    const box = within(dialog).getByLabelText("Write a message or a note");
    await user.type(box, "Check the corners");
    await user.click(within(dialog).getByRole("button", { name: "Save as a staff note" }));
    await waitFor(() => expect(repo.message).toHaveBeenLastCalledWith(TRADE_ID, "Check the corners", false));
    await waitFor(() => expect(box).toHaveValue(""));
    await user.type(box, "We'll have an answer tomorrow.");
    await user.click(within(dialog).getByRole("button", { name: "Send to the customer" }));
    await waitFor(() => expect(repo.message).toHaveBeenLastCalledWith(TRADE_ID, "We'll have an answer tomorrow.", true));
  });

  it("cancels a confirmed trade whose cards are on their way: the deposit is refunded and they go back", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      status: "in_transit",
      offered: APPROVED,
      shipment: shipment({ carrier: "USPS", tracking: "9400111899223197428490", acceptedAt: "2026-10-24T15:00:00Z" }),
      deposit: staffDeposit({ cents: 2000, status: "paid", paidCents: 2000 }),
    });
    const dialog = await openTrade(trade);
    // Confirmed trades are canceled, not rejected.
    expect(within(dialog).queryByRole("button", { name: "Reject the trade…" })).toBeNull();
    const cancel = within(dialog).getByRole("heading", { name: "Cancel this trade" }).closest("section")!;
    expect(cancel).toHaveTextContent("the deposit is refunded in full, and their cards come back to them");
    expect(cancel).toHaveTextContent("It never counts against the customer.");
    await user.click(within(cancel).getByRole("button", { name: "Cancel the trade…" }));
    repo.cancelByStore.mockResolvedValue(answer({ ...trade, status: "canceled_by_store", returnStatus: "pending", closeReason: "Pricing error" }));
    await user.type(within(cancel).getByLabelText("Reason for the customer"), "Pricing error");
    await user.click(within(cancel).getByRole("button", { name: "Cancel the trade" }));
    await waitFor(() => expect(repo.cancelByStore).toHaveBeenCalledWith(TRADE_ID, "Pricing error"));
    expect(await screen.findByText("Trade canceled. Mail their cards back, then mark them returned.")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Mail their cards back" })).toBeInTheDocument();
  });

  it("shows the customer's record, and lets the owner stop a fault counting", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      status: "canceled",
      customerFault: "canceled_while_reserved",
      faultAt: "2026-10-25T12:00:00Z",
      customerRecord: record({ completedTrades: 4, onTimeShipments: 4, abandonedReservations: 1, recentFaults: 1 }),
      privileges: privileges({ tier: "tier1", shipDays: 4 }),
    });
    const dialog = await openTrade(trade);
    expect(within(dialog).getByText("Returning customer").parentElement).toHaveTextContent("4 completed trades · 100% shipped on time · 4 days to ship");
    expect(within(dialog).getByText(/Counts against the customer:/).parentElement).toHaveTextContent("Canceled after confirming, before shipping");
    repo.clearFault.mockResolvedValue(answer({ ...trade, customerFault: null, faultClearedAt: "2026-10-25T13:00:00Z", faultClearedBy: "pat@example.com" }));
    await user.click(within(dialog).getByRole("button", { name: "Don’t count it" }));
    await waitFor(() => expect(repo.clearFault).toHaveBeenCalledWith(TRADE_ID));
    expect(await within(screen.getByRole("dialog")).findByText(/A fault on this trade was cleared/)).toHaveTextContent("by pat@example.com");
  });

  it("shows a problem in words and the trade as it now stands", async () => {
    const user = userEvent.setup();
    const dialog = await openTrade(staffTrade({ status: "in_transit", offered: APPROVED }));
    repo.markReceived.mockRejectedValue(new Error("Only a trade waiting for its package can be marked received."));
    repo.get.mockResolvedValue(answer(staffTrade({ status: "received", offered: APPROVED })));
    await user.click(within(dialog).getByRole("button", { name: "Mark the package received" }));
    expect(await screen.findByText("Only a trade waiting for its package can be marked received.")).toBeInTheDocument();
    expect(await within(screen.getByRole("dialog")).findByText("Inspect their cards")).toBeInTheDocument();
  });
});

describe("the shipment, proof of shipping and the deposit", () => {
  const LATE = staffTrade({
    status: "tracking_submitted",
    offered: APPROVED,
    shipBy: "2026-10-27T19:00:00.000Z",
    reviewFlag: "late_acceptance",
    reviewFlagAt: "2026-10-27T21:05:00Z",
    shipment: shipment({ carrier: "USPS", tracking: "9400111899223197428490", acceptedAt: "2026-10-27T21:00:00.000Z", acceptanceSource: "carrier" }),
    deposit: staffDeposit({ cents: 2000, status: "paid", reason: "threshold", paidCents: 2000, paymentIntentId: "pi_123" }),
  });

  it("puts a late first scan in front of staff, and verifies it as late (deposit to review) before receiving", async () => {
    const user = userEvent.setup();
    const dialog = await openTrade(LATE);
    expect(within(dialog).getByText(/The carrier's first scan came after the shipping deadline\./)).toBeInTheDocument();
    // Arriving doesn't settle a late scan.
    expect(within(dialog).getByRole("button", { name: "Mark the package received" })).toBeDisabled();
    expect(within(dialog).getByText(/verify the shipment \(on time or late\) first, then mark it received/)).toBeInTheDocument();
    // Open already, from the scan; it's after the deadline, so not counted on time.
    expect(within(dialog).getByLabelText(/Count it as shipped on time/)).not.toBeChecked();
    expect(within(dialog).getByText(/Late: it counts against the customer and the \$20\.00 deposit goes to review/)).toBeInTheDocument();
    repo.verifyShipment.mockResolvedValue(answer({ ...LATE, status: "in_transit", reviewFlag: null, deposit: { ...LATE.deposit, status: "forfeiture_review" } }));
    await user.click(within(dialog).getByRole("button", { name: "Verify the shipment" }));
    await waitFor(() =>
      expect(repo.verifyShipment).toHaveBeenCalledWith(TRADE_ID, { acceptedAt: "2026-10-27T21:00:00.000Z", onTime: false, refund: false, note: "" }),
    );
  });

  it("can excuse a late scan: on time refunds the deposit", async () => {
    const user = userEvent.setup();
    const dialog = await openTrade(LATE);
    await user.click(within(dialog).getByLabelText(/Count it as shipped on time/));
    expect(within(dialog).getByText(/The \$20\.00 deposit is refunded now\./)).toBeInTheDocument();
    repo.verifyShipment.mockResolvedValue(answer({ ...LATE, status: "in_transit", reviewFlag: null }));
    await user.click(within(dialog).getByRole("button", { name: "Verify the shipment" }));
    await waitFor(() => expect(repo.verifyShipment).toHaveBeenCalledWith(TRADE_ID, expect.objectContaining({ onTime: true, refund: true })));
  });

  it("releases an unshipped reservation early, counted against the customer unless unticked", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({ status: "awaiting_shipment", offered: APPROVED, shipBy: "2099-10-30T19:00:00Z" });
    const dialog = await openTrade(trade);
    await user.click(within(dialog).getByRole("button", { name: "Release the reservation…" }));
    await user.type(within(dialog).getByLabelText("Why (the customer is emailed this)"), "Customer said they won't ship");
    repo.expireNow.mockResolvedValue(answer({ ...trade, status: "expired" }));
    await user.click(within(dialog).getByRole("button", { name: "Release our cards" }));
    await waitFor(() => expect(repo.expireNow).toHaveBeenCalledWith(TRADE_ID, { reason: "Customer said they won't ship", countAgainst: true }));
  });

  it("decides on proof of shipping, with links to the files", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      status: "tracking_submitted",
      offered: APPROVED,
      reviewFlag: "dispute",
      disputes: [
        {
          id: "d1",
          status: "open",
          note: "Dropped it at the post office Tuesday",
          files: [{ name: "receipt.jpg", size: 204800, type: "image/jpeg", url: "https://files.example/receipt.jpg?sig=1" }],
          createdAt: "2026-10-26T12:00:00Z",
          resolvedAt: null,
          staffNote: null,
          resolvedBy: null,
        },
      ],
    });
    const dialog = await openTrade(trade);
    const proof = within(dialog).getByRole("heading", { name: "Proof of shipping (1)" }).closest("section")!;
    expect(proof).toHaveTextContent("Dropped it at the post office Tuesday");
    expect(within(proof).getByRole("link", { name: "receipt.jpg" })).toHaveAttribute("href", "https://files.example/receipt.jpg?sig=1");
    expect(proof).toHaveTextContent("200 KB");
    await user.type(within(proof).getByLabelText("Note (staff only)"), "Receipt checks out");
    repo.resolveDispute.mockResolvedValue(answer({ ...trade, reviewFlag: null }));
    await user.click(within(proof).getByRole("button", { name: "Accept the proof" }));
    await waitFor(() => expect(repo.resolveDispute).toHaveBeenCalledWith(TRADE_ID, "d1", "accepted", "Receipt checks out"));
  });

  it("refunds a deposit under review, and only lets the owner keep one when keeping deposits is on", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      status: "expired",
      expiredStage: "shipping",
      closedAt: "2026-10-28T19:00:00Z",
      customerFault: "missed_deadline",
      deposit: staffDeposit({ cents: 2000, status: "forfeiture_review", reason: "threshold", paidCents: 2000, paymentIntentId: "pi_9", feeCents: 88 }),
      consents: [{ termsVersion: 1, termsText: "Refunded in full once the carrier accepts it.", depositCents: 2000, shipDays: 3, confirmBy: null, ip: "203.0.113.9", userAgent: "Safari", createdAt: "2026-10-24T12:00:00Z" }],
    });
    // Keeping deposits is off (the default): refund only.
    let dialog = await openTrade(trade);
    const deposit = () => within(screen.getByRole("dialog")).getByRole("heading", { name: "Deposit" }).closest("section")!;
    expect(deposit()).toHaveTextContent("Under review");
    expect(deposit()).toHaveTextContent("Stripe’s fee (yours to absorb; refunds are always in full)$0.88");
    expect(within(deposit()).getByRole("button", { name: "Keep the deposit…" })).toBeDisabled();
    expect(deposit()).toHaveTextContent("Keeping deposits is turned off in Settings, so this one can only be refunded.");
    expect(within(deposit()).getByText(/What the customer agreed to/)).toBeInTheDocument();
    expect(deposit()).toHaveTextContent("IP 203.0.113.9 · Safari");
    await user.click(within(deposit()).getByRole("button", { name: "Refund $20.00 in full…" }));
    repo.refundDeposit.mockResolvedValue({ ...answer({ ...trade, deposit: { ...trade.deposit, status: "refund_pending" } }), customerEmail: { status: "sent" } });
    await user.click(within(deposit()).getByRole("button", { name: "Refund $20.00" }));
    await waitFor(() => expect(repo.refundDeposit).toHaveBeenCalledWith(TRADE_ID, ""));
    expect(await screen.findByText("Refunding $20.00. The customer was emailed.")).toBeInTheDocument();
    cleanup();

    // On, but not the owner.
    dialog = await openTrade(trade, { owner: false, settings: { ...TRADE_SETTINGS, allowForfeiture: true } });
    expect(within(dialog).getByRole("button", { name: "Keep the deposit…" })).toBeDisabled();
    expect(within(dialog).getByText("Only the store owner can keep a deposit.")).toBeInTheDocument();
    cleanup();

    // On, and the owner: a reason the customer sees is required.
    dialog = await openTrade(trade, { settings: { ...TRADE_SETTINGS, allowForfeiture: true } });
    await user.click(within(dialog).getByRole("button", { name: "Keep the deposit…" }));
    const keep = within(dialog).getByRole("button", { name: "Keep the $20.00 deposit" });
    expect(keep).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Why you're keeping it (the customer is emailed this)"), "Never shipped");
    repo.forfeitDeposit.mockResolvedValue(answer({ ...trade, deposit: { ...trade.deposit, status: "forfeited" } }));
    await user.click(keep);
    await waitFor(() => expect(repo.forfeitDeposit).toHaveBeenCalledWith(TRADE_ID, "Never shipped"));
  });

  it("retries a refund the bank refused", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      status: "completed",
      offered: APPROVED,
      deposit: staffDeposit({ cents: 2000, status: "refund_failed", paidCents: 2000, refundFailure: "expired_or_canceled_card", refundAttempts: 1 }),
    });
    const dialog = await openTrade(trade);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("The refund didn’t go through: expired_or_canceled_card.");
    repo.retryRefund.mockResolvedValue(answer(trade));
    await user.click(within(dialog).getByRole("button", { name: "Try the refund again" }));
    await waitFor(() => expect(repo.retryRefund).toHaveBeenCalledWith(TRADE_ID));
  });

  it("changes the deposit while the customer hasn't paid it yet", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      status: "awaiting_confirmation",
      wantedTotalCents: 32000,
      offered: APPROVED,
      confirmBy: "2099-10-27T19:00:00Z",
      deposit: staffDeposit({ cents: 2000, status: "payment_pending", reason: "threshold" }),
    });
    const dialog = await openTrade(trade);
    await user.selectOptions(within(dialog).getByLabelText("Change the deposit"), "waived");
    expect(within(dialog).getByText(/Would be none\./)).toBeInTheDocument();
    repo.setDeposit.mockResolvedValue(answer({ ...trade, deposit: staffDeposit({ override: "waived" }) }));
    await user.click(within(dialog).getByRole("button", { name: "Save the deposit" }));
    await waitFor(() => expect(repo.setDeposit).toHaveBeenCalledWith(TRADE_ID, "waived"));
  });

  it("takes an approval back while it waits for the customer's confirmation", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({ status: "awaiting_confirmation", offered: APPROVED, confirmBy: "2099-10-27T19:00:00Z" });
    const dialog = await openTrade(trade);
    await user.click(within(dialog).getByRole("button", { name: "Ask for changes instead…" }));
    await user.type(within(dialog).getByLabelText("What should they change?"), "Swap the Ring for the foil");
    repo.requestRevision.mockResolvedValue(answer({ ...trade, status: "revision_requested" }));
    await user.click(within(dialog).getByRole("button", { name: "Send it back" }));
    await waitFor(() => expect(repo.requestRevision).toHaveBeenCalledWith(TRADE_ID, "Swap the Ring for the foil"));
  });
});

describe("an expired reservation", () => {
  const EXPIRED = staffTrade({
    status: "expired",
    expiredStage: "scan",
    closedAt: "2026-10-28T19:00:00Z",
    closeReason: "The carrier never scanned the package.",
    customerFault: "missed_deadline",
    offered: APPROVED,
    canSendProof: true,
    proofDueAt: "2099-11-11T19:00:00Z",
    privileges: privileges({ shipDays: 4, tier: "tier1" }),
    wanted: [wantedItem({ status: "released" })],
  });

  it("reinstates it with a fresh deadline, not counting the expiry", async () => {
    const user = userEvent.setup();
    const dialog = await openTrade(EXPIRED);
    expect(within(dialog).getByText(/Tracking was added but the carrier never scanned it in time\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/The customer can send proof of shipping until/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Days to ship from now")).toHaveValue("4");
    expect(within(dialog).getByText(/New deadline:/)).toBeInTheDocument();
    repo.reinstate.mockResolvedValue(answer({ ...EXPIRED, status: "awaiting_shipment" }));
    await user.click(within(dialog).getByRole("button", { name: "Reinstate" }));
    await waitFor(() => expect(repo.reinstate).toHaveBeenCalledWith(TRADE_ID, { mode: "awaiting_shipment", shipDays: 4, clearFault: true }));
  });

  it("records a package that turned up anyway", async () => {
    const user = userEvent.setup();
    const dialog = await openTrade(EXPIRED);
    repo.cardsArrived.mockResolvedValue(answer({ ...EXPIRED, returnStatus: "pending", receivedAt: "2026-10-29T12:00:00Z" }));
    await user.click(within(dialog).getByRole("button", { name: "Their package arrived anyway" }));
    await waitFor(() => expect(repo.cardsArrived).toHaveBeenCalledWith(TRADE_ID));
    expect(await within(screen.getByRole("dialog")).findByRole("heading", { name: "Mail their cards back" })).toBeInTheDocument();
  });
});

describe("the Deposits, Reserved and Customers tabs", () => {
  it("adds up deposits by where the money is, and opens a trade from the list", async () => {
    const user = userEvent.setup();
    repo.deposits.mockResolvedValue({
      totals: { heldCents: 4000, refundPendingCents: 2000, refundedCents: 10000, reviewCents: 2000, forfeitedCents: 0, failedCents: 0, feesCents: 412, awaitingPaymentCents: 0 },
      trades: [
        tradeSummary({ id: "t-r", tradeNumber: 1002, status: "expired", depositStatus: "forfeiture_review", depositCents: 2000, depositPaidCents: 2000 }),
        tradeSummary({ id: "t-h", tradeNumber: 1003, status: "awaiting_shipment", depositStatus: "paid", depositCents: 2000, depositPaidCents: 2000 }),
      ],
      settings: TRADE_SETTINGS,
      owner: true,
    });
    repo.get.mockResolvedValue({ trade: staffTrade({ id: "t-r", tradeNumber: 1001 }), settings: TRADE_SETTINGS, owner: true });
    renderPage("tab=deposits");
    expect(await screen.findByText("Waiting for your decision")).toBeInTheDocument();
    expect(screen.getByText("Stripe fees on deposits").parentElement?.parentElement).toHaveTextContent("$4.12");
    // Needs you first: only the one under review.
    expect(screen.getByText("TR-1002")).toBeInTheDocument();
    expect(screen.queryByText("TR-1003")).toBeNull();
    await user.click(screen.getByRole("tab", { name: /^Held/ }));
    expect(screen.getByText("TR-1003")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /^Needs you/ }));
    await user.click(screen.getByText("TR-1002"));
    await waitFor(() => expect(repo.get).toHaveBeenCalledWith("t-r"));
  });

  it("lists our cards reserved for trades with each trade's deadline", async () => {
    repo.reserved.mockResolvedValue({
      lines: [
        { itemId: "l1", tradeId: "t1", tradeNumber: 1001, status: "awaiting_shipment", customerName: "Ann Lee", customerEmail: "ann@example.com", shipBy: "2099-10-30T19:00:00Z", shippedAt: null, depositStatus: "paid", inventoryItemId: "i1", cardName: "The One Ring", setCode: "ltr", collectorNumber: "246", condition: "NM", finish: "nonfoil", quantity: 1, unitPriceCents: 7999, imageUrl: null },
        { itemId: "l2", tradeId: "t2", tradeNumber: 1002, status: "in_transit", customerName: "Bo Diaz", customerEmail: null, shipBy: "2099-10-20T19:00:00Z", shippedAt: "2099-10-19T15:00:00Z", depositStatus: "refund_pending", inventoryItemId: "i2", cardName: "Arcane Signet", setCode: "cmr", collectorNumber: "297", condition: "LP", finish: "foil", quantity: 2, unitPriceCents: 450, imageUrl: null },
      ],
      settings: TRADE_SETTINGS,
      owner: true,
    });
    renderPage("tab=reserved");
    expect(await screen.findByText("The One Ring")).toBeInTheDocument();
    expect(screen.getByText("3 copies · $88.99 · 2 trades")).toBeInTheDocument();
    expect(screen.getByText("The One Ring").closest("tr")).toHaveTextContent("Ship by");
    expect(screen.getByText("Arcane Signet").closest("tr")).toHaveTextContent("Shipped: reserved until settled");
  });

  it("shows each customer's record and lets the owner require a deposit or pause their trades", async () => {
    const user = userEvent.setup();
    const cy = {
      userId: "u-cy",
      name: "Cy Ho",
      email: "cy@example.com",
      lastTradeAt: "2026-10-20T12:00:00Z",
      record: record({ completedTrades: 1, onTimeShipments: 1, missedDeadlines: 2, recentFaults: 2 }),
      privileges: privileges({ reliabilityDeposit: true, overAbandonLimit: true }),
    };
    repo.customers.mockResolvedValue({ customers: [cy], settings: TRADE_SETTINGS, owner: true });
    renderPage("tab=customers");
    const row = (await screen.findByText("Cy Ho")).closest("tr")!;
    expect(row).toHaveTextContent("New customer");
    expect(row).toHaveTextContent("Deposit required");
    expect(row).toHaveTextContent("33%");
    await user.click(row);
    const dialog = await screen.findByRole("dialog", { name: "Cy Ho" });
    expect(dialog).toHaveTextContent("Over the abandonment limit: a deposit on every trade");
    await user.click(within(dialog).getByLabelText("No new trades for now (trades already started carry on)"));
    await user.type(within(dialog).getByLabelText("Note (staff only)"), "Two no-shows");
    repo.setCustomerFlags.mockResolvedValue({ customers: [{ ...cy, record: { ...cy.record, blocked: true } }], userId: "u-cy", settings: TRADE_SETTINGS, owner: true });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(repo.setCustomerFlags).toHaveBeenCalledWith("u-cy", { depositRequired: false, blocked: true, note: "Two no-shows" }));
  });
});

describe("the Economics tab", () => {
  it("adds up what finished trades did to inventory value, by period, and opens a trade", async () => {
    const user = userEvent.setup();
    const totals = {
      trades: 2,
      incomingMarketCents: 43750,
      outgoingRetailCents: 35000,
      grossDifferenceCents: 8750,
      shippingChargedCents: 399,
      shippingCostCents: 1110,
      estimatedShipments: 1,
      netShippingCents: 711,
      adjustedDifferenceCents: 8039,
      averageOutgoingCents: 17500,
      acceptedSingles: 5,
      uniqueListings: 3,
    };
    const row = {
      id: "t-a",
      tradeNumber: 1007,
      status: "completed",
      customerName: "Ann Lee",
      customerEmail: "ann@example.com",
      paidAt: "2026-10-24T12:00:00Z",
      creditRatePercent: 80,
      economics: {
        incomingMarketCents: 25000,
        outgoingRetailCents: 20000,
        grossDifferenceCents: 5000,
        shippingChargedCents: 0,
        shippingCostCents: 600,
        shippingCostSource: "estimate",
        netShippingCents: 600,
        adjustedDifferenceCents: 4400,
      },
    };
    repo.economics.mockResolvedValue({ days: 90, totals, trades: [row], settings: TRADE_SETTINGS, owner: true });
    repo.get.mockResolvedValue({ trade: staffTrade({ id: "t-a", tradeNumber: 1001 }), settings: TRADE_SETTINGS, owner: true });
    renderPage("tab=economics");
    expect(await screen.findByText("Net change in retail-priced inventory")).toBeInTheDocument();
    expect(repo.economics).toHaveBeenCalledWith(90);
    expect(screen.getByText("Net change in retail-priced inventory").parentElement?.parentElement).toHaveTextContent("+$87.50");
    expect(screen.getByText("After shipping", { selector: ".gg-stat__label" }).parentElement?.parentElement).toHaveTextContent("+$80.39");
    expect(screen.getByText("Trades finished").parentElement?.parentElement).toHaveTextContent("Average $175.00 of our cards");
    expect(screen.getByText("Singles taken worth $15.00+").parentElement?.parentElement).toHaveTextContent("3 different listings");
    expect(screen.getByText(/Theoretical inventory-value differences/)).toHaveTextContent("1 of 2 shipments counted at the $6.00 estimate");
    const line = screen.getByText("TR-1007").closest("tr")!;
    expect(line).toHaveTextContent("+$44.00");
    expect(line).toHaveTextContent("estimated");
    await user.click(screen.getByRole("tab", { name: "All time" }));
    await waitFor(() => expect(repo.economics).toHaveBeenLastCalledWith(null));
    await user.click(await screen.findByText("TR-1007"));
    await waitFor(() => expect(repo.get).toHaveBeenCalledWith("t-a"));
  });

  it("says so when no trades finished in the period", async () => {
    const zero = {
      trades: 0,
      incomingMarketCents: 0,
      outgoingRetailCents: 0,
      grossDifferenceCents: 0,
      shippingChargedCents: 0,
      shippingCostCents: 0,
      estimatedShipments: 0,
      netShippingCents: 0,
      adjustedDifferenceCents: 0,
      averageOutgoingCents: 0,
      acceptedSingles: 0,
      uniqueListings: 0,
    };
    repo.economics.mockResolvedValue({ days: 90, totals: zero, trades: [], settings: TRADE_SETTINGS, owner: true });
    renderPage("tab=economics");
    expect(await screen.findByText("No finished trades in this period")).toBeInTheDocument();
  });
});

describe("settings", () => {
  async function openSettings(owner = true, settings = TRADE_SETTINGS) {
    repo.settings.mockResolvedValue({ settings, owner });
    renderPage("tab=settings");
    return screen.findByText("Emergency pause");
  }

  it("saves the trade terms (the owner)", async () => {
    const user = userEvent.setup();
    await openSettings();
    const save = screen.getByRole("button", { name: "Save settings" });
    expect(save).toBeDisabled();
    const rate = screen.getByLabelText("Store credit rate (%)");
    await user.clear(rate);
    await user.type(rate, "75");
    repo.saveSettings.mockResolvedValue({ settings: { ...TRADE_SETTINGS, creditRatePercent: 75 }, owner: true });
    await user.click(save);
    await waitFor(() => expect(repo.saveSettings).toHaveBeenCalled());
    expect(repo.saveSettings.mock.calls[0][0]).toMatchObject({
      creditRatePercent: 75,
      minCardValueCents: 1500,
      conditionPercents: { NM: 100, LP: 90, MP: 75, HP: 60, DMG: 40 },
      shipTo: { line1: "100 Test Ave", city: "Ballwin", state: "MO", postalCode: "63011" },
    });
    expect(await screen.findByText("Trade settings saved.")).toBeInTheDocument();
    expect(repo.list).toHaveBeenCalledTimes(2); // the banner shows the new terms
  });

  it("pauses new trades at once, keeping everything else as saved", async () => {
    const user = userEvent.setup();
    await openSettings();
    await user.clear(screen.getByLabelText("Store credit rate (%)"));
    await user.type(screen.getByLabelText("Store credit rate (%)"), "50"); // not saved: the pause doesn't take it
    repo.saveSettings.mockResolvedValue({ settings: { ...TRADE_SETTINGS, paused: true }, owner: true });
    await user.click(screen.getByRole("button", { name: "Pause new trades now" }));
    await waitFor(() => expect(repo.saveSettings).toHaveBeenCalled());
    expect(repo.saveSettings.mock.calls[0][0]).toMatchObject({ paused: true, enabled: true, creditRatePercent: 80 });
    expect(await screen.findByRole("button", { name: "Resume new trades" })).toBeInTheDocument();
  });

  it("copies the store's return address into the form without saving it", async () => {
    const user = userEvent.setup();
    await openSettings(true, { ...TRADE_SETTINGS, enabled: false, shipTo: null });
    expect(screen.getByLabelText("Street")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Use the store’s return address" }));
    expect(screen.getByLabelText("Street")).toHaveValue("390 Newbury Dr.");
    expect(screen.getByLabelText("ZIP code")).toHaveValue("63011");
    expect(repo.saveSettings).not.toHaveBeenCalled();
  });

  it("won't turn trading on without the mailing address", async () => {
    const user = userEvent.setup();
    await openSettings(true, { ...TRADE_SETTINGS, enabled: false, shipTo: null });
    await user.click(screen.getByLabelText(/Take online trades/));
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Add the address customers mail their cards to before turning trading on.")).toBeInTheDocument();
    expect(repo.saveSettings).not.toHaveBeenCalled();
  });

  it("sets deposits, keeping them, the terms (a new version when the text changes) and days that don't count", async () => {
    const user = userEvent.setup();
    await openSettings();
    expect(screen.getByText(/check the consumer-protection rules that apply to you and Stripe’s rules/)).toBeInTheDocument();
    expect(screen.getByText(/Approved right now, a trade must be confirmed by/)).toBeInTheDocument();
    const terms = screen.getByLabelText("Deposit and cancellation terms");
    await user.type(terms, " Questions? Ask us.");
    expect(screen.getByText(/Saving makes this version 2\./)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Allow keeping a deposit/));
    await user.type(screen.getByLabelText("Days that don't count (besides Sundays)"), "2026-12-25{enter}2026-11-26");
    const threshold = screen.getByLabelText("Required from, our cards ($)");
    await user.clear(threshold);
    await user.type(threshold, "250");
    repo.saveSettings.mockResolvedValue({ settings: { ...TRADE_SETTINGS, depositTermsVersion: 2 }, owner: true });
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(repo.saveSettings).toHaveBeenCalled());
    expect(repo.saveSettings.mock.calls[0][0]).toMatchObject({
      allowForfeiture: true,
      depositThresholdCents: 25000,
      excludedDates: ["2026-11-26", "2026-12-25"],
      depositTerms: `${TRADE_SETTINGS.depositTerms} Questions? Ask us.`,
    });
  });

  it("sets the minimum trade and shipping our cards, with the tiers spelled out", async () => {
    const user = userEvent.setup();
    await openSettings(true, { ...TRADE_SETTINGS, minTradeValueCents: 7500 });
    expect(screen.getByText("Under $75.00: can't start a trade · $75.00 to $199.99: $3.99 · $200.00 or more: free")).toBeInTheDocument();
    const fee = screen.getByLabelText("Shipping under the free-shipping threshold ($)");
    await user.clear(fee);
    await user.type(fee, "4.49");
    const estimate = screen.getByLabelText("What shipping our cards costs us ($)");
    await user.clear(estimate);
    await user.type(estimate, "6.50");
    expect(screen.getByText(/\$75\.00 to \$199\.99: \$4\.49/)).toBeInTheDocument();
    repo.saveSettings.mockResolvedValue({ settings: { ...TRADE_SETTINGS, minTradeValueCents: 7500, shipFeeCents: 449, shipCostEstimateCents: 650 }, owner: true });
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(repo.saveSettings).toHaveBeenCalled());
    expect(repo.saveSettings.mock.calls[0][0]).toMatchObject({
      minTradeValueCents: 7500,
      shipFeeCents: 449,
      freeShipThresholdCents: 20000,
      freeShipFeeCents: 0,
      shipCostEstimateCents: 650,
    });
  });

  it("won't let free shipping start below the minimum, or cost more from the threshold up", async () => {
    const user = userEvent.setup();
    await openSettings(true, { ...TRADE_SETTINGS, minTradeValueCents: 7500 });
    const threshold = screen.getByLabelText("Free shipping from, our cards ($)");
    await user.clear(threshold);
    await user.type(threshold, "50");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Free shipping has to start at or above the minimum trade.")).toBeInTheDocument();
    await user.clear(threshold);
    await user.type(threshold, "200");
    const upper = screen.getByLabelText("Shipping from the threshold up ($)");
    await user.clear(upper);
    await user.type(upper, "5");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Shipping from the free-shipping threshold up can't cost more than below it.")).toBeInTheDocument();
    expect(repo.saveSettings).not.toHaveBeenCalled();
  });

  it("refuses deposit bands that don't go up", async () => {
    const user = userEvent.setup();
    await openSettings();
    const second = screen.getAllByLabelText("Then under ($)")[0];
    await user.clear(second);
    await user.type(second, "50");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Deposit bands have to go up: each one starts where the last ends.")).toBeInTheDocument();
    expect(repo.saveSettings).not.toHaveBeenCalled();
  });

  it("is read-only for staff who aren't the owner", async () => {
    await openSettings(false);
    expect(screen.getByText("Only the store owner can change trade settings.")).toBeInTheDocument();
    expect(screen.getByLabelText("Store credit rate (%)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pause new trades now" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
  });
});

describe("local pickup trades", () => {
  const LOCAL = { handoffMethod: "local" as const, estimatedValueCents: 0, offered: [] };

  it("approves without a card review or deposit, with where to meet", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({ ...LOCAL, status: "pending_review", customerNote: "Weekends work" });
    repo.approve.mockResolvedValue(answer(staffTrade({ ...LOCAL, status: "awaiting_shipment", shipBy: null })));
    const dialog = await openTrade(trade);
    expect(within(dialog).getByText("Local pickup")).toBeInTheDocument();
    const panel = within(dialog).getByRole("heading", { name: "Review this local pickup trade" }).closest("section")!;
    expect(panel).toHaveTextContent("Approving takes our cards off sale and holds them until you finish or cancel the trade, with no deadline");
    expect(panel).not.toHaveTextContent(/to confirm\./);
    expect(panel).toHaveTextContent("about $111.24 at TCG low covers ours at 80%");
    expect(within(dialog).queryByRole("combobox", { name: "Deposit" })).toBeNull();
    await user.type(within(panel).getByLabelText("Where and when to meet (optional)"), "Sat 2 PM, Ballwin library");
    await user.click(within(panel).getByRole("button", { name: "Approve and email the customer" }));
    await waitFor(() => expect(repo.approve).toHaveBeenCalledWith(TRADE_ID, { conditions: "", meetupDetails: "Sat 2 PM, Ballwin library" }));
    expect(await screen.findByText("Approved: our cards are held until you finish the trade.")).toBeInTheDocument();
  });

  it("takes a card the customer changed their mind on off a held local trade, back on sale", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      ...LOCAL,
      status: "awaiting_shipment",
      shipBy: null,
      wanted: [
        wantedItem({ status: "reserved" }),
        wantedItem({ id: "w2", inventoryItemId: "i2", cardName: "Arcane Signet", quantity: 2, unitPriceCents: 450, status: "reserved" }),
      ],
    });
    const dialog = await openTrade(trade);
    repo.setWanted.mockResolvedValue(answer(trade));
    const signet = within(dialog).getByText("Arcane Signet", { selector: ".gg-trd-card__name" }).closest("li")!;
    await user.click(within(signet).getByRole("button", { name: "Take off the trade" }));
    expect(signet).toHaveTextContent("It goes back on sale.");
    await user.click(within(signet).getByRole("button", { name: "Take it off" }));
    await waitFor(() => expect(repo.setWanted).toHaveBeenLastCalledWith(TRADE_ID, [{ inventoryItemId: "i1", quantity: 1 }]));
    // Or keep fewer of it.
    await user.selectOptions(within(dialog).getByLabelText("How many Arcane Signet"), "1");
    await waitFor(() =>
      expect(repo.setWanted).toHaveBeenLastCalledWith(TRADE_ID, [
        { inventoryItemId: "i1", quantity: 1 },
        { inventoryItemId: "i2", quantity: 1 },
      ]),
    );
  });

  it("finishes at the meetup: the cards taken, what they paid, and the trade complete", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      ...LOCAL,
      status: "awaiting_shipment",
      shipBy: null,
      meetupDetails: "Sat 2 PM, Ballwin library",
      wanted: [wantedItem({ status: "reserved" })],
      // Listed before they switched to local pickup: a starting point.
      offered: [staffCard({ id: "o1", quantity: 1, reportedCondition: "NM", estimatedUnitCents: 8000, referencePriceCents: 8000 })],
    });
    repo.completeLocal.mockResolvedValue(answer(staffTrade({ ...LOCAL, status: "completed" })));
    const dialog = await openTrade(trade);
    // Held until it's finished: no deadline, nothing to extend.
    expect(within(dialog).queryByText("Hold ends:")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Give more time/ })).toBeNull();
    expect(within(dialog).getByText(/Our cards are held until you finish or cancel this trade/)).toBeInTheDocument();
    expect(within(dialog).getByText("Sat 2 PM, Ballwin library")).toBeInTheDocument();
    const panel = within(dialog).getByRole("heading", { name: "At the meetup" }).closest("section")!;
    // $80.00 of theirs: $64.00 credit against $88.99 of ours, so they pay $24.99.
    expect(panel).toHaveTextContent("They pay you now$24.99");
    const finish = within(panel).getByRole("button", { name: "Finish the trade" });
    expect(finish).toBeDisabled();

    await user.selectOptions(within(panel).getByLabelText("Condition"), "LP");
    const price = within(panel).getByLabelText("TCG low each for Sheoldred, the Apocalypse");
    await user.clear(price);
    await user.type(price, "75.00");
    expect(panel).toHaveTextContent("They pay you now$28.99");
    await user.click(within(panel).getByRole("button", { name: "Cash" }));
    await user.click(within(panel).getByRole("checkbox", { name: /The customer agreed to these values, paid, and we swapped cards/ }));
    await user.click(finish);
    await waitFor(() =>
      expect(repo.completeLocal).toHaveBeenCalledWith(TRADE_ID, {
        cards: [
          expect.objectContaining({ cardName: "Sheoldred, the Apocalypse", condition: "LP", quantity: 1, unitCents: 7500, finish: "nonfoil" }),
        ],
        paidCents: 2899,
        paymentMethod: "cash",
        paymentNote: "",
        cashForExcess: false,
      }),
    );
  });

  it("saves the TCG lows entered at the meetup, and starts from them next time", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      ...LOCAL,
      status: "awaiting_shipment",
      shipBy: null,
      wanted: [wantedItem({ status: "reserved" })],
      offered: [staffCard({ id: "o1", quantity: 1, reportedCondition: "NM", estimatedUnitCents: 8000, referencePriceCents: 8000 })],
    });
    const dialog = await openTrade(trade);
    const panel = within(dialog).getByRole("heading", { name: "At the meetup" }).closest("section")!;
    const save = within(panel).getByRole("button", { name: "Save prices" });
    expect(panel).toHaveTextContent("Unsaved changes");

    await user.selectOptions(within(panel).getByLabelText("Condition"), "LP");
    const price = within(panel).getByLabelText("TCG low each for Sheoldred, the Apocalypse");
    await user.clear(price);
    await user.type(price, "75.00");
    const savedAt = "2026-10-31T07:30:00.000Z";
    repo.saveMeetupDraft.mockResolvedValue(
      answer({
        ...trade,
        meetupDraft: {
          savedAt,
          savedBy: "jacob@geega-games.com",
          cards: [{ scryfallId: null, cardName: "Sheoldred, the Apocalypse", setCode: "DMU", setName: null, collectorNumber: "107", finish: "nonfoil", imageUrl: null, condition: "LP", quantity: 1, unitCents: 7500, referencePriceCents: 8000 }],
        },
      }),
    );
    await user.click(save);
    await waitFor(() =>
      expect(repo.saveMeetupDraft).toHaveBeenCalledWith(TRADE_ID, [
        expect.objectContaining({ cardName: "Sheoldred, the Apocalypse", condition: "LP", quantity: 1, unitCents: 7500 }),
      ]),
    );
    expect(await within(panel).findByText(/Saved .* by jacob@geega-games\.com/)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Save prices" })).toBeDisabled();
    // A change makes it savable again.
    await user.clear(price);
    await user.type(price, "70");
    expect(panel).toHaveTextContent("Unsaved changes");
    expect(within(panel).getByRole("button", { name: "Save prices" })).toBeEnabled();
  });

  it("opens the meetup from the saved prices, including a card not priced yet", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({
      ...LOCAL,
      status: "awaiting_shipment",
      shipBy: null,
      wanted: [wantedItem({ status: "reserved" })],
      offered: [staffCard({ id: "o1", quantity: 1, reportedCondition: "NM", estimatedUnitCents: 8000, referencePriceCents: 8000 })],
      meetupDraft: {
        savedAt: "2026-10-31T07:30:00.000Z",
        savedBy: "jacob@geega-games.com",
        cards: [
          { scryfallId: null, cardName: "Sheoldred, the Apocalypse", setCode: "DMU", setName: null, collectorNumber: "107", finish: "nonfoil", imageUrl: null, condition: "LP", quantity: 1, unitCents: 7500, referencePriceCents: 8000 },
          { scryfallId: null, cardName: "Llanowar Elves", setCode: "DOM", setName: null, collectorNumber: "168", finish: "foil", imageUrl: null, condition: "NM", quantity: 2, unitCents: null, referencePriceCents: null },
        ],
      },
    });
    const dialog = await openTrade(trade);
    const panel = within(dialog).getByRole("heading", { name: "At the meetup" }).closest("section")!;
    expect(within(panel).getByLabelText("TCG low each for Sheoldred, the Apocalypse")).toHaveValue("75.00");
    expect(within(panel).getByLabelText("TCG low each for Llanowar Elves")).toHaveValue("");
    expect(panel).toHaveTextContent(/Saved .* by jacob@geega-games\.com/);
    expect(within(panel).getByRole("button", { name: "Save prices" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Finish the trade" })).toBeDisabled();

    // A price that isn't an amount isn't saved.
    await user.type(within(panel).getByLabelText("TCG low each for Llanowar Elves"), "abc");
    await user.click(within(panel).getByRole("button", { name: "Save prices" }));
    expect(await screen.findByText(/Llanowar Elves: enter the TCG low as an amount/)).toBeInTheDocument();
    expect(repo.saveMeetupDraft).not.toHaveBeenCalled();
  });

  it("updates the meetup and releases a hold without counting it against them by default", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({ ...LOCAL, status: "awaiting_shipment", shipBy: "2099-01-01T05:59:59.000Z", wanted: [wantedItem({ status: "reserved" })] });
    repo.setMeetup.mockResolvedValue(answer(trade));
    repo.expireNow.mockResolvedValue(answer(staffTrade({ ...LOCAL, status: "expired" })));
    const dialog = await openTrade(trade);
    await user.click(within(dialog).getByRole("button", { name: "Set where and when" }));
    await user.type(within(dialog).getByLabelText("Where and when to meet"), "Sunday noon, the cafe");
    await user.click(within(dialog).getByRole("button", { name: "Save the meetup" }));
    await waitFor(() => expect(repo.setMeetup).toHaveBeenCalledWith(TRADE_ID, "Sunday noon, the cafe"));

    await user.click(within(dialog).getByRole("button", { name: "Release the reservation…" }));
    expect(within(dialog).getByRole("checkbox", { name: /didn.t show up/ })).not.toBeChecked();
    await user.type(within(dialog).getByLabelText(/Why \(the customer is emailed this\)/), "Couldn't find a time");
    await user.click(within(dialog).getByRole("button", { name: "Release our cards" }));
    await waitFor(() => expect(repo.expireNow).toHaveBeenCalledWith(TRADE_ID, { reason: "Couldn't find a time", countAgainst: false }));
  });

  it("warns about a customer who'd need a deposit, and leaves finishing to the owner", async () => {
    const flagged = staffTrade({ ...LOCAL, status: "pending_review", customerRecord: record({ depositRequired: true }), privileges: privileges() });
    let dialog = await openTrade(flagged);
    expect(dialog).toHaveTextContent("This customer would need a deposit on a shipped trade");
    cleanup();
    const meet = staffTrade({ ...LOCAL, status: "awaiting_shipment", wanted: [wantedItem({ status: "reserved" })] });
    dialog = await openTrade(meet, { owner: false });
    expect(dialog).toHaveTextContent("Only the store owner can finish a trade at the meetup");
    expect(within(dialog).getByRole("button", { name: "Finish the trade" })).toBeDisabled();
  });

  it("marks local trades in the list", async () => {
    repo.list.mockResolvedValue({
      trades: [tradeSummary({ handoffMethod: "local", status: "awaiting_shipment", shipBy: "2099-01-01T05:59:59.000Z" })],
      counts: { waiting: 1, local: 1 },
      settings: TRADE_SETTINGS,
      owner: true,
    });
    renderPage();
    const row = (await screen.findAllByText("TR-1001"))[0].closest("tr")!;
    expect(row).toHaveTextContent("Local");
    expect(row).toHaveTextContent("Reserved: meet up");
    expect(row).toHaveTextContent("at the meetup");
  });
});
