// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import { BracketDisplay } from "../src/admin/components/tournaments/BracketDisplay";
import type { TournamentDetail, TournamentPod, TournamentSummary } from "../src/admin/utils/tournament";

// Free-for-all on screen: table cards on the TV with everyone's life and
// places, the phone counter listing the whole table ("Did you lose?" says
// where you'll finish), the admin's Out / Call it / Undo controls and
// players-per-table, the create form, and the phone page not letting an
// older refresh undo a life change.

const api = vi.hoisted(() => ({ adminFetch: vi.fn() }));
vi.mock("../src/admin/repositories/apiClient", () => ({ adminFetch: api.adminFetch }));
const { TournamentsPage } = await import("../src/admin/pages/TournamentsPage");

const T0 = "2026-11-27T20:00:00.000Z";
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const NAMES = ["Alex", "Blair", "Casey", "Drew", "Emery", "Finley"];
const entrants = NAMES.map((name, i) => ({ id: ID(i + 1), players: [name], commanders: [null], droppedAt: null, createdAt: T0 }));

/** A table: [entrant index, life, place] per seat. */
function pod(round: number, table: number, seats: [number, number | null, number | null][], ended = false): TournamentPod {
  return {
    id: `pod-${round}-${table}`,
    round,
    table,
    startedAt: T0,
    endedAt: ended ? "2026-11-27T20:41:23.000Z" : null,
    players: seats.map(([i, life, place], s) => ({
      id: `seat-${round}-${i}`,
      entrantId: ID(i + 1),
      seat: s + 1,
      life,
      outAt: place != null && !(ended && place === 1) ? T0 : null,
      place,
    })),
  };
}

function ffa(extra: Partial<TournamentDetail> = {}): TournamentDetail {
  return {
    id: "t1",
    name: "Big game",
    format: "ffa",
    status: "active",
    currentRound: 1,
    createdAt: T0,
    finishedAt: null,
    entrants,
    matches: [],
    spots: null,
    startingLife: 40,
    tableSize: 4,
    pods: [
      pod(1, 1, [
        [0, 31, null],
        [1, 6, null],
        [2, 0, 4],
        [3, 22, null],
      ]),
      pod(1, 2, [
        [4, null, 1],
        [5, 3, 2],
      ], true),
    ],
    serverTime: T0,
    ...extra,
  };
}

afterEach(() => cleanup());

const display = {
  tv: true,
  shareUrl: "https://geega-games.com/tournament?t=tok",
  logoSrc: "/logo.png",
  me: null,
  onPickMe: () => undefined,
  onSaveCommander: async () => true,
  searchCommanders: async () => [],
  updatedAt: null,
};

describe("on the TV", () => {
  it("shows every table with each player's life, who's out and where they finished, and the winner", () => {
    render(<BracketDisplay {...display} tournament={ffa()} />);
    expect(screen.getByText("Free-for-all")).toBeTruthy();
    expect(screen.getByText("Round 1 · 1 of 2 games over")).toBeTruthy();
    const now = screen.getByRole("region", { name: /Now playing · Round 1/ });
    const table1 = within(now).getByText("Table 1").closest("li")!;
    expect(within(table1).getByText(/3 of 4 left/)).toBeTruthy();
    expect(within(table1).getByLabelText("31 life")).toBeTruthy();
    expect(within(table1).getByLabelText("6 life").className).toContain("is-low");
    expect(within(table1).getByText("Out · 4th")).toBeTruthy();
    const table2 = within(now).getByText("Table 2").closest("li")!;
    expect(within(table2).getByText("Game over · 41:23")).toBeTruthy();
    expect(within(table2).getByText("Won")).toBeTruthy();
    expect(within(table2).getByText("Out · 2nd")).toBeTruthy();
  });

  it("scores by finishing place in the standings", () => {
    render(<BracketDisplay {...display} tournament={ffa()} />);
    const standings = screen.getByRole("table");
    const rows = within(standings)
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    // Emery won a 2-player table (2 points, a win); Finley (2nd of 2) and Casey (4th of 4) have 1 each.
    expect(rows.slice(0, 3)).toEqual([
      ["1", "EEmery", "1", "2"],
      ["2", "CCasey", "0", "1"],
      ["2", "FFinley", "0", "1"],
    ]);
    expect(screen.getByRole("columnheader", { name: "Pts" })).toBeTruthy();
  });

  it("crowns the leader when it's over", () => {
    render(<BracketDisplay {...display} tournament={ffa({ status: "finished" })} />);
    expect(screen.getByRole("status").textContent).toContain("Emery");
  });
});

describe("on a player's phone", () => {
  const phone = (me: number, t = ffa(), extra = {}) => {
    const onChangePodLife = vi.fn(async () => true);
    const onPodOut = vi.fn(async () => true);
    render(
      <ToastProvider>
        <BracketDisplay
          {...display}
          tv={false}
          tournament={t}
          me={{ entrantId: ID(me + 1), seat: 0 }}
          onChangePodLife={onChangePodLife}
          onPodOut={onPodOut}
          {...extra}
        />
      </ToastProvider>,
    );
    return { onChangePodLife, onPodOut };
  };

  it("tracks their life with everyone at the table listed, and sends changes for their seat", async () => {
    const user = userEvent.setup();
    const { onChangePodLife } = phone(0);
    expect(screen.getByRole("heading", { name: "Table 1 · 4-player game" })).toBeTruthy();
    expect(screen.getByLabelText("You: 31 life")).toBeTruthy();
    const others = screen.getByRole("list", { name: "Everyone else at the table" });
    expect(within(others).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Blair6", "CaseyOut · 4th", "Drew22"]);
    await user.click(screen.getByRole("button", { name: "Lose 5 life" }));
    await waitFor(() => expect(onChangePodLife).toHaveBeenCalledWith("seat-1-0", -5), { timeout: 2000 });
  });

  it("asks 'Did you lose?' at 0 and says where they'll finish", async () => {
    const user = userEvent.setup();
    const { onPodOut } = phone(1);
    for (let i = 0; i < 6; i += 1) await user.click(screen.getByRole("button", { name: "Lose 1 life" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Your life is at 0. If you lost, you're out and finish 3rd of 4.")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Yes, I lost" }));
    await waitFor(() => expect(onPodOut).toHaveBeenCalledWith("seat-1-1", { reason: "life", winnerId: null }));
  });

  it("names the winner when only two are left", async () => {
    const user = userEvent.setup();
    const t = ffa({
      pods: [pod(1, 1, [[0, 31, null], [1, 0, 3], [2, 0, 4], [3, 22, null]])],
    });
    phone(3, t);
    await user.click(screen.getByRole("button", { name: "I lost this game" }));
    expect(within(await screen.findByRole("dialog")).getByText("Pick how, then confirm and you finish 2nd of 4 and Alex wins the game.")).toBeTruthy();
  });

  it("shows where they finished once they're out, and their commander form again", () => {
    phone(2);
    expect(screen.queryByLabelText(/You: .* life/)).toBeNull();
    expect(screen.getByText("You're out · 4th of 4")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your commander" })).toBeTruthy();
  });

  it("celebrates a win", () => {
    phone(4);
    expect(screen.getByText("You won!")).toBeTruthy();
  });
});

// ─────────────────────────── admin ───────────────────────────

type Init = { method: string; body?: Record<string, unknown> };
function summary(t: TournamentDetail): TournamentSummary {
  return { id: t.id, name: t.name, format: t.format, status: t.status, currentRound: t.currentRound, entrantCount: t.entrants.length, createdAt: t.createdAt, finishedAt: t.finishedAt };
}
function serve(current: { t: TournamentDetail | null }, onPost: (body: Record<string, unknown>) => unknown = () => ({ tournament: current.t })) {
  api.adminFetch.mockImplementation(async (path: string, init?: Init) => {
    if (!init || init.method === "GET") {
      if (path.includes("?id=")) return { tournament: current.t };
      return { tournaments: current.t ? [summary(current.t)] : [] };
    }
    return onPost(init.body ?? {});
  });
}
const posts = () =>
  api.adminFetch.mock.calls.filter(([, init]) => init && (init as Init).method === "POST").map(([, init]) => (init as Init).body);
function renderAdmin(query = "id=t1") {
  render(
    <ToastProvider>
      <TournamentsPage query={new URLSearchParams(query)} onNavigate={vi.fn()} />
    </ToastProvider>,
  );
}

describe("admin: running a free-for-all", () => {
  beforeEach(() => {
    api.adminFetch.mockReset();
  });

  it("shows each table, marks players out, calls a game and takes back the last out", async () => {
    const user = userEvent.setup();
    serve({ t: ffa() });
    renderAdmin();
    const table1 = await screen.findByRole("list", { name: "Table 1" });
    expect(within(table1).getByText("31")).toBeTruthy();
    expect(within(table1).getByText("4th")).toBeTruthy();
    expect(screen.getByText("1 of 2 games over")).toBeTruthy();

    await user.click(within(table1).getByRole("button", { name: "Blair is out" }));
    await waitFor(() => expect(posts()[0]).toEqual({ action: "knock-out", id: "t1", podPlayerId: "seat-1-1" }));

    await user.selectOptions(screen.getByLabelText("Time's up? Call it for"), "Drew");
    await waitFor(() => expect(posts()[1]).toEqual({ action: "pod-winner", id: "t1", podId: "pod-1-1", entrantId: ID(4) }));

    await user.click(screen.getAllByRole("button", { name: "Undo last out" })[0]);
    await waitFor(() => expect(posts()[2]).toEqual({ action: "pod-undo", id: "t1", podId: "pod-1-1" }));
  });

  it("deals the next round once every game is over", async () => {
    const user = userEvent.setup();
    const current = { t: ffa() };
    serve(current);
    renderAdmin();
    const deal = await screen.findByRole("button", { name: "Deal round 2" });
    expect((deal as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Finish the last game in round 1 first.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Re-deal round 1" })).toBeNull();
    cleanup();

    current.t = ffa({ pods: [pod(1, 1, [[0, null, 1], [1, null, 2], [2, null, 3], [3, null, 4]], true), ffa().pods[1]] });
    renderAdmin();
    await user.click(await screen.findByRole("button", { name: "Deal round 2" }));
    await waitFor(() => expect(posts()[0]).toEqual({ action: "pair", id: "t1", round: 2 }));
  });

  it("re-deals a round nobody has gone out of yet", async () => {
    const user = userEvent.setup();
    serve({ t: ffa({ pods: [pod(1, 1, [[0, null, null], [1, null, null], [2, null, null]]), pod(1, 2, [[3, null, null], [4, null, null], [5, null, null]])] }) });
    renderAdmin();
    await user.click(await screen.findByRole("button", { name: "Re-deal round 1" }));
    await waitFor(() => expect(posts()[0]).toEqual({ action: "pair", id: "t1", round: 1, replace: true }));
  });

  it("scores by finishing place, and changes the players per table", async () => {
    const user = userEvent.setup();
    serve({ t: ffa() });
    renderAdmin();
    expect(await screen.findByText(/Points by finishing place/)).toBeTruthy();
    expect(screen.getByText("Finished 1st of 2")).toBeTruthy();
    expect(screen.getByText("· Tables of up to 4")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Change players per table" }));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("Most players per table");
    await user.clear(field);
    await user.type(field, "8");
    expect(within(dialog).getByText(/With 6 players: one table of 6/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts()[0]).toEqual({ action: "table-size", id: "t1", tableSize: 8 }));
  });

  it("says what dropping someone mid-game does", async () => {
    const user = userEvent.setup();
    serve({ t: ffa() });
    renderAdmin();
    await user.click(await screen.findByRole("button", { name: "Drop Drew" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/They're out of their game at table 1 and finish 3rd\./)).toBeTruthy();
  });

  it("explains the tables before round 1", async () => {
    serve({ t: ffa({ currentRound: 0, pods: [] }) });
    renderAdmin();
    expect(await screen.findByText(/Round 1 deals them onto two tables of 3\./)).toBeTruthy();
  });
});

describe("admin: creating a free-for-all", () => {
  beforeEach(() => {
    api.adminFetch.mockReset();
  });

  it("sends the players per table with the format", async () => {
    const user = userEvent.setup();
    const current: { t: TournamentDetail | null } = { t: null };
    serve(current, (body) => {
      current.t = ffa({ currentRound: 0, pods: [], tableSize: body.tableSize as number });
      return { id: "t1", tournament: current.t };
    });
    renderAdmin("");
    await user.click(await screen.findByRole("radio", { name: /Free-for-all/ }));
    const size = screen.getByLabelText("Most players per table");
    expect((size as HTMLInputElement).value).toBe("4");
    await user.clear(size);
    await user.type(size, "8");
    await user.click(screen.getByRole("radio", { name: /I'll enter names/ }));
    await user.type(screen.getByLabelText("Players"), "Alex\nBlair");
    await user.click(screen.getByRole("button", { name: "Create tournament" }));
    expect(await screen.findByText("Add at least 3 players.")).toBeTruthy();
    await user.type(screen.getByLabelText("Players"), "\nCasey");
    await user.click(screen.getByRole("button", { name: "Create tournament" }));
    await waitFor(() =>
      expect(posts()[0]).toMatchObject({ action: "create", format: "ffa", tableSize: 8, startingLife: 40, entrants: [["Alex"], ["Blair"], ["Casey"]] }),
    );
  });
});

// ─────────────────────────── phone page ───────────────────────────

describe("player display page: free-for-all life", () => {
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

  it("sends life for the player's seat, and an older refresh doesn't undo it", async () => {
    const user = userEvent.setup();
    let view = ffa({ serverTime: "2026-11-27T20:09:59.000Z" });
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.action === "pod-life") return new Response(JSON.stringify({ ok: true, life: 28, serverTime: "2026-11-27T20:10:00.000Z" }));
      return new Response(JSON.stringify({ ok: true, tournament: view }));
    });
    window.localStorage.setItem("gg-tournament-me:tokentokentokent", JSON.stringify({ entrantId: ID(1), seat: 0, name: "Alex" }));
    window.history.replaceState(null, "", "/tournament?t=tokentokentokentokentoken");
    const { default: TournamentPage } = await import("../src/store/pages/TournamentPage");
    render(<TournamentPage />);

    for (let i = 0; i < 3; i += 1) await user.click(await screen.findByRole("button", { name: "Lose 1 life" }));
    await waitFor(
      () =>
        expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body))).find((b) => b.action === "pod-life")).toEqual({
          token: "tokentokentokentokentoken",
          action: "pod-life",
          podPlayerId: "seat-1-0",
          delta: -3,
        }),
      { timeout: 2000 },
    );
    expect(screen.getByLabelText("You: 28 life")).toBeTruthy();

    view = ffa({ serverTime: "2026-11-27T20:09:59.500Z" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => JSON.parse(String(init.body)).action === "get").length).toBeGreaterThan(1));
    expect(screen.getByLabelText("You: 28 life")).toBeTruthy();

    view = ffa({ serverTime: "2026-11-27T20:10:05.000Z", pods: [pod(1, 1, [[0, 25, null], [1, 6, null], [2, 0, 4], [3, 22, null]]), ffa().pods[1]] });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(screen.getByLabelText("You: 25 life")).toBeTruthy());
  });
});
