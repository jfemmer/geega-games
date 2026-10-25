// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import { NAV_ITEMS, SECTION_TITLES } from "../src/admin/components/layout/nav";
import { NAV_BADGES } from "../src/admin/utils/navBadges";
import type { StaffTrade, TradeSettings } from "../src/store/lib/tradeCenter";
import { TRADE_ID, TRADE_SETTINGS, staffCard, staffTrade, tradeSummary, wantedItem } from "./helpers/tradeFixtures";

// Admin → Trades: the list of online trades, each trade's drawer at every
// step (review, receiving, inspection and the final offer, payment, wrapping
// up), and the trade settings. The repository is a stand-in: these tests are
// about what staff see and exactly what each button sends.

const repo = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
  review: vi.fn(),
  requestRevision: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  extend: vi.fn(),
  markReceived: vi.fn(),
  inspect: vi.fn(),
  confirmAsDescribed: vi.fn(),
  sendFinalOffer: vi.fn(),
  reopenInspection: vi.fn(),
  setWanted: vi.fn(),
  markReturned: vi.fn(),
  importCard: vi.fn(),
  recordPayment: vi.fn(),
  markCashPaid: vi.fn(),
  message: vi.fn(),
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
    trades: [tradeSummary(), tradeSummary({ id: "t-2", tradeNumber: 998, status: "in_transit", customerName: "Bo Diaz", approvedValueCents: 21500, inboundShippedAt: "2026-10-23T12:00:00Z" })],
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
    expect(repo.list).toHaveBeenLastCalledWith("waiting", "");
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Trading is open: 80% store credit on cards worth $15.00 or more.");
    const row = screen.getByText("TR-1001").closest("tr")!;
    expect(row).toHaveTextContent("Ann Lee");
    expect(row).toHaveTextContent("$160.00estimate");
    expect(within(row).getAllByText("To review").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("tab", { name: /^Open/ }));
    await waitFor(() => expect(repo.list).toHaveBeenLastCalledWith("open", ""));
    await user.type(screen.getByLabelText("Search trades"), "ann");
    await waitFor(() => expect(repo.list).toHaveBeenLastCalledWith("open", "ann"));
    await user.selectOptions(screen.getByLabelText("Status"), "in_transit");
    await waitFor(() => expect(repo.list).toHaveBeenLastCalledWith("in_transit", "ann"));
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
  it("decides every card, then saves the review and approves in one go", async () => {
    const user = userEvent.setup();
    const dialog = await openTrade(REVIEW);
    expect(within(dialog).getByText("Approve or reject every card first (3 left).")).toBeInTheDocument();
    const approve = within(dialog).getByRole("button", { name: "Approve and email the customer" });
    expect(approve).toBeDisabled();

    // The two with a market price at their estimates; the Mox needs a value by hand.
    await user.click(within(dialog).getByRole("button", { name: "Approve the rest at their estimates" }));
    expect(within(dialog).getByText("Approve or reject every card first (1 left).")).toBeInTheDocument();
    await user.click(within(within(dialog).getByRole("group", { name: "Decision for Mox Diamond" })).getByRole("button", { name: "Approve" }));
    await user.type(within(dialog).getByLabelText("Value each for Mox Diamond"), "380");
    await user.selectOptions(within(dialog).getByLabelText("How many Ragavan, Nimble Pilferer to approve"), "1");
    // $80 + $46.80 + $380 approved → $405.44 credit, more than our $88.99 of cards.
    const preview = within(dialog).getByText("Approved value").closest("dl")!;
    expect(within(preview).getByText("Approved value").nextElementSibling).toHaveTextContent("$506.80");
    expect(within(preview).getByText("Store credit left over").nextElementSibling).toHaveTextContent("$316.45");

    repo.review.mockResolvedValue(answer(REVIEW));
    repo.approve.mockResolvedValue({ ...answer(staffTrade({ status: "awaiting_shipment", offered: APPROVED })), customerEmail: { status: "sent" } });
    await user.type(within(dialog).getByLabelText("Conditions (optional)"), "Mox must be the Stronghold printing");
    await user.click(within(dialog).getByRole("button", { name: "Save the review and approve" }));
    await waitFor(() => expect(repo.approve).toHaveBeenCalled());
    expect(repo.review).toHaveBeenCalledWith(TRADE_ID, [
      { id: "o1", reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 8000, reviewNote: null, internalNote: null },
      { id: "o2", reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 4680, reviewNote: null, internalNote: null },
      { id: "o4", reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 38000, reviewNote: null, internalNote: null },
    ]);
    // The usual ship-by date is the server's: none is sent unless staff pick one.
    expect(repo.approve).toHaveBeenCalledWith(TRADE_ID, { conditions: "Mox must be the Stronghold printing" });
    expect(await screen.findByText("Approved: they can ship their cards now. The customer was emailed.")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark the package received" })).toBeInTheDocument();
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
    const dialog = await openTrade(staffTrade({ status: "in_transit", offered: APPROVED, inboundCarrier: "USPS", inboundTracking: "9400111899223197428490" }));
    expect(within(dialog).getByRole("link", { name: "9400111899223197428490" })).toHaveAttribute("href", expect.stringContaining("usps.com"));
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
    expect(within(ragavan).getByLabelText("Value each")).toHaveValue("39.00"); // $46.80 at 75/90
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

    // $80 + $39 = $119 of cards → $95.20 credit, against $88.99 of ours (free shipping): $6.21 left.
    const final = within(dialog).getByText("Final offer").closest("div")!;
    await waitFor(() => expect(within(final).getByText("Store credit left over").nextElementSibling).toHaveTextContent("$6.21"));
    expect(within(final).getByText("Trade credit at 80%").nextElementSibling).toHaveTextContent("$95.20");
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
    await waitFor(() => expect(repo.importCard).toHaveBeenCalledWith("o1", 8000, "Binder 3"));

    repo.markCashPaid.mockResolvedValue(answer({ ...trade, cashPaidAt: "2026-10-25T15:00:00Z" }));
    await user.type(within(dialog).getByLabelText("How you paid (optional)"), "Venmo");
    await user.click(within(dialog).getByRole("button", { name: "Mark the cash paid" }));
    await waitFor(() => expect(repo.markCashPaid).toHaveBeenCalledWith(TRADE_ID, "Venmo"));

    // One Ragavan arrived that we didn't take.
    const mailBack = within(dialog).getByText("Mail their cards back").closest("section")!;
    expect(mailBack).toHaveTextContent("1 × Ragavan, Nimble Pilferer");
    expect(mailBack).not.toHaveTextContent("Mox Diamond");
    repo.markReturned.mockResolvedValue(answer({ ...trade, returnedAt: "2026-10-25T16:00:00Z" }));
    await user.type(within(mailBack).getByLabelText("Tracking number (optional)"), "9400 1118 9922 3197 4284 90");
    await user.click(within(mailBack).getByRole("button", { name: "Mark returned and email the customer" }));
    await waitFor(() => expect(repo.markReturned).toHaveBeenCalledWith(TRADE_ID, { carrier: "USPS", trackingNumber: "9400 1118 9922 3197 4284 90" }));
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

  it("gives more time on the current deadline", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({ status: "awaiting_shipment", offered: APPROVED, shipBy: "2099-10-30T04:59:59Z", holdExpiresAt: "2099-10-31T04:59:59Z" });
    const dialog = await openTrade(trade);
    repo.extend.mockResolvedValue(answer(trade));
    await user.selectOptions(within(dialog).getByLabelText("Extend by"), "72");
    await user.click(within(dialog).getByRole("button", { name: "Give more time" }));
    await waitFor(() => expect(repo.extend).toHaveBeenCalledWith(TRADE_ID, 72));
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

  it("rejects a trade whose cards are on their way: they go back", async () => {
    const user = userEvent.setup();
    const trade = staffTrade({ status: "in_transit", offered: APPROVED });
    const dialog = await openTrade(trade);
    expect(within(dialog).getByText(/their cards go back to them/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Reject the trade…" }));
    repo.reject.mockResolvedValue(answer({ ...trade, status: "return_pending", closeReason: "Changed our mind" }));
    await user.type(within(dialog).getByLabelText("Reason for the customer"), "Changed our mind");
    await user.click(within(dialog).getByRole("button", { name: "Reject the trade" }));
    await waitFor(() => expect(repo.reject).toHaveBeenCalledWith(TRADE_ID, "Changed our mind"));
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

  it("is read-only for staff who aren't the owner", async () => {
    await openSettings(false);
    expect(screen.getByText("Only the store owner can change trade settings.")).toBeInTheDocument();
    expect(screen.getByLabelText("Store credit rate (%)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pause new trades now" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
  });
});
