// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ACKNOWLEDGMENTS } from "../src/store/lib/consignmentAgreement";

// The consignor's signing page (/consign/sign?t=…): a signed-out visitor is
// asked to sign in and brought back; nothing is pre-selected; "I've reviewed
// the agreement" unlocks only once its end has been on screen; signing sends
// exactly the answers given with the hash of the text shown.

const auth = { user: { id: "pat", email: "pat@x.com" } as { id: string; email: string } | null, loading: false };
vi.mock("../src/store/lib/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../src/store/lib/router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useRouter: () => ({ navigate: () => {}, path: "/consign/sign", query: new URLSearchParams("t=TOKEN123") }),
}));
vi.mock("../src/store/lib/useSEO", () => ({ useSEO: () => {} }));

const signAgreement = vi.fn();
vi.mock("../src/store/lib/consignmentApi", () => ({
  CONSIGN_SIGN_PATH: "/consign/sign",
  useEstimatorConfig: () => ({ status: "error", message: "offline" }),
  signedAgreementUrl: vi.fn(),
  signAgreement: (input: unknown) => signAgreement(input),
  loadInvite: vi.fn(async () => ({
    status: "pending",
    agreementId: "a1",
    consignmentLabel: "GG-C-1001",
    consignorName: "Pat Consignor",
    versionNumber: 1,
    title: "Geega Games Consignment Agreement",
    renderedMd: "## 1. Parties\n\n**1.1 Terms.** The terms.",
    agreementSha256: "f".repeat(64),
    expiresAt: "2026-11-11T00:00:00Z",
    terms: {
      capturedAt: "2026-10-28T00:00:00Z",
      channels: {
        website: { channel: "website", marketplaceBps: 0, marketplaceThresholdCents: null, marketplaceAboveThresholdBps: null, marketplaceBase: "item", perOrderCents: 0, perOrderSmallCents: null, perOrderSmallMaxCents: null, processingBps: 290, processingFixedCents: 30, processingBase: "item_shipping_tax" },
        tcgplayer: { channel: "tcgplayer", marketplaceBps: 1075, marketplaceThresholdCents: null, marketplaceAboveThresholdBps: null, marketplaceBase: "item_shipping", perOrderCents: 0, perOrderSmallCents: null, perOrderSmallMaxCents: null, processingBps: 250, processingFixedCents: 30, processingBase: "item_shipping_tax" },
        ebay: { channel: "ebay", marketplaceBps: 1325, marketplaceThresholdCents: 750000, marketplaceAboveThresholdBps: 235, marketplaceBase: "item_shipping_tax", perOrderCents: 40, perOrderSmallCents: 30, perOrderSmallMaxCents: 1000, processingBps: 0, processingFixedCents: 0, processingBase: "item_shipping_tax" },
      },
      commissionTiers: [{ maxPriceCents: 15000, rateBps: 2000 }, { maxPriceCents: null, rateBps: 1000 }],
      insurance: { service: "USPS Ground Advantage", includedCoverageCents: 10000, effectiveFrom: null },
      minCardValueCents: 0,
      initialTermDays: 90,
      inspectionDays: 3,
      payoutMethods: ["paypal"],
      supportEmail: "support@geega-games.com",
    },
  })),
}));

// jsdom has no layout: the test decides when the agreement's end is "on screen".
let reveal: (() => void) | null = null;
class FakeObserver {
  constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
  observe() {
    reveal = () => this.cb([{ isIntersecting: true }]);
  }
  disconnect() {}
}

const { default: ConsignSignPage } = await import("../src/store/pages/ConsignSignPage");

beforeEach(() => {
  auth.user = { id: "pat", email: "pat@x.com" };
  signAgreement.mockReset();
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeObserver;
  reveal = null;
});
afterEach(cleanup);

describe("ConsignSignPage", () => {
  it("asks a signed-out visitor to sign in, and brings them back", () => {
    auth.user = null;
    render(<ConsignSignPage />);
    expect(screen.getByRole("heading", { name: "Sign in to open your agreement" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=${encodeURIComponent("/consign/sign?t=TOKEN123")}`);
  });

  it("pre-selects nothing, and locks the review acknowledgment until the end is reached", async () => {
    render(<ConsignSignPage />);
    await screen.findByRole("heading", { name: "Geega Games Consignment Agreement" });
    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
    for (const box of screen.getAllByRole("checkbox")) expect(box).not.toBeChecked();
    const reviewed = screen.getByRole("checkbox", { name: /reviewed this entire agreement/ });
    expect(reviewed).toBeDisabled();
    act(() => reveal?.());
    expect(reviewed).toBeEnabled();
  });

  it("explains what's missing instead of signing", async () => {
    render(<ConsignSignPage />);
    await screen.findByRole("heading", { name: "Geega Games Consignment Agreement" });
    fireEvent.click(screen.getByRole("button", { name: "Sign the agreement" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Answer Yes or No for each sales channel.");
    expect(signAgreement).not.toHaveBeenCalled();
  });

  it("signs with exactly the answers given and the hash of the text shown", async () => {
    signAgreement.mockResolvedValue({ ok: true, agreementId: "a1", pdfReady: true });
    render(<ConsignSignPage />);
    await screen.findByRole("heading", { name: "Geega Games Consignment Agreement" });
    act(() => reveal?.());
    fireEvent.click(screen.getByLabelText("Yes, approve Geega Games website sales"));
    fireEvent.click(screen.getByLabelText("No, decline TCGplayer sales"));
    fireEvent.click(screen.getByLabelText("Yes, approve eBay sales"));
    fireEvent.click(screen.getByLabelText(/Option B: Decline additional insurance/));
    for (const a of ACKNOWLEDGMENTS) fireEvent.click(screen.getByRole("checkbox", { name: a.label }));
    fireEvent.change(screen.getByLabelText("Full legal name"), { target: { value: "Pat Consignor" } });
    fireEvent.change(screen.getByLabelText(/Electronic signature/), { target: { value: "Pat Consignor" } });
    expect(screen.getByText(/You're approving sales on Geega Games website, eBay, and you decline additional insurance/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign the agreement" }));
    await waitFor(() => expect(signAgreement).toHaveBeenCalledTimes(1));
    expect(signAgreement.mock.calls[0][0]).toEqual({
      t: "TOKEN123",
      agreementSha256: "f".repeat(64),
      acknowledgments: Object.fromEntries(ACKNOWLEDGMENTS.map((a) => [a.key, true])),
      channels: { website: true, tcgplayer: false, ebay: true },
      additionalInsurance: false,
      legalName: "Pat Consignor",
      typedSignature: "Pat Consignor",
    });
    const done = await screen.findByRole("heading", { name: "Thanks, your agreement is signed" });
    expect(within(done.parentElement!).getByRole("status")).toHaveTextContent("We've emailed you a PDF copy.");
  });
});
