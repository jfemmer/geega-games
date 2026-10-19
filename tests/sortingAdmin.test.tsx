// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import type { SortingQuoteAdmin, SortingRequestDetail } from "../src/admin/types";

// Admin → Collection Sorting: the itemized quote (sorting service, return
// shipping, return packaging, other agreed charges, and a final total that's
// always their sum), what an approved total means for a revision, payments
// taken in person, and the rates.

const repo = vi.hoisted(() => ({
  saveDraft: vi.fn(),
  sendQuote: vi.fn(),
  discardDraft: vi.fn(),
  recordPayment: vi.fn(),
  listOptions: vi.fn(),
  createOption: vi.fn(),
  updateOption: vi.fn(),
  deleteOption: vi.fn(),
}));
vi.mock("../src/admin/repositories/sorting.supabase", () => ({ sortingRepository: repo }));

const { SortingQuotePanel } = await import("../src/admin/pages/sorting/SortingQuotePanel");
const { SortingPaymentsPanel } = await import("../src/admin/pages/sorting/SortingPaymentsPanel");
const { SortingRatesPanel } = await import("../src/admin/pages/sorting/SortingRatesPanel");

function quote(overrides: Partial<SortingQuoteAdmin> = {}): SortingQuoteAdmin {
  return {
    id: "q1",
    version: 1,
    status: "accepted",
    countedCards: 3200,
    sortingServiceCents: 6400,
    returnShippingCents: 1850,
    returnPackagingCents: 400,
    otherCharges: [],
    totalCents: 8650,
    noteToCustomer: null,
    createdAt: "2026-10-18T10:00:00Z",
    updatedAt: "2026-10-18T10:00:00Z",
    sentAt: "2026-10-18T12:00:00Z",
    acceptedAt: "2026-10-18T13:00:00Z",
    declinedAt: null,
    declineReason: null,
    supersededAt: null,
    ...overrides,
  };
}

function detail(overrides: Partial<SortingRequestDetail> = {}): SortingRequestDetail {
  return {
    id: "req-1",
    referenceNumber: "GG-SR-1001",
    createdAt: "2026-10-17T12:00:00Z",
    firstName: "Ann",
    lastName: "Lee",
    email: "ann@example.com",
    deliveryMethod: "ship",
    optionName: "Sort by set",
    estimatedCards: 3000,
    countedCards: 3200,
    status: "received",
    acceptedQuoteId: null,
    amountPaidCents: 0,
    userId: null,
    phone: null,
    ratePerThousandCents: 2000,
    estimatedSortingCents: 6000,
    customerNotes: null,
    internalNotes: null,
    statusChangedAt: "2026-10-18T09:00:00Z",
    returnAddress: { recipient: "Ann Lee", line1: "1 Main St", line2: null, city: "Ballwin", state: "MO", postalCode: "63011" },
    shippingTermsAcceptedAt: "2026-10-17T12:00:00Z",
    shippingTermsText: "I understand…",
    returnCarrier: null,
    returnTrackingNumber: null,
    receivedAt: "2026-10-18T09:00:00Z",
    returnedAt: null,
    cancelledAt: null,
    quotes: [],
    payments: [],
    ...overrides,
  };
}

function wrap(node: React.ReactNode) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

beforeEach(() => {
  for (const fn of Object.values(repo)) fn.mockReset();
  repo.saveDraft.mockResolvedValue({ quoteId: "q-draft" });
  repo.sendQuote.mockResolvedValue({ emailed: true });
  repo.recordPayment.mockResolvedValue({ emailed: true });
  repo.listOptions.mockResolvedValue([]);
  repo.createOption.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("the quote editor", () => {
  it("totals the items itself, and sends the quote only after a confirmation", async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    wrap(<SortingQuotePanel detail={detail()} onChanged={onChanged} />);
    await user.click(screen.getByRole("button", { name: "Start the quote" }));

    // Prefilled from the count and the rate the customer saw: 3,200 × $20.00 / 1,000.
    expect(screen.getByLabelText("Sorting service cost ($)")).toHaveValue("64.00");
    await user.type(screen.getByLabelText("Return shipping charge ($)"), "18.50");
    await user.type(screen.getByLabelText("Return packaging & supplies ($)"), "4");
    await user.click(screen.getByRole("button", { name: "Add a charge" }));
    await user.type(screen.getByLabelText("Description 1"), "Rush");
    await user.type(screen.getByLabelText("Amount ($)"), "5");
    expect(screen.getByText("Final quoted total").nextSibling).toHaveTextContent("$91.50");

    await user.click(screen.getByRole("button", { name: "Send to customer" }));
    const dialog = await screen.findByRole("dialog", { name: "Send this quote?" });
    expect(dialog).toHaveTextContent("Email a quote of $91.50 to ann@example.com?");
    expect(repo.saveDraft).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Send quote" }));

    await waitFor(() => expect(repo.sendQuote).toHaveBeenCalledWith("req-1", "q-draft"));
    expect(repo.saveDraft).toHaveBeenCalledWith("req-1", {
      items: {
        sortingServiceCents: 6400,
        returnShippingCents: 1850,
        returnPackagingCents: 400,
        otherCharges: [{ label: "Rush", amountCents: 500 }],
      },
      countedCards: 3200,
      noteToCustomer: "",
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("won't save an amount it can't read", async () => {
    const user = userEvent.setup();
    wrap(<SortingQuotePanel detail={detail()} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Start the quote" }));
    await user.type(screen.getByLabelText("Return shipping charge ($)"), "about 20");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/return shipping charge/i);
    expect(repo.saveDraft).not.toHaveBeenCalled();
  });

  it("treats an approved total as binding, and a change as a revision the customer must approve", async () => {
    const user = userEvent.setup();
    wrap(
      <SortingQuotePanel
        detail={detail({ status: "sorting", acceptedQuoteId: "q1", quotes: [quote()] })}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(/Approved total/)).toHaveTextContent(
      "it can only change if they approve a revised quote",
    );
    expect(screen.queryByLabelText("Sorting service cost ($)")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Make a revised quote" }));
    expect(screen.getByText(/Revised quote: it replaces the approved \$86\.50 only if the customer approves it/)).toBeInTheDocument();
    // It starts from what the customer last saw.
    expect(screen.getByLabelText("Return shipping charge ($)")).toHaveValue("18.50");
  });
});

describe("payments", () => {
  it("records an in-person payment up to the balance, after a confirmation", async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    wrap(
      <SortingPaymentsPanel
        detail={detail({ acceptedQuoteId: "q1", quotes: [quote()], amountPaidCents: 5000 })}
        onChanged={onChanged}
      />,
    );
    expect(screen.getByText("Balance due").nextSibling).toHaveTextContent("$36.50");
    const amount = screen.getByLabelText("Amount ($)");
    expect(amount).toHaveValue("36.50");
    await user.clear(amount);
    await user.type(amount, "40");
    expect(screen.getByRole("button", { name: "Record payment" })).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, "36.50");
    await user.selectOptions(screen.getByLabelText("Paid by"), "cash");
    await user.click(screen.getByRole("button", { name: "Record payment" }));
    const dialog = await screen.findByRole("dialog", { name: "Record this payment?" });
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));
    await waitFor(() =>
      expect(repo.recordPayment).toHaveBeenCalledWith("req-1", { amountCents: 3650, method: "cash", note: "" }),
    );
  });

  it("waits for an approved quote", () => {
    wrap(<SortingPaymentsPanel detail={detail()} onChanged={vi.fn()} />);
    expect(screen.getByText(/payments open once the customer approves a quote/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
  });
});

describe("rates", () => {
  it("warns that requests are closed until a rate is shown, and adds one", async () => {
    const user = userEvent.setup();
    wrap(<SortingRatesPanel />);
    expect(await screen.findByText(/No rates are shown, so the sorting page says requests open soon/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a rate" }));
    await user.type(screen.getByLabelText("Name"), "Sort by set");
    await user.type(screen.getByLabelText("Price per 1,000 cards ($)"), "25");
    await user.click(screen.getByRole("button", { name: "Add rate" }));
    await waitFor(() =>
      expect(repo.createOption).toHaveBeenCalledWith({
        name: "Sort by set",
        description: "",
        ratePerThousandCents: 2500,
        sortOrder: 0,
        active: true,
      }),
    );
  });
});
