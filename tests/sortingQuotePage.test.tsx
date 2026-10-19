// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { SortingQuoteView, SortingRequestView } from "../src/store/lib/sortingApi";

// The customer's quote page (/collection-sorting/quote): the itemized quote
// from the email link, approving or declining it, and what an approved total
// means for a revision and for paying.

const api = vi.hoisted(() => ({
  lookup: vi.fn(),
  approve: vi.fn(),
  decline: vi.fn(),
  startPayment: vi.fn(),
  confirmPayment: vi.fn(),
}));
vi.mock("../src/store/lib/sortingApi", () => ({
  lookupSortingRequest: api.lookup,
  approveSortingQuote: api.approve,
  declineSortingQuote: api.decline,
  startSortingPayment: api.startPayment,
  confirmSortingPayment: api.confirmPayment,
}));

const route = vi.hoisted(() => ({ query: new URLSearchParams() }));
vi.mock("../src/store/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useRouter: () => ({ path: "/collection-sorting/quote", query: route.query, navigate: () => {} }),
  matchRoute: () => null,
}));
vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false, signOut: async () => {} }),
}));
vi.mock("../src/store/lib/stripeClient", () => ({ isStripeConfigured: true, getStripePromise: () => null }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: ReactNode }) => <div data-testid="stripe-elements">{children}</div>,
  PaymentElement: () => <div>Card details</div>,
  useStripe: () => null,
  useElements: () => null,
}));

const { default: SortingQuotePage } = await import("../src/store/pages/SortingQuotePage");

function quote(overrides: Partial<SortingQuoteView> = {}): SortingQuoteView {
  return {
    id: "q1",
    version: 1,
    status: "sent",
    countedCards: 3200,
    lines: [
      { key: "sorting", label: "Sorting service (3,200 cards)", amountCents: 6400 },
      { key: "return_shipping", label: "Return shipping", amountCents: 1850 },
      { key: "return_packaging", label: "Return packaging & supplies", amountCents: 400 },
    ],
    totalCents: 8650,
    noteToCustomer: null,
    sentAt: "2026-10-18T12:00:00Z",
    acceptedAt: null,
    declinedAt: null,
    ...overrides,
  };
}

function view(overrides: Partial<SortingRequestView> = {}): SortingRequestView {
  return {
    referenceNumber: "GG-SR-1001",
    firstName: "Ann",
    createdAt: "2026-10-17T12:00:00Z",
    status: "quoted",
    statusLabel: "Quote ready for your approval",
    deliveryMethod: "ship",
    optionName: "Sort by set",
    ratePerThousandCents: 2000,
    estimatedCards: 3000,
    estimatedSortingCents: 6000,
    returnTo: "Ballwin, MO 63011",
    openQuote: quote(),
    acceptedQuote: null,
    latestQuote: quote(),
    amountPaidCents: 0,
    balanceDueCents: 0,
    returnTracking: null,
    canRespond: true,
    payOnline: true,
    ...overrides,
  };
}

beforeEach(() => {
  route.query = new URLSearchParams({ ref: "GG-SR-1001", email: "ann@example.com", t: "tok" });
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(cleanup);

describe("the quote page", () => {
  it("opens the request from the email link and itemizes the quote", async () => {
    api.lookup.mockResolvedValue(view());
    render(<SortingQuotePage />);
    expect(await screen.findByRole("heading", { name: "Sorting request GG-SR-1001" })).toBeInTheDocument();
    expect(api.lookup).toHaveBeenCalledWith({ referenceNumber: "GG-SR-1001", email: "ann@example.com", token: "tok" });
    const card = screen.getByRole("region", { name: "Your quote" });
    expect(within(card).getByText("Return shipping")).toBeInTheDocument();
    expect(within(card).getByText("$18.50")).toBeInTheDocument();
    expect(within(card).getByText("Return packaging & supplies")).toBeInTheDocument();
    expect(within(card).getByText("$86.50")).toBeInTheDocument();
    expect(card).toHaveTextContent(
      "Return shipping and packaging are included in this total. Once you've approved and paid it, we won't charge you anything more for return shipping unless you agree to a change.",
    );
    expect(screen.getByRole("complementary", { name: "Shipping Information" })).toBeInTheDocument();
  });

  it("approves the quote and then offers to pay the balance", async () => {
    api.lookup.mockResolvedValue(view());
    api.approve.mockResolvedValue(
      view({
        status: "approved",
        statusLabel: "Quote approved",
        openQuote: null,
        acceptedQuote: quote({ status: "accepted", acceptedAt: "2026-10-18T13:00:00Z" }),
        balanceDueCents: 8650,
      }),
    );
    const user = userEvent.setup();
    render(<SortingQuotePage />);
    await user.click(await screen.findByRole("button", { name: "Approve $86.50" }));
    expect(api.approve).toHaveBeenCalledWith({ referenceNumber: "GG-SR-1001", email: "ann@example.com", token: "tok" }, "q1");
    expect(await screen.findByText("Thanks — your quote is approved.")).toBeInTheDocument();
    const approved = screen.getByRole("region", { name: "Your approved quote" });
    expect(within(approved).getByText("Approved total")).toBeInTheDocument();
    expect(within(approved).getByRole("button", { name: "Pay $86.50 by card" })).toBeInTheDocument();

    api.startPayment.mockResolvedValue({ kind: "pay", clientSecret: "pi_1_secret", amountDueCents: 8650 });
    await user.click(within(approved).getByRole("button", { name: "Pay $86.50 by card" }));
    expect(await screen.findByText("Card details")).toBeInTheDocument();
  });

  it("explains that a revision only replaces the approved total if they approve it", async () => {
    api.lookup.mockResolvedValue(
      view({
        status: "sorting",
        acceptedQuote: quote({ id: "q1", status: "accepted", totalCents: 8000, acceptedAt: "2026-10-18T13:00:00Z" }),
        openQuote: quote({ id: "q2", version: 2, totalCents: 9150 }),
      }),
    );
    render(<SortingQuotePage />);
    expect(await screen.findByRole("heading", { name: "Your revised quote" })).toBeInTheDocument();
    expect(screen.getByText(/You approved \$80\.00 on .*This revised quote replaces it only if you approve it/)).toBeInTheDocument();
  });

  it("asks for the email link before anyone else can approve", async () => {
    api.lookup.mockResolvedValue(view({ canRespond: false }));
    render(<SortingQuotePage />);
    expect(await screen.findByText(/To approve this quote, open the link in your quote email/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
  });

  it("lets them decline with a reason", async () => {
    api.lookup.mockResolvedValue(view());
    api.decline.mockResolvedValue(view({ openQuote: null, latestQuote: quote({ status: "declined", declinedAt: "2026-10-18T14:00:00Z" }) }));
    const user = userEvent.setup();
    render(<SortingQuotePage />);
    await user.click(await screen.findByRole("button", { name: "Decline" }));
    await user.type(screen.getByLabelText("Want to tell us why? (optional)"), "Too much for me");
    await user.click(screen.getByRole("button", { name: "Decline quote" }));
    expect(api.decline).toHaveBeenCalledWith(expect.objectContaining({ referenceNumber: "GG-SR-1001" }), "q1", "Too much for me");
    expect(await screen.findByText(/You declined our quote on/)).toBeInTheDocument();
  });

  it("looks a request up by reference number and email", async () => {
    route.query = new URLSearchParams();
    api.lookup.mockResolvedValue(view({ openQuote: null, latestQuote: null, status: "received", statusLabel: "Cards received" }));
    const user = userEvent.setup();
    render(<SortingQuotePage />);
    await user.type(screen.getByLabelText("Reference number"), "GG-SR-1001");
    await user.type(screen.getByLabelText("Email"), "ann@example.com");
    await user.click(screen.getByRole("button", { name: "Find my quote" }));
    expect(api.lookup).toHaveBeenCalledWith({ referenceNumber: "GG-SR-1001", email: "ann@example.com", token: null });
    expect(await screen.findByRole("heading", { name: "No quote yet" })).toBeInTheDocument();
    expect(screen.getByText("Cards received")).toBeInTheDocument();
  });
});
