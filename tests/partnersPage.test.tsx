// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import type { Partner, PartnerReferral } from "../src/admin/types";

// Admin → Partners: applications to approve, partner stores with what they
// owe, referral partners with their link and QR code, and adding a partner
// you already work with.

const repo = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  act: vi.fn(),
  remove: vi.fn(),
  all: vi.fn(),
  forPartner: vi.fn(),
};
vi.mock("../src/admin/repositories/partners.supabase", () => ({
  partnersRepository: {
    list: () => repo.list(),
    create: (...a: unknown[]) => repo.create(...a),
    update: (...a: unknown[]) => repo.update(...a),
    act: (...a: unknown[]) => repo.act(...a),
    remove: (...a: unknown[]) => repo.remove(...a),
  },
  partnerReferralsRepository: { all: () => repo.all() },
  referralRewardsRepository: { forPartner: (id: string) => repo.forPartner(id) },
}));

const { PartnersPage } = await import("../src/admin/pages/PartnersPage");

function partner(overrides: Partial<Partner>): Partner {
  return {
    id: "p1",
    createdAt: "2026-10-05T00:00:00Z",
    kind: "store",
    status: "active",
    businessName: "Gateway Games",
    contactName: "Pat Lee",
    email: "pat@gateway.example",
    phone: null,
    website: null,
    city: "Kirkwood",
    state: "MO",
    categories: ["pokemon", "video_games"],
    coverage: null,
    buysByMail: true,
    profession: null,
    notes: null,
    internalNotes: null,
    feePercent: 8,
    approvedAt: "2026-10-06T00:00:00Z",
    agreedToStandardsAt: "2026-10-05T00:00:00Z",
    referralCode: null,
    source: {},
    ...overrides,
  } as Partner;
}

const soldReferral: PartnerReferral = {
  id: "r1",
  createdAt: "2026-10-07T00:00:00Z",
  partnerId: "p1",
  referralLeadId: "lead-1",
  sellSubmissionId: null,
  leadReference: "GG-R-100001",
  sentAt: "2026-10-07T00:00:00Z",
  outcome: "sold",
  outcomeAt: "2026-10-09T00:00:00Z",
  saleAmountCents: 50000,
  feePercent: 8,
  feeCents: 4000,
  feeStatus: "owed",
  feePaidAt: null,
  checkinSentAt: null,
  checkinResponse: null,
  checkinAmountCents: null,
  checkinRespondedAt: null,
  notes: null,
};

function renderPage(query = "") {
  return render(
    <ToastProvider>
      <PartnersPage query={new URLSearchParams(query)} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  repo.list.mockResolvedValue([
    partner({}),
    partner({ id: "p2", status: "applied", businessName: "Retro Rewind", contactName: "Sam Ortiz", approvedAt: null }),
    partner({
      id: "p3",
      kind: "referrer",
      businessName: "Heirloom Estate Sales",
      contactName: "Jo Park",
      categories: [],
      profession: "estate_sale",
      feePercent: 3,
      referralCode: "heirloom",
    }),
  ]);
  repo.all.mockResolvedValue([soldReferral]);
  repo.forPartner.mockResolvedValue([]);
  repo.act.mockResolvedValue({ referralCode: null, welcome: "sent" });
  repo.create.mockResolvedValue({ id: "p9" });
  window.print = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PartnersPage", () => {
  it("opens on waiting applications and totals what stores owe", async () => {
    renderPage();
    expect(await screen.findByRole("tab", { name: /Applications\s*1/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Retro Rewind")).toBeInTheDocument();
    expect(screen.queryByText("Gateway Games")).toBeNull();
    // Stat card: $40 owed from the one sale.
    expect(screen.getByText("Finder's fees owed").closest(".gg-stat")).toHaveTextContent("$40.00");
  });

  it("approves an application and says the welcome went out", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText("Retro Rewind"));
    const drawer = await screen.findByRole("dialog", { name: "Retro Rewind" });
    await user.click(within(drawer).getByRole("button", { name: "Approve & send welcome" }));
    expect(repo.act).toHaveBeenCalledWith("p2", "approve");
    expect(await screen.findByText("Approved Retro Rewind. Welcome email sent.")).toBeInTheDocument();
  });

  it("shows a store's leads and fees owed, copies a statement, and keeps it from being deleted", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("tab", { name: /Partner stores/ }));
    const row = screen.getByText("Gateway Games").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("1 / 1");
    expect(row).toHaveTextContent("$40.00");
    await user.click(screen.getByText("Gateway Games"));
    const drawer = await screen.findByRole("dialog", { name: "Gateway Games" });
    expect(within(drawer).getByText(/Owed now:/)).toHaveTextContent("$40.00 (1 sale)");
    await user.click(within(drawer).getByRole("button", { name: "Copy statement" }));
    const statement = await navigator.clipboard.readText();
    expect(statement).toContain("Finder's fees owed to Geega Games — Gateway Games");
    expect(statement).toContain("GG-R-100001");
    expect(statement).toContain("Total owed: $40.00");
    expect(within(drawer).queryByRole("button", { name: "Delete partner" })).toBeNull();
    expect(within(drawer).getByText(/kept for the fee records/)).toBeInTheDocument();
  });

  it("gives a referral partner's link, QR code and a printable flyer with their code", async () => {
    const user = userEvent.setup();
    renderPage("partner=p3");
    const drawer = await screen.findByRole("dialog", { name: "Heirloom Estate Sales" });
    expect(within(drawer).getByText("https://geega-games.com/sell-cards-and-games?ref=heirloom")).toBeInTheDocument();
    expect(within(drawer).getByRole("img", { name: /QR code for Heirloom Estate Sales/ })).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "Print flyer" }));
    const flyer = screen.getByRole("dialog", { name: "Flyer preview" });
    // Their code stays on the typed address too, so a seller who types it is still credited.
    const addresses = [...flyer.querySelectorAll(".gg-flyer__address")].map((a) => a.textContent);
    expect(addresses).toEqual(Array(9).fill("geega-games.com/sell-cards-and-games?ref=heirloom"));
  });

  it("adds a partner you already work with, starting a referral partner at 3%", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Add a partner" }));
    const modal = await screen.findByRole("dialog", { name: "Add a partner" });
    await user.selectOptions(within(modal).getByLabelText("Kind"), "referrer");
    expect(within(modal).getByLabelText("Referral fee (% of the sale)")).toHaveValue("3");
    await user.type(within(modal).getByLabelText(/Business name/), "Lakeside Realty");
    await user.type(within(modal).getByLabelText(/Contact name/), "Dana");
    await user.type(within(modal).getByRole("textbox", { name: /^Email/ }), "dana@lakeside.example");
    await user.selectOptions(within(modal).getByLabelText("Works as"), "realtor");
    await user.click(within(modal).getByRole("button", { name: "Add partner" }));
    expect(repo.create).toHaveBeenCalledWith(
      "referrer",
      expect.objectContaining({ businessName: "Lakeside Realty", profession: "realtor", feePercent: 3 }),
      true,
    );
    expect(await screen.findByText("Lakeside Realty added and emailed.")).toBeInTheDocument();
  });
});
