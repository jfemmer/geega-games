// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import { LifeCounter } from "../src/admin/components/tournaments/LifeCounter";
import { BracketDisplay } from "../src/admin/components/tournaments/BracketDisplay";
import type { TournamentDetail, TournamentMatch, TournamentPod, TournamentSummary } from "../src/admin/utils/tournament";

// Ready-up between rounds, every way to lose, and poison / commander damage
// on the phone, the TV and the admin page.

const api = vi.hoisted(() => ({ adminFetch: vi.fn() }));
vi.mock("../src/admin/repositories/apiClient", () => ({ adminFetch: api.adminFetch }));
const { TournamentsPage } = await import("../src/admin/pages/TournamentsPage");

const T0 = "2026-11-27T20:00:00.000Z";
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const ATRAXA = "d0d33d52-3d28-4635-b985-51e126289259";
const entrants = [
  { id: ID(1), players: ["Alex"], commanders: [{ name: "Atraxa, Praetors' Voice", cardId: ATRAXA }], droppedAt: null, createdAt: T0 },
  { id: ID(2), players: ["Blair"], commanders: [{ name: "Thrasios & Tymna", cardId: null }], droppedAt: null, createdAt: T0 },
  { id: ID(3), players: ["Casey"], commanders: [null], droppedAt: null, createdAt: T0 },
  { id: ID(4), players: ["Drew"], commanders: [null], droppedAt: null, createdAt: T0 },
];
const match = (id: string, a: number, b: number, extra: Partial<TournamentMatch> = {}): TournamentMatch => ({
  id,
  round: 1,
  table: Number(id.slice(1)),
  a: ID(a),
  b: ID(b),
  result: "pending",
  reportedAt: null,
  lifeA: null,
  lifeB: null,
  startedAt: T0,
  endedAt: null,
  ...extra,
});
function duel(extra: Partial<TournamentDetail> = {}): TournamentDetail {
  return {
    id: "t1",
    name: "Friday",
    format: "1v1",
    status: "active",
    currentRound: 1,
    createdAt: T0,
    finishedAt: null,
    entrants,
    matches: [match("m1", 1, 2), match("m2", 3, 4)],
    spots: null,
    startingLife: 40,
    tableSize: null,
    pods: [],
    serverTime: T0,
    ...extra,
  };
}

afterEach(() => cleanup());

const display = {
  tv: false,
  shareUrl: "https://geega-games.com/tournament?t=tok",
  logoSrc: "/logo.png",
  onPickMe: () => undefined,
  onSaveCommander: async () => true,
  searchCommanders: async () => [],
  updatedAt: null,
};

function phone(t: TournamentDetail, me: number, handlers: Record<string, unknown> = {}) {
  const fns = {
    onChangeLife: vi.fn(async () => true),
    onLost: vi.fn(async () => true),
    onChangePodLife: vi.fn(async () => true),
    onPodOut: vi.fn(async () => true),
    onCounter: vi.fn(async () => true),
    onReady: vi.fn(async () => true),
    ...handlers,
  };
  render(
    <ToastProvider>
      <BracketDisplay {...display} tournament={t} me={{ entrantId: ID(me), seat: 0 }} {...fns} />
    </ToastProvider>,
  );
  return fns;
}

describe("poison and commander damage on the phone", () => {
  it("tracks poison and asks 'Did you lose?' at 10, with poison picked", async () => {
    const user = userEvent.setup();
    const { onCounter, onLost } = phone(duel({ matches: [match("m1", 1, 2, { countersA: { poison: 8, commander: {} } }), match("m2", 3, 4)] }), 1);
    expect(screen.getByLabelText("Poison: 8 of 10")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add a poison counter" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add a poison counter" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/You have 10 poison counters\. If you lost, the game is recorded as a win for Blair/)).toBeTruthy();
    expect(within(dialog).getByRole("radio", { name: "Poison" }).getAttribute("aria-checked")).toBe("true");
    await user.click(within(dialog).getByRole("button", { name: "Yes, I lost" }));
    await waitFor(() => expect(onLost).toHaveBeenCalledWith("m1", "a", { reason: "poison", winnerId: null }));
    // The counter was saved first, as one change.
    expect(onCounter).toHaveBeenCalledWith({ matchId: "m1", side: "a" }, "poison", "", 2);
    expect(onCounter.mock.invocationCallOrder[0]).toBeLessThan(onLost.mock.invocationCallOrder[0]);
  });

  it("tracks commander damage from each opposing commander, partners apart, and asks at 21", async () => {
    const user = userEvent.setup();
    const thrasios = `${ID(2)}:0:0`;
    const { onCounter, onLost } = phone(duel({ matches: [match("m1", 1, 2, { countersA: { poison: 0, commander: { [thrasios]: 20 } } }), match("m2", 3, 4)] }), 1);
    expect(screen.getByLabelText("Thrasios: 20 of 21")).toBeTruthy();
    expect(screen.getByLabelText("Tymna: 0 of 21")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add 1 commander damage from Tymna" }));
    await user.click(screen.getByRole("button", { name: "Add 1 commander damage from Thrasios" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Thrasios has dealt you 21 commander damage\./)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Yes, I lost" }));
    await waitFor(() => expect(onLost).toHaveBeenCalledWith("m1", "a", { reason: "commander", winnerId: null }));
    expect(onCounter).toHaveBeenCalledWith({ matchId: "m1", side: "a" }, "commander", thrasios, 1);
    expect(onCounter).toHaveBeenCalledWith({ matchId: "m1", side: "a" }, "commander", `${ID(2)}:0:1`, 1);
  });

  it("uses 15 poison for a Two-Headed Giant team", () => {
    render(
      <LifeCounter
        life={60}
        startingLife={60}
        title="Table 1 · vs Casey & Drew"
        elapsed={null}
        others={[]}
        team
        poison={0}
        poisonLimit={15}
        outcome="the game goes to them"
        onChange={async () => true}
        onCounter={async () => true}
        onLost={async () => true}
      />,
    );
    expect(screen.getByLabelText("Poison: 0 of 15")).toBeTruthy();
  });
});

describe("every way to lose", () => {
  it("offers each way, and in free-for-all an alternate win asks who won and ends the game for everyone", async () => {
    const user = userEvent.setup();
    const pod: TournamentPod = {
      id: "pod-1",
      round: 1,
      table: 1,
      startedAt: T0,
      endedAt: null,
      players: [1, 2, 3, 4].map((n, i) => ({ id: `seat-${n}`, entrantId: ID(n), seat: i + 1, life: null, outAt: null, place: null })),
    };
    const { onPodOut } = phone(duel({ format: "ffa", tableSize: 4, matches: [], pods: [pod] }), 1);
    await user.click(screen.getByRole("button", { name: "I lost this game" }));
    const dialog = await screen.findByRole("dialog");
    const reasons = within(dialog).getAllByRole("radio").map((r) => r.textContent);
    expect(reasons).toEqual(["Life total", "Commander damage", "Poison", "Alt win con", "Decked", "A card said I lose", "Conceded"]);
    await user.click(within(dialog).getByRole("radio", { name: "Alt win con" }));
    const confirm = within(dialog).getByRole("button", { name: "Yes, I lost" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.selectOptions(within(dialog).getByLabelText("Who won?"), "Casey");
    expect(within(dialog).getByText("Pick how, then confirm and Casey wins the game and everyone else still in shares 2nd.")).toBeTruthy();
    await user.click(confirm);
    await waitFor(() => expect(onPodOut).toHaveBeenCalledWith("seat-1", { reason: "alt_win", winnerId: ID(3) }));
  });
});

describe("ready-up on the phone", () => {
  const over = (extra: Partial<TournamentDetail> = {}) =>
    duel({ matches: [match("m1", 1, 2, { result: "b", reportedAt: T0, endedAt: T0, lossReason: "commander" }), match("m2", 3, 4)], ...extra });

  it("asks a player whose game is over to ready up", async () => {
    const user = userEvent.setup();
    const { onReady } = phone(over(), 1);
    expect(screen.getByRole("heading", { name: "Ready for round 2?" })).toBeTruthy();
    expect(screen.getByText(/round 2 starts once everyone is \(0 of 4 ready\)/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "I'm ready" }));
    expect(onReady).toHaveBeenCalledWith(ID(1), true);
  });

  it("shows who they're waiting on once ready, and lets them take it back", async () => {
    const user = userEvent.setup();
    const t = over({ entrants: entrants.map((e) => (e.id === ID(1) || e.id === ID(2) ? { ...e, readyFor: 2 } : e)) });
    const { onReady } = phone(t, 1);
    expect(screen.getByRole("heading", { name: "You're ready" })).toBeTruthy();
    expect(screen.getByText(/2 of 4 so far\. Waiting on Casey, Drew\./)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Not ready yet" }));
    expect(onReady).toHaveBeenCalledWith(ID(1), false);
  });

  it("doesn't ask while their game is still going", () => {
    phone(over(), 3);
    expect(screen.queryByRole("heading", { name: /Ready for round/ })).toBeNull();
  });
});

describe("on the TV", () => {
  it("shows how a game was lost, who's ready, and poison and commander damage in games still going", () => {
    const t = duel({
      entrants: entrants.map((e) => (e.id === ID(2) ? { ...e, readyFor: 2 } : e)),
      matches: [
        match("m1", 1, 2, { result: "b", reportedAt: T0, endedAt: T0, lossReason: "commander" }),
        match("m2", 3, 4, { countersA: { poison: 3, commander: { [`${ID(4)}:0:0`]: 14 } } }),
      ],
    });
    render(<BracketDisplay {...display} tv me={null} tournament={t} />);
    expect(screen.getByText("Lost · Commander damage")).toBeTruthy();
    expect(screen.getByText(/Ready for round 2:/).textContent).toBe("Ready for round 2: 1 of 4 · waiting on Alex, Casey, Drew");
    expect(screen.getAllByText("Ready")).toHaveLength(1);
    expect(screen.getByText("☠ 3 poison")).toBeTruthy();
    expect(screen.getByText("⚔ 14 cmdr")).toBeTruthy();
  });
});

// ─────────────────────────── admin ───────────────────────────

type Init = { method: string; body?: Record<string, unknown> };
function summary(t: TournamentDetail): TournamentSummary {
  return { id: t.id, name: t.name, format: t.format, status: t.status, currentRound: t.currentRound, entrantCount: t.entrants.length, createdAt: t.createdAt, finishedAt: t.finishedAt };
}

describe("admin", () => {
  beforeEach(() => {
    api.adminFetch.mockReset();
  });

  it("shows who's ready for the next round and how games were lost", async () => {
    const t = duel({
      entrants: entrants.map((e) => (e.id === ID(1) || e.id === ID(2) ? { ...e, readyFor: 2 } : e)),
      matches: [
        match("m1", 1, 2, { result: "a", reportedAt: T0, endedAt: T0, lossReason: "poison" }),
        match("m2", 3, 4, { result: "b", reportedAt: T0, endedAt: T0 }),
      ],
    });
    api.adminFetch.mockImplementation(async (path: string, init?: Init) => {
      if (!init || init.method === "GET") return path.includes("?id=") ? { tournament: t } : { tournaments: [summary(t)] };
      return { tournament: t };
    });
    render(
      <ToastProvider>
        <TournamentsPage query={new URLSearchParams("id=t1")} onNavigate={vi.fn()} />
      </ToastProvider>,
    );
    expect(await screen.findByText("2 of 4 ready for round 2")).toBeTruthy();
    expect(screen.getByText(/Waiting on Casey, Drew\. .*round 2 starts on its own/)).toBeTruthy();
    const table1 = screen.getByRole("group", { name: "Table 1: Alex vs Blair" });
    expect(within(table1).getByText("Poison")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Pair round 2" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

// ─────────────────────────── phone page ───────────────────────────

describe("player display page", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });
  const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));

  it("sends poison for the player's side, keeps it through an older refresh, and readies up after the game", async () => {
    const { act } = await import("@testing-library/react");
    const user = userEvent.setup();
    let view = duel({ serverTime: "2026-11-27T20:09:59.000Z" });
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.action === "counter") return new Response(JSON.stringify({ ok: true, value: 1, serverTime: "2026-11-27T20:10:00.000Z" }));
      return new Response(JSON.stringify({ ok: true, tournament: view, started: false }));
    });
    window.localStorage.setItem("gg-tournament-me:tokentokentokent", JSON.stringify({ entrantId: ID(2), seat: 0, name: "Blair" }));
    window.history.replaceState(null, "", "/tournament?t=tokentokentokentokentoken");
    const { default: TournamentPage } = await import("../src/store/pages/TournamentPage");
    render(<TournamentPage />);

    await user.click(await screen.findByRole("button", { name: "Add a poison counter" }));
    await waitFor(() =>
      expect(bodies().find((b) => b.action === "counter")).toEqual({
        token: "tokentokentokentokentoken",
        action: "counter",
        matchId: "m1",
        side: "b",
        kind: "poison",
        source: "",
        delta: 1,
      }),
      { timeout: 2000 },
    );
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(bodies().filter((b) => b.action === "get").length).toBeGreaterThan(1));
    expect(screen.getByLabelText("Poison: 1 of 10")).toBeTruthy();

    // Their game ends: ready up.
    view = duel({
      serverTime: "2026-11-27T20:20:00.000Z",
      matches: [match("m1", 1, 2, { result: "a", reportedAt: T0, endedAt: T0 }), match("m2", 3, 4)],
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await user.click(await screen.findByRole("button", { name: "I'm ready" }));
    await waitFor(() => expect(bodies().find((b) => b.action === "ready")).toEqual({ token: "tokentokentokentokentoken", action: "ready", entrantId: ID(2), ready: true }));
  });
});
