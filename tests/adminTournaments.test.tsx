// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import { NAV_ITEMS, SECTION_TITLES } from "../src/admin/components/layout/nav";
import type { TournamentDetail, TournamentMatch, TournamentSummary } from "../src/admin/utils/tournament";

// Admin → Tournaments: the create form (1v1, random or typed Two-Headed Giant
// teams) and a running tournament (tap a winner, pair the next round when
// every result is in, standings, finish when nobody has a new opponent).
// The server is a stand-in: these tests are about what staff see and exactly
// what each tap sends.

const api = vi.hoisted(() => ({ adminFetch: vi.fn() }));
vi.mock("../src/admin/repositories/apiClient", () => ({ adminFetch: api.adminFetch }));

const { TournamentsPage } = await import("../src/admin/pages/TournamentsPage");

const T0 = "2026-11-27T20:00:00.000Z";
const entrant = (id: string, players: string[]) => ({ id, players, commanders: players.map(() => null), droppedAt: null, createdAt: T0 });
const match = (id: string, round: number, table: number, a: string, b: string | null, result: TournamentMatch["result"]) => ({
  id,
  round,
  table,
  a,
  b,
  result,
  reportedAt: result === "a" || result === "b" || result === "draw" ? T0 : null,
});

function detail(extra: Partial<TournamentDetail> = {}): TournamentDetail {
  return {
    id: "t1",
    name: "Friday 1v1",
    format: "1v1",
    status: "active",
    currentRound: 1,
    createdAt: T0,
    finishedAt: null,
    entrants: [entrant("a", ["Alex"]), entrant("b", ["Blair"]), entrant("c", ["Casey"]), entrant("d", ["Drew"])],
    matches: [match("m1", 1, 1, "a", "b", "pending"), match("m2", 1, 2, "c", "d", "pending")],
    spots: null,
    ...extra,
  };
}

function summary(t: TournamentDetail): TournamentSummary {
  return {
    id: t.id,
    name: t.name,
    format: t.format,
    status: t.status,
    currentRound: t.currentRound,
    entrantCount: t.entrants.length,
    createdAt: t.createdAt,
    finishedAt: t.finishedAt,
  };
}

type Init = { method: string; body?: Record<string, unknown> };

/** Routes adminFetch: GET list / GET one / POST actions handled by `onPost`. */
function serve(current: { t: TournamentDetail | null }, onPost: (body: Record<string, unknown>) => unknown = () => ({})) {
  api.adminFetch.mockImplementation(async (path: string, init?: Init) => {
    if (!init || init.method === "GET") {
      if (path.includes("?id=")) return { tournament: current.t };
      return { tournaments: current.t ? [summary(current.t)] : [] };
    }
    return onPost(init.body ?? {});
  });
}

function renderPage(query = "") {
  const onNavigate = vi.fn();
  render(
    <ToastProvider>
      <TournamentsPage query={new URLSearchParams(query)} onNavigate={onNavigate} />
    </ToastProvider>,
  );
  return onNavigate;
}

const posts = () =>
  api.adminFetch.mock.calls.filter(([, init]) => init && (init as Init).method === "POST").map(([, init]) => (init as Init).body);

beforeEach(() => {
  api.adminFetch.mockReset();
});
afterEach(() => cleanup());

describe("navigation", () => {
  it("has a Tournaments section in the dashboard", () => {
    expect(NAV_ITEMS.find((i) => i.key === "tournaments")).toMatchObject({ label: "Tournaments", icon: "trophy" });
    expect(SECTION_TITLES.tournaments).toBe("Tournaments");
  });
});

describe("creating a tournament", () => {
  it("opens the form when there are none, and creates a 1v1 from one name per line", async () => {
    const user = userEvent.setup();
    const current: { t: TournamentDetail | null } = { t: null };
    serve(current, (body) => {
      current.t = detail({ currentRound: 0, matches: [] });
      return { id: "t1", tournament: current.t, body };
    });
    renderPage();
    await screen.findByRole("heading", { name: "New tournament" });
    await user.click(screen.getByRole("radio", { name: /I'll enter names/ }));
    await user.type(screen.getByLabelText("Players"), "Alex\nBlair\n\nCasey");
    expect(screen.getByText("3 players")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create tournament" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({ action: "create", format: "1v1", entrants: [["Alex"], ["Blair"], ["Casey"]] });
    expect(await screen.findByRole("button", { name: "Start round 1" })).toBeTruthy();
  });

  it("makes random Two-Headed Giant teams, and wants an even number of players", async () => {
    const user = userEvent.setup();
    serve({ t: null }, () => ({ id: "t1", tournament: detail({ format: "2hg", currentRound: 0, matches: [] }) }));
    renderPage();
    await screen.findByRole("heading", { name: "New tournament" });
    await user.click(screen.getByRole("radio", { name: /Two-Headed Giant/ }));
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toMatch(/^Two-Headed Giant · /);
    await user.click(screen.getByRole("radio", { name: /I'll enter names/ }));

    await user.type(screen.getByLabelText("Players"), "Alex\nBlair\nCasey");
    await user.click(screen.getByRole("button", { name: "Create tournament" }));
    expect(await screen.findByText(/needs an even number of players/)).toBeTruthy();
    expect(posts()).toHaveLength(0);

    await user.type(screen.getByLabelText("Players"), "\nDrew");
    expect(screen.getByText("2 teams")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shuffle teams" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create tournament" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const entrants = posts()[0]!.entrants as string[][];
    expect(entrants).toHaveLength(2);
    expect(entrants.every((team) => team.length === 2)).toBe(true);
    expect(entrants.flat().sort()).toEqual(["Alex", "Blair", "Casey", "Drew"]);
  });

  it("takes typed teams and points out a line that isn't two names", async () => {
    const user = userEvent.setup();
    serve({ t: null }, () => ({ id: "t1", tournament: detail({ format: "2hg", currentRound: 0, matches: [] }) }));
    renderPage();
    await screen.findByRole("heading", { name: "New tournament" });
    await user.click(screen.getByRole("radio", { name: /Two-Headed Giant/ }));
    await user.click(screen.getByRole("radio", { name: /I'll enter names/ }));
    await user.click(screen.getByRole("radio", { name: "I'll set the teams" }));
    await user.type(screen.getByLabelText("Teams"), "Alex & Sam\nJo");
    await user.click(screen.getByRole("button", { name: "Create tournament" }));
    expect(await screen.findByText(/Each line needs two names/)).toBeTruthy();
    expect(posts()).toHaveLength(0);
    await user.type(screen.getByLabelText("Teams"), " + Kim");
    await user.click(screen.getByRole("button", { name: "Create tournament" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({
      format: "2hg",
      entrants: [
        ["Alex", "Sam"],
        ["Jo", "Kim"],
      ],
    });
  });
});

describe("running a tournament", () => {
  it("records a winner with one tap and pairs the next round once every result is in", async () => {
    const user = userEvent.setup();
    const current = { t: detail() as TournamentDetail | null };
    serve(current, (body) => {
      if (body.action === "report") {
        current.t = {
          ...current.t!,
          matches: current.t!.matches.map((m) =>
            m.id === body.matchId ? { ...m, result: body.result as TournamentMatch["result"], reportedAt: T0 } : m,
          ),
        };
      }
      if (body.action === "pair") {
        current.t = {
          ...current.t!,
          currentRound: 2,
          matches: [...current.t!.matches, match("m3", 2, 1, "a", "c", "pending"), match("m4", 2, 2, "b", "d", "pending")],
        };
      }
      return { tournament: current.t };
    });
    renderPage("id=t1");

    const pairBtn = await screen.findByRole("button", { name: "Pair round 2" });
    expect((pairBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Record the 2 results still open in round 1 first/)).toBeTruthy();

    const table1 = screen.getByRole("group", { name: "Table 1: Alex vs Blair" });
    await user.click(within(table1).getByRole("button", { name: "Alex won" }));
    expect(posts()[0]).toEqual({ action: "report", id: "t1", matchId: "m1", result: "a" });
    expect(within(table1).getByRole("button", { name: /Alex won/, pressed: true })).toBeTruthy();

    const table2 = screen.getByRole("group", { name: "Table 2: Casey vs Drew" });
    await user.click(within(table2).getByRole("button", { name: "Drew won" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Pair round 2" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText("2 of 2 results in")).toBeTruthy();

    // Standings: Alex and Drew 1-0.
    const standings = screen.getByRole("table");
    const alexRow = within(standings).getByText("Alex").closest("tr")!;
    expect(within(alexRow).getAllByRole("cell").map((c) => c.textContent)).toEqual(
      expect.arrayContaining(["Alex", "1", "0", "0", "3"].map((v) => expect.stringContaining(v))),
    );

    await user.click(screen.getByRole("button", { name: "Pair round 2" }));
    await waitFor(() => expect(posts().at(-1)).toEqual({ action: "pair", id: "t1", round: 2 }));
    expect(await screen.findByRole("heading", { name: "Round 2" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Earlier rounds" })).toBeTruthy();
  });

  it("taps the winner again to clear this round's result", async () => {
    const user = userEvent.setup();
    const current = { t: detail({ matches: [match("m1", 1, 1, "a", "b", "a"), match("m2", 1, 2, "c", "d", "pending")] }) };
    serve(current as { t: TournamentDetail | null }, () => ({ tournament: current.t }));
    renderPage("id=t1");
    const table1 = await screen.findByRole("group", { name: "Table 1: Alex vs Blair" });
    await user.click(within(table1).getByRole("button", { name: /Alex won/, pressed: true }));
    expect(posts()[0]).toEqual({ action: "report", id: "t1", matchId: "m1", result: "pending" });
  });

  it("shows a bye, and re-pairs a round with no results yet", async () => {
    const user = userEvent.setup();
    const current = {
      t: detail({
        entrants: [entrant("a", ["Alex"]), entrant("b", ["Blair"]), entrant("c", ["Casey"])],
        matches: [match("m1", 1, 1, "a", "b", "pending"), match("m2", 1, 2, "c", null, "bye")],
      }),
    };
    serve(current as { t: TournamentDetail | null }, () => ({ tournament: current.t }));
    renderPage("id=t1");
    expect(await screen.findByText(/sits out this round and gets the win/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Re-pair round 1" }));
    await waitFor(() => expect(posts()[0]).toEqual({ action: "pair", id: "t1", round: 1, replace: true }));
  });

  it("offers to finish once everyone has played everyone, and shows the winner", async () => {
    const user = userEvent.setup();
    const all = detail({
      entrants: [entrant("a", ["Alex"]), entrant("b", ["Blair"])],
      matches: [match("m1", 1, 1, "a", "b", "a")],
    });
    const current = { t: all as TournamentDetail | null };
    serve(current, (body) => {
      if (body.action === "finish") current.t = { ...all, status: "finished", finishedAt: T0 };
      return { tournament: current.t };
    });
    renderPage("id=t1");
    expect(await screen.findByText(/no new pairings left/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pair round 2" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Finish tournament" }));
    await waitFor(() => expect(posts()[0]).toEqual({ action: "finish", id: "t1" }));
    expect(await screen.findByText(/Winner:/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();
    // Finished: results are read-only.
    expect((screen.getByRole("button", { name: /Alex won/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("adds a late Two-Headed Giant team and drops a team with a confirm", async () => {
    const user = userEvent.setup();
    const current = {
      t: detail({
        format: "2hg",
        name: "2HG",
        entrants: [entrant("a", ["Alex", "Sam"]), entrant("b", ["Jo", "Kim"])],
        matches: [match("m1", 1, 1, "a", "b", "pending")],
      }),
    };
    serve(current as { t: TournamentDetail | null }, () => ({ tournament: current.t }));
    renderPage("id=t1");
    await screen.findByRole("group", { name: "Table 1: Alex & Sam vs Jo & Kim" });

    await user.type(screen.getByLabelText("Player 1"), "Pat");
    await user.click(screen.getByRole("button", { name: "Add team" }));
    expect(await screen.findByText("A Two-Headed Giant team needs two player names.")).toBeTruthy();
    await user.type(screen.getByLabelText("Player 2"), "Lee");
    await user.click(screen.getByRole("button", { name: "Add team" }));
    await waitFor(() => expect(posts()[0]).toEqual({ action: "add-entrant", id: "t1", players: ["Pat", "Lee"] }));

    await user.click(screen.getByRole("button", { name: "Drop Alex & Sam" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Their match this round goes to Jo & Kim/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Drop" }));
    await waitFor(() => expect(posts()[1]).toEqual({ action: "remove-entrant", id: "t1", entrantId: "a" }));
  });

  it("asks before finishing with results still open", async () => {
    const user = userEvent.setup();
    const current = { t: detail() };
    serve(current as { t: TournamentDetail | null }, () => ({ tournament: current.t }));
    renderPage("id=t1");
    await user.click(await screen.findByRole("button", { name: "Finish" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/2 results in round 1 aren't in yet/)).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });
});

describe("player display and commanders (admin)", () => {
  it("shows the display link with a QR code, opens the TV view, and turns the link off", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const current = { t: detail({ share: { token: "tok_abcdefghijklmnopqrstuv", enabled: true } }) };
    serve(current as { t: TournamentDetail | null }, (body) => {
      if (body.action === "share") current.t = { ...current.t, share: { ...current.t.share!, enabled: Boolean(body.enabled) } };
      return { tournament: current.t };
    });
    renderPage("id=t1");
    expect(await screen.findByRole("img", { name: "QR code for the player display" })).toBeTruthy();
    expect(screen.getByText(`${window.location.origin}/tournament?t=tok_abcdefghijklmnopqrstuv`)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Open TV display" }));
    expect(open).toHaveBeenCalledWith(
      `${window.location.origin}/tournament?t=tok_abcdefghijklmnopqrstuv&view=tv`,
      "_blank",
      "noopener,noreferrer",
    );

    await user.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(posts()[0]).toEqual({ action: "share", id: "t1", enabled: false }));
    expect(await screen.findByRole("button", { name: "Turn link on" })).toBeTruthy();
    open.mockRestore();
  });

  it("asks before making a new link", async () => {
    const user = userEvent.setup();
    const current = { t: detail({ share: { token: "tok_abcdefghijklmnopqrstuv", enabled: true } }) };
    serve(current as { t: TournamentDetail | null }, () => ({ tournament: current.t }));
    renderPage("id=t1");
    await user.click(await screen.findByRole("button", { name: "New link" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/stop working/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "New link" }));
    await waitFor(() => expect(posts()[0]).toEqual({ action: "share", id: "t1", rotate: true }));
  });

  it("shows commanders in the standings and edits them with the name", async () => {
    const user = userEvent.setup();
    const t = detail();
    t.entrants[0] = { ...t.entrants[0], commanders: [{ name: "Atraxa, Praetors' Voice", cardId: null }] };
    const current = { t };
    serve(current as { t: TournamentDetail | null }, (body) => {
      if (body.action === "commander-search") return { options: [{ name: "Edgar Markov", cardId: "d0d33d52-3d28-4635-b985-51e126289259" }] };
      return { tournament: current.t };
    });
    renderPage("id=t1");
    expect(await screen.findByText("Atraxa, Praetors' Voice")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Edit Blair" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("combobox", { name: "Commander (optional)" }), "edgar");
    await user.click(await within(dialog).findByRole("option", { name: "Edgar Markov" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(posts().find((b) => b?.action === "rename-entrant")).toEqual({
        action: "rename-entrant",
        id: "t1",
        entrantId: "b",
        players: ["Blair"],
        commanders: [{ name: "Edgar Markov", cardId: "d0d33d52-3d28-4635-b985-51e126289259" }],
      }),
    );
  });
});

describe("sign-ups (admin)", () => {
  it("creates a sign-up tournament with player spots by default, checking them for the format", async () => {
    const user = userEvent.setup();
    serve({ t: null }, () => ({ id: "t1", tournament: detail({ currentRound: 0, matches: [], entrants: [], spots: 6 }) }));
    renderPage();
    await screen.findByRole("heading", { name: "New tournament" });
    expect(screen.getByRole("radio", { name: /Players sign up/, checked: true })).toBeTruthy();
    expect(screen.queryByLabelText("Players")).toBeNull();
    await user.click(screen.getByRole("radio", { name: /Two-Headed Giant/ }));
    const spots = screen.getByLabelText("Player spots");
    await user.clear(spots);
    await user.type(spots, "7");
    await user.click(screen.getByRole("button", { name: "Create tournament" }));
    expect(await screen.findByText("Two-Headed Giant needs an even number of player spots.")).toBeTruthy();
    expect(posts()).toHaveLength(0);
    await user.clear(spots);
    await user.type(spots, "6");
    await user.click(screen.getByRole("button", { name: "Create tournament" }));
    await waitFor(() => expect(posts()[0]).toMatchObject({ action: "create", format: "2hg", entrants: [], spots: 6 }));
  });

  it("shows how many spots are filled, starts early, and changes the spots", async () => {
    const user = userEvent.setup();
    const current = {
      t: detail({
        currentRound: 0,
        matches: [],
        spots: 8,
        entrants: [entrant("a", ["Alex"]), entrant("b", ["Blair"]), entrant("c", ["Casey"]), entrant("d", ["Drew"]), entrant("e", ["Eli"])],
      }),
    };
    serve(current as { t: TournamentDetail | null }, () => ({ tournament: current.t }));
    renderPage("id=t1");
    expect(await screen.findByRole("heading", { name: "Sign-ups" })).toBeTruthy();
    expect(screen.getAllByText("5 of 8 spots filled").length).toBeGreaterThan(0);
    expect(screen.getByText(/Waiting for 3 more players/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Signed up" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Start now with 5" }));
    await waitFor(() => expect(posts()[0]).toEqual({ action: "start", id: "t1" }));

    await user.click(screen.getByRole("button", { name: "Change spots" }));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("Player spots");
    await user.clear(field);
    await user.type(field, "6");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts()[1]).toEqual({ action: "spots", id: "t1", spots: 6 }));
  });

  it("marks Two-Headed Giant sign-ups still without a teammate", async () => {
    const current = {
      t: detail({
        format: "2hg",
        currentRound: 0,
        matches: [],
        spots: 8,
        entrants: [entrant("a", ["Alex", "Sam"]), entrant("b", ["Blair"])],
      }),
    };
    serve(current as { t: TournamentDetail | null }, () => ({ tournament: current.t }));
    renderPage("id=t1");
    expect(await screen.findByText("Needs a teammate")).toBeTruthy();
    expect(screen.getByText(/1 player is waiting for a teammate/)).toBeTruthy();
    expect(screen.getByLabelText("Player 2 (optional)")).toBeTruthy();
  });
});
