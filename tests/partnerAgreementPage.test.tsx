// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PARTNER_AGREEMENT_ACKS } from "../src/store/lib/partnerAgreement";

// The partner's signing page (/partner-agreement?t=…): no sign-in; nothing is
// pre-ticked; "I have read this entire agreement" unlocks only once its end
// has been on screen; signing sends what was entered with the hash of the
// text shown, and says what happens next.

let query = new URLSearchParams("t=TOKEN123");
vi.mock("../src/store/lib/router", () => ({ useRouter: () => ({ navigate: () => {}, path: "/partner-agreement", query }) }));
vi.mock("../src/store/lib/useSEO", () => ({ useSEO: () => {} }));

let reveal: (() => void) | null = null;
class FakeObserver {
  constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
  observe() {
    reveal = () => this.cb([{ isIntersecting: true }]);
  }
  disconnect() {}
}

const PENDING = {
  ok: true,
  status: "pending",
  kind: "referrer",
  title: "Geega Games Referral Partner Agreement",
  versionNumber: 1,
  businessName: "NITE Run Delivery LLC",
  contactName: "Chayson Ingram-Gray",
  renderedMd: "## 4. The referral fee\n\n**4.1 When it's earned.** Only on a Closed Direct Purchase.",
  agreementSha256: "a".repeat(64),
  acknowledgments: PARTNER_AGREEMENT_ACKS.referrer,
  expiresAt: "2026-11-25T00:00:00Z",
};

const fetchMock = vi.fn();
function respond(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);
}

const { default: PartnerAgreementPage } = await import("../src/store/pages/PartnerAgreementPage");

beforeEach(() => {
  query = new URLSearchParams("t=TOKEN123");
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  window.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  reveal = null;
});

function type(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("PartnerAgreementPage", () => {
  it("opens the agreement from the link, with nothing ticked", async () => {
    fetchMock.mockReturnValueOnce(respond(200, PENDING));
    render(<PartnerAgreementPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Geega Games Referral Partner Agreement" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/partner-agreement?t=TOKEN123", expect.objectContaining({ method: "GET" }));
    expect(screen.getByText(/Only on a Closed Direct Purchase/)).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(6);
    expect(boxes.every((b) => !(b as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("checkbox", { name: /I have read this entire agreement/ })).toBeDisabled();
  });

  it("explains what's missing, then signs with the hash of the text shown", async () => {
    fetchMock.mockReturnValueOnce(respond(200, PENDING));
    render(<PartnerAgreementPage />);
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Sign for NITE Run Delivery LLC" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter your full legal name.");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => reveal?.());
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    type(/Full legal name/, "Chayson Ingram-Gray");
    type(/Your title or role/, "Owner");
    type(/^Electronic signature: type/, "Chayson Ingram-Gray");

    fetchMock.mockReturnValueOnce(respond(200, { ok: true, activated: true, kind: "referrer", pdfEmailed: true }));
    fireEvent.click(screen.getByRole("button", { name: "Sign for NITE Run Delivery LLC" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/partner-agreement");
    expect(JSON.parse(init.body)).toEqual({
      t: "TOKEN123",
      agreementSha256: "a".repeat(64),
      acknowledgments: Object.fromEntries(PARTNER_AGREEMENT_ACKS.referrer.map((a) => [a.key, true])),
      legalName: "Chayson Ingram-Gray",
      title: "Owner",
      typedSignature: "Chayson Ingram-Gray",
    });
    expect(await screen.findByRole("heading", { name: "Thanks, it's signed" })).toBeInTheDocument();
    expect(screen.getByText(/A PDF copy is on its way/)).toBeInTheDocument();
    expect(screen.getByText(/Your personal referral link and QR code are on their way/)).toBeInTheDocument();
  });

  it("shows the server's message when signing fails, and lets them try again", async () => {
    fetchMock.mockReturnValueOnce(respond(200, PENDING));
    render(<PartnerAgreementPage />);
    await screen.findByRole("heading", { level: 1 });
    act(() => reveal?.());
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    type(/Full legal name/, "Chayson Ingram-Gray");
    type(/Your title or role/, "Owner");
    type(/^Electronic signature: type/, "Chayson Ingram-Gray");
    fetchMock.mockReturnValueOnce(respond(409, { ok: false, message: "The agreement changed while you were reading it." }));
    fireEvent.click(screen.getByRole("button", { name: "Sign for NITE Run Delivery LLC" }));
    expect(await screen.findByText("The agreement changed while you were reading it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign for NITE Run Delivery LLC" })).toBeEnabled();
  });

  it("says when the link has expired or was already signed", async () => {
    fetchMock.mockReturnValueOnce(respond(410, { ok: false, message: "This link has expired." }));
    const { unmount } = render(<PartnerAgreementPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This link has expired.");
    unmount();

    fetchMock.mockReturnValueOnce(
      respond(200, { ok: true, status: "signed", title: "Geega Games Partner Store Agreement", businessName: "GamEuphoria", signedAt: "2026-11-12T15:00:00Z", signerName: "Joey Smith" }),
    );
    render(<PartnerAgreementPage />);
    expect(await screen.findByRole("heading", { name: "Already signed" })).toBeInTheDocument();
    expect(screen.getByText(/Joey Smith signed the Geega Games Partner Store Agreement for GamEuphoria/)).toBeInTheDocument();
  });

  it("explains a link with no code", async () => {
    query = new URLSearchParams("");
    render(<PartnerAgreementPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("missing its code");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
