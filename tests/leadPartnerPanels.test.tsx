// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import type { Partner, PartnerReferral } from "../src/admin/types";

// The panels in the Partner Leads and Buying Leads drawers: where the seller
// came from, sending the lead to one matching partner store and recording
// what happened, and rewarding whoever referred the seller.

const repo = {
  list: vi.fn(),
  forLead: vi.fn(),
  send: vi.fn(),
  update: vi.fn(),
  codeOwner: vi.fn(),
  rewardForLead: vi.fn(),
  grant: vi.fn(),
  markPaid: vi.fn(),
};
vi.mock("../src/admin/repositories/partners.supabase", () => ({
  partnersRepository: { list: () => repo.list() },
  partnerReferralsRepository: {
    forLead: (...args: unknown[]) => repo.forLead(...args),
    send: (...args: unknown[]) => repo.send(...args),
    update: (...args: unknown[]) => repo.update(...args),
  },
  referralRewardsRepository: {
    codeOwner: (code: string) => repo.codeOwner(code),
    forLead: (...args: unknown[]) => repo.rewardForLead(...args),
    grant: (...args: unknown[]) => repo.grant(...args),
    markPaid: (id: string) => repo.markPaid(id),
  },
}));

const { LeadSourcePanel, PartnerReferralPanel, ReferralRewardPanel } = await import(
  "../src/admin/components/partners/LeadPartnerPanels"
);

function partner(overrides: Partial<Partner>): Partner {
  return {
    id: "p1",
    createdAt: "2026-10-01T00:00:00Z",
    kind: "store",
    status: "active",
    businessName: "Gateway Games",
    contactName: "Pat",
    email: "pat@gateway.example",
    phone: null,
    website: null,
    city: "Kirkwood",
    state: "MO",
    categories: ["pokemon"],
    coverage: null,
    buysByMail: false,
    profession: null,
    notes: null,
    internalNotes: null,
    feePercent: 8,
    approvedAt: "2026-10-02T00:00:00Z",
    agreedToStandardsAt: "2026-10-01T00:00:00Z",
    referralCode: null,
    source: {},
    ...overrides,
  } as Partner;
}

function referral(overrides: Partial<PartnerReferral>): PartnerReferral {
  return {
    id: "r1",
    createdAt: "2026-10-03T00:00:00Z",
    partnerId: "p1",
    referralLeadId: "lead-1",
    sellSubmissionId: null,
    leadReference: "GG-R-100001",
    sentAt: "2026-10-03T00:00:00Z",
    outcome: "pending",
    outcomeAt: null,
    saleAmountCents: null,
    feePercent: 8,
    feeCents: null,
    feeStatus: "none",
    feePaidAt: null,
    checkinSentAt: null,
    checkinResponse: null,
    checkinAmountCents: null,
    checkinRespondedAt: null,
    notes: null,
    ...overrides,
  };
}

function wrap(node: React.ReactNode) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

beforeEach(() => {
  repo.list.mockResolvedValue([
    partner({}),
    partner({ id: "p2", businessName: "Retro Rewind", categories: ["video_games"] }),
    partner({ id: "p3", businessName: "Paused Pokémon Shop", status: "paused" }),
    partner({ id: "p4", businessName: "Heirloom Estate Sales", kind: "referrer", categories: [] }),
  ]);
  repo.forLead.mockResolvedValue([]);
  repo.send.mockResolvedValue({ referralId: "r9", emails: { store: "sent", seller: "sent" } });
  repo.update.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LeadSourcePanel", () => {
  it("lists what's known about where the seller came from", () => {
    wrap(<LeadSourcePanel source={{ utmSource: "card_show", utmCampaign: "nov-1", refCode: "heirloom" }} />);
    expect(screen.getByText("Tagged link: Card show or event (nov-1)")).toBeInTheDocument();
    expect(screen.getByText("Referral code: heirloom")).toBeInTheDocument();
  });

  it("says when nothing was recorded", () => {
    wrap(<LeadSourcePanel source={{}} />);
    expect(screen.getByText(/Nothing recorded/)).toBeInTheDocument();
  });
});

describe("PartnerReferralPanel", () => {
  const props = { kind: "referral_lead" as const, leadId: "lead-1", leadReference: "GG-R-100001", leadCategories: ["pokemon"] };

  it("offers only active stores that buy what the seller has, and sends after a confirmation", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    wrap(<PartnerReferralPanel {...props} onChanged={onChanged} />);
    const select = await screen.findByLabelText("Send to");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options.some((o) => o?.startsWith("Gateway Games"))).toBe(true);
    expect(options.some((o) => o?.includes("Retro Rewind"))).toBe(false);
    expect(options.some((o) => o?.includes("Paused"))).toBe(false);
    expect(options.some((o) => o?.includes("Heirloom"))).toBe(false);

    const sendButton = screen.getByRole("button", { name: "Send to store" });
    expect(sendButton).toBeDisabled();
    await user.selectOptions(select, "p1");
    await user.click(sendButton);
    const dialog = await screen.findByRole("dialog", { name: "Send GG-R-100001 to Gateway Games?" });
    expect(dialog).toHaveTextContent("The finder's fee is 8% if they buy.");
    await user.click(within(dialog).getByRole("button", { name: "Send it" }));
    expect(repo.send).toHaveBeenCalledWith("referral_lead", "lead-1", "p1");
    expect(await screen.findByText("Sent to Gateway Games. We emailed them and the seller.")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("says when an email didn't go out, so staff can forward it", async () => {
    repo.send.mockResolvedValue({ referralId: "r9", emails: { store: "failed", seller: "sent" } });
    const user = userEvent.setup();
    wrap(<PartnerReferralPanel {...props} />);
    await user.selectOptions(await screen.findByLabelText("Send to"), "p1");
    await user.click(screen.getByRole("button", { name: "Send to store" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Send it" }));
    expect(await screen.findByText(/the email to the store didn't go out/)).toBeInTheDocument();
  });

  it("warns when no active store buys this yet", async () => {
    wrap(<PartnerReferralPanel {...props} leadCategories={["one_piece"]} />);
    expect(await screen.findByText(/No active partner store buys One Piece cards yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add one on the Partners page" })).toHaveAttribute(
      "href",
      "/admin_dashboard/partners",
    );
  });

  it("explains why a lead can't be sent", async () => {
    wrap(<PartnerReferralPanel {...props} blockedReason="The seller didn't agree to be passed to a partner store." />);
    expect(await screen.findByText("The seller didn't agree to be passed to a partner store.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Send to")).toBeNull();
  });

  it("keeps a lead with its store until the outcome is recorded, then records a sale in cents", async () => {
    repo.forLead.mockResolvedValue([referral({})]);
    const user = userEvent.setup();
    wrap(<PartnerReferralPanel {...props} />);
    expect(await screen.findByText(/With Gateway Games now/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Send to")).toBeNull();

    await user.selectOptions(screen.getByLabelText("What happened"), "sold");
    await user.type(screen.getByLabelText("Store paid the seller ($)"), "$1,234.56");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(repo.update).toHaveBeenCalledWith("r1", { outcome: "sold", saleAmountCents: 123456 });
  });

  it("shows the finder's fee on a sale, with what the seller said", async () => {
    repo.forLead.mockResolvedValue([
      referral({
        outcome: "sold",
        saleAmountCents: 50000,
        feeCents: 4000,
        feeStatus: "owed",
        checkinResponse: "sold",
        checkinAmountCents: 52000,
        checkinRespondedAt: "2026-10-10T00:00:00Z",
      }),
    ]);
    const user = userEvent.setup();
    wrap(<PartnerReferralPanel {...props} />);
    expect(await screen.findByText(/Finder.s fee:/)).toHaveTextContent("$40.00 (8% of $500.00)");
    expect(screen.getByText(/Seller said:/)).toHaveTextContent("about $520.00");
    await user.click(screen.getByRole("button", { name: "Mark paid" }));
    expect(repo.update).toHaveBeenCalledWith("r1", { feeStatus: "paid" });
  });
});

describe("ReferralRewardPanel", () => {
  beforeEach(() => {
    repo.codeOwner.mockResolvedValue({ code: "friend22", userId: "u1", partnerId: null, label: "Alex Kim (customer)", email: "alex@example.com" });
    repo.rewardForLead.mockResolvedValue(null);
    repo.grant.mockResolvedValue({ kind: "store_credit", amountCents: 1000 });
  });

  it("shows nothing for a seller nobody referred", () => {
    const { container } = wrap(<ReferralRewardPanel kind="sell_submission" leadId="s1" refCode={null} />);
    expect(container.querySelector("section")).toBeNull();
  });

  it("names the referrer and waits for a sale", async () => {
    wrap(<ReferralRewardPanel kind="sell_submission" leadId="s1" refCode="friend22" />);
    expect(await screen.findByText("Alex Kim (customer)")).toBeInTheDocument();
    expect(screen.getByText("They get $10.00 in store credit once this seller sells.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /store credit/ })).toBeNull();
  });

  it("gives the store credit once we bought the collection", async () => {
    const user = userEvent.setup();
    wrap(<ReferralRewardPanel kind="sell_submission" leadId="s1" refCode="friend22" soldToUs />);
    await user.click(await screen.findByRole("button", { name: "Give $10.00 store credit" }));
    expect(repo.grant).toHaveBeenCalledWith("sell_submission", "s1");
    expect(await screen.findByText("Added $10.00 store credit and emailed them.")).toBeInTheDocument();
  });

  it("counts a partner store sale as a sale, and lets the owner mark a partner's fee paid", async () => {
    repo.codeOwner.mockResolvedValue({ code: "heirloom", userId: null, partnerId: "p4", label: "Heirloom Estate Sales (referral partner)", email: null });
    repo.forLead.mockResolvedValue([referral({ outcome: "sold" })]);
    const user = userEvent.setup();
    const { unmount } = wrap(<ReferralRewardPanel kind="referral_lead" leadId="lead-1" refCode="heirloom" />);
    expect(await screen.findByRole("button", { name: "Record their referral fee" })).toBeInTheDocument();
    unmount();

    repo.rewardForLead.mockResolvedValue({
      id: "rw1",
      createdAt: "2026-10-10T00:00:00Z",
      referralLeadId: "lead-1",
      sellSubmissionId: null,
      leadReference: "GG-R-100001",
      refCode: "heirloom",
      userId: null,
      partnerId: "p4",
      kind: "cash",
      amountCents: 1500,
      status: "owed",
      paidAt: null,
    });
    wrap(<ReferralRewardPanel kind="referral_lead" leadId="lead-1" refCode="heirloom" />);
    expect(await screen.findByText("Fee owed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark paid" }));
    expect(repo.markPaid).toHaveBeenCalledWith("rw1");
  });
});
