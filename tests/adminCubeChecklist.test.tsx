// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import { NAV_ITEMS, SECTION_TITLES } from "../src/admin/components/layout/nav";

// Admin → Cube Checklist (temporary): loads the cube via the staff proxy,
// searches, crosses cards off (persisted per browser), and lists printings.

const api = vi.hoisted(() => ({ adminFetch: vi.fn() }));
const scry = vi.hoisted(() => ({ searchPrintingsPage: vi.fn() }));

vi.mock("../src/admin/repositories/apiClient", () => ({ adminFetch: api.adminFetch }));
vi.mock("../src/admin/repositories", () => ({ scryfallRepository: scry }));

const { CubeChecklistPage } = await import("../src/admin/pages/CubeChecklistPage");

const CUBE = {
  cubeId: "thepaupercube",
  name: "The Pauper Cube",
  cards: [
    { name: "Kor Skyfisher", type: "Creature — Kor Soldier", colorCategory: "White" },
    { name: "Counterspell", type: "Instant", colorCategory: "Blue" },
    { name: "Ponder", type: "Sorcery", colorCategory: "Blue" },
  ],
};

const printing = (id: string, setName: string) => ({
  id,
  scryfallId: id,
  cardName: "Counterspell",
  setName,
  setCode: id,
  collectorNumber: "1",
  rarity: "common",
  cardType: "Instant",
  imageUrl: "",
  availableFinishes: ["nonfoil"],
  scryfallPriceCents: 100,
  oracleId: null,
  images: { small: null, normal: null, large: null, png: null, artCrop: null },
  faces: [],
  layout: "normal",
  artist: null,
  releasedAt: "2021-01-01",
  language: "en",
  frame: null,
  frameEffects: [],
  borderColor: null,
  fullArt: false,
  textless: false,
  promo: false,
  promoTypes: [],
  treatments: [],
  prices: { usd: 125, usdFoil: null, usdEtched: null },
});

const renderPage = () =>
  render(
    <ToastProvider>
      <CubeChecklistPage />
    </ToastProvider>,
  );

beforeEach(() => {
  window.localStorage.clear();
  api.adminFetch.mockResolvedValue(CUBE);
  scry.searchPrintingsPage.mockReset();
});
afterEach(cleanup);

describe("Cube Checklist", () => {
  it("is in the admin nav", () => {
    expect(NAV_ITEMS.some((n) => n.key === "cube-checklist")).toBe(true);
    expect(SECTION_TITLES["cube-checklist"]).toBe("Cube Checklist");
  });

  it("loads the cube through the staff proxy and searches it", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("Kor Skyfisher")).toBeTruthy();
    expect(api.adminFetch).toHaveBeenCalledWith("/api/admin/cube-list?id=thepaupercube");

    await user.type(screen.getByLabelText("Search cards"), "sorc");
    expect(screen.queryByText("Kor Skyfisher")).toBeNull();
    expect(screen.getByText("Ponder")).toBeTruthy();
  });

  it("crosses cards off, keeps them across reloads, and Enter crosses off a single match", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Counterspell");

    await user.click(screen.getByLabelText(/Counterspell/));
    // Default view is "Remaining", so it drops out of the list.
    expect(screen.queryByText("Counterspell")).toBeNull();
    expect(screen.getByText("1 of 3 crossed off (33%)")).toBeTruthy();

    await user.type(screen.getByLabelText("Search cards"), "pond{Enter}");
    expect(screen.getByText("2 of 3 crossed off (67%)")).toBeTruthy();

    cleanup();
    renderPage();
    expect(await screen.findByText("2 of 3 crossed off (67%)")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /Crossed off/ }));
    expect(screen.getByText("Counterspell")).toBeTruthy();
    expect(screen.getByText("Ponder")).toBeTruthy();
  });

  it("shows paper printings of a card, newest first, with load more", async () => {
    const user = userEvent.setup();
    scry.searchPrintingsPage
      .mockResolvedValueOnce({ printings: [printing("aaa", "Dominaria Remastered")], totalCards: 2, hasMore: true, page: 1 })
      .mockResolvedValueOnce({ printings: [printing("bbb", "Alpha")], totalCards: 2, hasMore: false, page: 2 });
    renderPage();
    const row = (await screen.findByText("Counterspell")).closest("li")!;

    await user.click(within(row).getByRole("button", { name: /Printings/ }));
    expect(await within(row).findByText("Dominaria Remastered")).toBeTruthy();
    expect(scry.searchPrintingsPage).toHaveBeenCalledWith('!"Counterspell" game:paper', 1);

    await user.click(within(row).getByRole("button", { name: /Load more printings/ }));
    await waitFor(() => expect(within(row).getByText("Alpha")).toBeTruthy());
    expect(within(row).getByText("2 printings, newest first")).toBeTruthy();
  });
});
