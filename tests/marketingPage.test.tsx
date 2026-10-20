// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";

// Admin → Marketing: build a tagged link and QR code for wherever sellers
// will see it, print a flyer or table sign with it, and see which sources
// bring in leads.

const partners = vi.fn();
const since = vi.fn();
vi.mock("../src/admin/repositories/partners.supabase", () => ({
  partnersRepository: { list: () => partners() },
  leadSourcesRepository: { since: (iso: string) => since(iso) },
}));

const yardSale = vi.hoisted(() => ({ snapshot: vi.fn(), showcase: vi.fn() }));
vi.mock("../src/admin/repositories/yardSale.supabase", () => ({ yardSaleRepository: yardSale }));

const { MarketingPage } = await import("../src/admin/pages/MarketingPage");

function renderPage() {
  return render(
    <ToastProvider>
      <MarketingPage />
    </ToastProvider>,
  );
}

function shownLink(): string {
  return document.querySelector(".gg-marketing-builder__link")?.textContent ?? "";
}

beforeEach(() => {
  partners.mockResolvedValue([
    { id: "p1", kind: "referrer", status: "active", businessName: "Heirloom Estate Sales", referralCode: "heirloom" },
    { id: "p2", kind: "referrer", status: "paused", businessName: "Paused Partner", referralCode: "paused22" },
    { id: "p3", kind: "store", status: "active", businessName: "Gateway Games", referralCode: null },
  ]);
  since.mockResolvedValue([
    { kind: "buying_lead", createdAt: "2026-10-10T00:00:00Z", utmSource: "card_show", utmCampaign: "nov-1" },
    { kind: "partner_lead", createdAt: "2026-10-10T00:00:00Z", utmSource: "card_show", utmCampaign: "nov-1" },
    { kind: "buying_lead", createdAt: "2026-10-09T00:00:00Z" },
  ]);
  window.print = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MarketingPage", () => {
  it("starts with a card-show link to the sell hub, on the live site", async () => {
    renderPage();
    expect(shownLink()).toBe("https://geega-games.com/sell-cards-and-games?utm_source=card_show&utm_medium=qr");
    expect(screen.getByRole("img", { name: /QR code for https:\/\/geega-games\.com/ })).toBeInTheDocument();
    expect(screen.getByText(/Leads from this link: Card show or event/)).toBeInTheDocument();
    await screen.findByText("Card show or event");
  });

  it("builds the link from the page, where it's used, the campaign and a referral partner", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByLabelText("Link to"), "Pokémon cards (partner store)");
    await user.selectOptions(screen.getByLabelText("Where you'll use it"), "Flyer or sign");
    await user.type(screen.getByLabelText("Campaign (optional)"), "Laundromat Oct");
    expect(shownLink()).toBe(
      "https://geega-games.com/sell-pokemon-cards?utm_source=flyer&utm_medium=print&utm_campaign=laundromat-oct",
    );

    // Only active referral partners with a code can be credited.
    const partnerSelect = await screen.findByLabelText("Credit a referral partner (optional)");
    expect(within(partnerSelect).queryByText("Paused Partner")).toBeNull();
    expect(within(partnerSelect).queryByText("Gateway Games")).toBeNull();
    await user.selectOptions(partnerSelect, "Heirloom Estate Sales");
    expect(shownLink()).toContain("&ref=heirloom");
    expect(screen.getByText(/credited to Heirloom Estate Sales/)).toBeInTheDocument();
  });

  it("takes a custom place, or no label at all", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByLabelText("Where you'll use it"), "Somewhere else…");
    await user.type(screen.getByLabelText("Name it"), "Church Bulletin");
    expect(shownLink()).toBe("https://geega-games.com/sell-cards-and-games?utm_source=church-bulletin");
    await user.selectOptions(screen.getByLabelText("Where you'll use it"), "Nowhere in particular (no label)");
    expect(shownLink()).toBe("https://geega-games.com/sell-cards-and-games");
  });

  it("copies the link", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await navigator.clipboard.readText()).toBe(
      "https://geega-games.com/sell-cards-and-games?utm_source=card_show&utm_medium=qr",
    );
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
  });

  it("opens the flyer preview with the page's copy, the link and the extra line", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("Extra line for the flyer or sign (optional)"), "Table 12 today");
    await user.click(screen.getByRole("button", { name: "Print flyer" }));
    const dialog = screen.getByRole("dialog", { name: "Flyer preview" });
    expect(dialog).toHaveTextContent("Selling a card or video game collection?");
    expect(dialog).toHaveTextContent("Table 12 today");
    // The address for typing in: under the QR code and on all 8 tear-off strips.
    const addresses = [...dialog.querySelectorAll(".gg-flyer__address")].map((a) => a.textContent);
    expect(addresses).toEqual(Array(9).fill("geega-games.com/sell-cards-and-games"));
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("prints the yard sale's own sign, with its hand of cards and the extra line", async () => {
    yardSale.snapshot.mockResolvedValue({
      sale: { id: "sale-1", startedAt: "2026-10-24T13:00:00Z", endsAt: "2026-10-24T19:00:00Z", endedAt: null, active: true, discountPercent: 25, minPriceCents: 500, listsSent: 0 },
      openLists: 0,
      openListsFromEndedSales: 0,
      completedLists: 0,
      completedTotalCents: 0,
    });
    yardSale.showcase.mockResolvedValue([{ id: "ugin", name: "Ugin, Eye of the Storms", imageUrl: "https://img.test/ugin.jpg" }]);
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByLabelText("Link to"), "Yard sale — cards to pick up (Yard Sale Mode)");
    // No lead tags on the yard sale link.
    expect(shownLink()).toBe("https://geega-games.com/yard-sale");
    await waitFor(() => expect(yardSale.snapshot).toHaveBeenCalled());
    await user.type(screen.getByLabelText("Extra line for the flyer or sign (optional)"), "Saturday 8 to 2");
    await user.click(screen.getByRole("button", { name: "Print table sign" }));
    // The sale's own terms, from Yard Sale Mode.
    expect(yardSale.showcase).toHaveBeenCalledWith(500);
    const dialog = await screen.findByRole("dialog", { name: "Yard sale sign preview" });
    expect(dialog).toHaveTextContent("Saturday 8 to 2");
    expect(dialog).toHaveTextContent("Scan to see our cards $5 and up");
    expect(dialog).toHaveTextContent("Yard sale prices are 25% off our website prices");
    const hand = within(dialog).getByRole("region", { name: "A few of our newer cards" });
    expect(within(hand).getByRole("img", { name: "Ugin, Eye of the Storms" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("counts leads by source for the chosen period", async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await screen.findByRole("table", { name: "Leads by source" });
    const rows = within(table).getAllByRole("row");
    // Header, then most leads first, "Direct or unknown" last.
    expect(rows[1]).toHaveTextContent("Card show or event");
    expect(rows[1]).toHaveTextContent("nov-1 (2)");
    expect(rows[2]).toHaveTextContent("Direct or unknown");
    // 2 of 3 seller leads came in on a tagged link.
    expect(screen.getByText("67%")).toBeInTheDocument();

    const firstWindow = new Date(since.mock.calls[0][0]).getTime();
    await user.click(screen.getByRole("tab", { name: "90 days" }));
    await waitFor(() => expect(since).toHaveBeenCalledTimes(2));
    const secondWindow = new Date(since.mock.calls[1][0]).getTime();
    expect(firstWindow - secondWindow).toBeGreaterThan(59 * 24 * 60 * 60 * 1000);
  });

  it("says so when there are no leads yet", async () => {
    since.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No leads in this period")).toBeInTheDocument();
  });
});
