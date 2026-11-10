// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import { NAV_ITEMS, SECTION_TITLES } from "../src/admin/components/layout/nav";
import type { ChecklistCard, ChecklistView } from "../src/store/lib/cubeChecklist";

// Cube Checklist UI: the shared view (used by the admin page and the public
// share page), the admin page's create / share / old-ticks flows, and the
// share page's name step. The server is a stand-in: these tests are about what
// people see and exactly what each action sends.

const api = vi.hoisted(() => ({ adminFetch: vi.fn() }));
vi.mock("../src/admin/repositories/apiClient", () => ({ adminFetch: api.adminFetch }));

const { CubeChecklistView } = await import("../src/admin/components/cube/CubeChecklistView");
const { CubeChecklistPage } = await import("../src/admin/pages/CubeChecklistPage");
const { default: SharePage } = await import("../src/store/pages/CubeChecklistSharePage");

const T0 = "2026-11-10T00:00:00.000Z";
function c(id: string, position: number, name: string, extra: Partial<ChecklistCard> = {}): ChecklistCard {
  return {
    id,
    position,
    name,
    typeLine: null,
    colorCategory: "Blue",
    originalName: null,
    swappedBy: null,
    swappedAt: null,
    foundBy: null,
    foundAt: null,
    updatedAt: T0,
    ...extra,
  };
}
const VIEW: ChecklistView = {
  id: "list-1",
  name: "The Pauper Cube",
  cubeId: "thepaupercube",
  rarityRule: "common",
  syncedAt: T0,
  cards: [
    c("a", 0, "Kor Skyfisher", { colorCategory: "White", typeLine: "Creature — Kor Soldier" }),
    c("b", 1, "Counterspell", { typeLine: "Instant" }),
    c("d", 2, "Ponder", { typeLine: "Sorcery" }),
  ],
};

beforeEach(() => {
  window.localStorage.clear();
  api.adminFetch.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("shared checklist view", () => {
  function setup(handlers: Record<string, (body: Record<string, unknown>) => unknown> = {}) {
    const call = vi.fn(async (body: Record<string, unknown>) => {
      const h = handlers[String(body.action)];
      if (h) return h(body);
      if (body.action === "get") return { view: body.since ? { ...VIEW, cards: [] } : VIEW };
      throw new Error(`unexpected ${String(body.action)}`);
    });
    render(
      <ToastProvider>
        <CubeChecklistView call={call as never} />
      </ToastProvider>,
    );
    return call;
  }

  it("marks cards found and shows who found them", async () => {
    const user = userEvent.setup();
    const call = setup({
      found: (b) => ({ card: c(String(b.cardId), 1, "Counterspell", { foundBy: "Sam", foundAt: T0, updatedAt: "2026-11-10T00:01:00.000Z" }) }),
    });
    await screen.findByText("Counterspell");
    await user.click(screen.getByRole("tab", { name: /^All/ }));
    await user.click(screen.getByLabelText(/Counterspell/));
    expect(call).toHaveBeenCalledWith({ action: "found", cardId: "b", found: true });
    expect(await screen.findByText(/Found by Sam/)).toBeTruthy();
    expect(screen.getByText("1 of 3 found (33%)")).toBeTruthy();
  });

  it("Enter in search marks the single match found", async () => {
    const user = userEvent.setup();
    const call = setup({ found: () => ({ card: c("d", 2, "Ponder", { foundBy: "Sam", foundAt: T0, updatedAt: "2026-11-10T00:01:00.000Z" }) }) });
    await screen.findByText("Ponder");
    await user.type(screen.getByLabelText("Search cards"), "pond{Enter}");
    expect(call).toHaveBeenCalledWith({ action: "found", cardId: "d", found: true });
  });

  it("shows other people's changes on the next refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let refreshed = false;
    setup({
      get: (b) => {
        if (!b.since) return { view: VIEW };
        refreshed = true;
        return { view: { ...VIEW, cards: [c("d", 2, "Ponder", { foundBy: "Alex", foundAt: T0, updatedAt: "2026-11-10T00:02:00.000Z" })] } };
      },
    });
    await screen.findByText("Ponder");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(refreshed).toBe(true);
    // Default view hides found cards.
    await waitFor(() => expect(screen.queryByText("Ponder")).toBeNull());
  });

  it("offers better options, swaps one in, and can undo", async () => {
    const user = userEvent.setup();
    const call = setup({
      suggest: () => ({
        options: [{ name: "Mana Leak", typeLine: "Instant", manaCost: "{1}{U}", imageSmall: null, imageNormal: null, edhrecRank: 120 }],
      }),
      swap: () => ({
        card: c("b", 1, "Mana Leak", { originalName: "Counterspell", swappedBy: "Sam", swappedAt: T0, updatedAt: "2026-11-10T00:03:00.000Z" }),
      }),
      unswap: () => ({ card: c("b", 1, "Counterspell", { updatedAt: "2026-11-10T00:04:00.000Z" }) }),
    });
    const row = (await screen.findByText("Counterspell")).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Swap" }));
    expect(await within(row).findByText("Better options")).toBeTruthy();
    expect(within(row).getByText(/Only commons that/)).toBeTruthy();
    expect(within(row).getByText("#120 most played")).toBeTruthy();

    await user.click(within(row).getByRole("button", { name: "Swap in" }));
    expect(call).toHaveBeenCalledWith({ action: "swap", cardId: "b", newName: "Mana Leak" });
    expect(await screen.findByText("Mana Leak")).toBeTruthy();
    expect(screen.getByText("Counterspell", { selector: "strong" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(call).toHaveBeenCalledWith({ action: "unswap", cardId: "b" });
    await waitFor(() => expect(screen.queryByText("Mana Leak")).toBeNull());
  });

  it("searches for any allowed card to swap in", async () => {
    const user = userEvent.setup();
    const call = setup({
      suggest: () => ({ options: [] }),
      search: () => ({ options: [{ name: "Lightning Bolt", typeLine: "Instant", manaCost: "{R}", imageSmall: null, imageNormal: null, edhrecRank: null }] }),
    });
    const row = (await screen.findByText("Counterspell")).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Swap" }));
    await user.type(within(row).getByLabelText("Search for a card to swap in"), "bolt");
    expect(await within(row).findByText("Lightning Bolt")).toBeTruthy();
    expect(call).toHaveBeenCalledWith({ action: "search", query: "bolt" });
  });

  it("lists printings with load more", async () => {
    const user = userEvent.setup();
    const p = (id: string, setName: string) => ({
      id, scryfallId: id, cardName: "Counterspell", setName, setCode: id, collectorNumber: "1", rarity: "common",
      cardType: "Instant", imageUrl: "", availableFinishes: ["nonfoil"], scryfallPriceCents: 100, oracleId: null,
      images: { small: null, normal: null, large: null, png: null, artCrop: null }, faces: [], layout: "normal",
      artist: null, releasedAt: "2021-01-01", language: "en", frame: null, frameEffects: [], borderColor: null,
      fullArt: false, textless: false, promo: false, promoTypes: [], treatments: [], prices: { usd: 125, usdFoil: null, usdEtched: null },
    });
    const call = setup({
      printings: (b) =>
        b.page === 1
          ? { printings: [p("aaa", "Dominaria Remastered")], hasMore: true }
          : { printings: [p("bbb", "Alpha")], hasMore: false },
    });
    const row = (await screen.findByText("Counterspell")).closest("li")!;
    await user.click(within(row).getByRole("button", { name: /Printings/ }));
    expect(await within(row).findByText("Dominaria Remastered")).toBeTruthy();
    await user.click(within(row).getByRole("button", { name: /Load more printings/ }));
    expect(await within(row).findByText("Alpha")).toBeTruthy();
    expect(call).toHaveBeenCalledWith({ action: "printings", name: "Counterspell", page: 2 });
  });
});

describe("admin page", () => {
  it("is in the admin nav", () => {
    expect(NAV_ITEMS.some((n) => n.key === "cube-checklist")).toBe(true);
    expect(SECTION_TITLES["cube-checklist"]).toBe("Cube Checklist");
  });

  it("creates the shared Pauper Cube list (commons only) when there isn't one", async () => {
    const user = userEvent.setup();
    api.adminFetch.mockResolvedValueOnce({ checklists: [] });
    api.adminFetch.mockResolvedValueOnce({ checklist: { id: "list-1" } });
    api.adminFetch.mockResolvedValue({ checklists: [] });
    render(
      <ToastProvider>
        <CubeChecklistPage />
      </ToastProvider>,
    );
    expect(await screen.findByText("New shared checklist")).toBeTruthy();
    expect((screen.getByLabelText(/Swaps may bring in/) as HTMLSelectElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Create checklist" }));
    expect(api.adminFetch).toHaveBeenCalledWith("/api/admin/cube-checklists", {
      method: "POST",
      body: { action: "create", cubeId: "thepaupercube", name: undefined, rarityRule: "common" },
    });
  });

  it("shows the share link and offers to bring over this browser's old ticks", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("gg-cube-checklist:thepaupercube", JSON.stringify(["counterspell"]));
    api.adminFetch.mockImplementation(async (path: string, init?: { body?: Record<string, unknown> }) => {
      if (!init) {
        return {
          checklists: [
            {
              id: "list-1", name: "The Pauper Cube", cubeId: "thepaupercube", rarityRule: "common",
              shareToken: "tok_".padEnd(32, "x"), shareEnabled: true, createdAt: T0, cardCount: 3, foundCount: 0,
            },
          ],
        };
      }
      if (init.body?.action === "get") return { view: VIEW };
      if (init.body?.action === "import-found") return { marked: 1 };
      return {};
    });
    render(
      <ToastProvider>
        <CubeChecklistPage />
      </ToastProvider>,
    );
    const link = (await screen.findByLabelText(/Share link/)) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/cube-checklist?t=${"tok_".padEnd(32, "x")}`);

    await user.click(await screen.findByRole("button", { name: "Add them" }));
    expect(api.adminFetch).toHaveBeenCalledWith("/api/admin/cube-checklists", {
      method: "POST",
      body: { action: "import-found", id: "list-1", names: ["counterspell"] },
    });
    expect(window.localStorage.getItem("gg-cube-checklist:thepaupercube")).toBeNull();
    // Polling doesn't refresh the sidebar badges.
    const getCall = api.adminFetch.mock.calls.find((call) => call[1]?.body?.action === "get");
    expect(getCall?.[1].notify).toBe(false);
  });
});

describe("share page", () => {
  it("asks for a name once, then sends it with the token", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", `/cube-checklist?t=${"k".repeat(32)}`);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, view: VIEW }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SharePage />);
    await user.type(screen.getByLabelText(/Your name/), "Sam");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Counterspell")).toBeTruthy();
    expect(screen.getByText("Sam")).toBeTruthy();
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && (fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ action: "get", token: "k".repeat(32), who: "Sam" });
    expect(window.localStorage.getItem("gg-cube-checklist-name")).toBe("Sam");

    cleanup();
    render(<SharePage />);
    expect(await screen.findByText("Counterspell")).toBeTruthy(); // remembered
    vi.unstubAllGlobals();
  });
});
