// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import { BracketDisplay } from "../src/admin/components/tournaments/BracketDisplay";
import { CommanderPicker } from "../src/admin/components/tournaments/CommanderPicker";
import type { PlayerSeat, TournamentCommander, TournamentDetail, TournamentMatch } from "../src/admin/utils/tournament";

// The player display (/tournament): what players see on the TV and their
// phones, the commander picker, and the page's loading and link states. The
// server is a stand-in.

const T0 = "2026-11-27T20:00:00.000Z";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const D = "00000000-0000-4000-8000-00000000000d";
const ATRAXA = "d0d33d52-3d28-4635-b985-51e126289259";

const entrant = (id: string, players: string[], commanders: (TournamentCommander | null)[] = players.map(() => null)) => ({
  id,
  players,
  commanders,
  droppedAt: null,
  createdAt: T0,
});
const match = (id: string, round: number, table: number, a: string, b: string | null, result: TournamentMatch["result"]) => ({
  id,
  round,
  table,
  a,
  b,
  result,
  reportedAt: null,
  lifeA: null,
  lifeB: null,
  startedAt: T0,
  endedAt: result === "a" || result === "b" || result === "draw" ? T0 : null,
});

function tournament(extra: Partial<TournamentDetail> = {}): TournamentDetail {
  return {
    id: "t1",
    name: "Friday Commander",
    format: "1v1",
    status: "active",
    currentRound: 2,
    createdAt: T0,
    finishedAt: null,
    entrants: [
      entrant(A, ["Alex"], [{ name: "Atraxa, Praetors' Voice", cardId: ATRAXA }]),
      entrant(B, ["Blair"], [{ name: "Thrasios & Tymna", cardId: null }]),
      entrant(C, ["Casey"]),
      entrant(D, ["Drew"]),
    ],
    matches: [
      match("m1", 1, 1, A, B, "a"),
      match("m2", 1, 2, C, D, "draw"),
      match("m3", 2, 1, A, C, "pending"),
      match("m4", 2, 2, B, D, "b"),
    ],
    spots: null,
    startingLife: 40,
    tableSize: null,
    pods: [],
    ...extra,
  };
}

function show(props: Partial<Parameters<typeof BracketDisplay>[0]> = {}) {
  const onSaveCommander = vi.fn(async () => true);
  const onPickMe = vi.fn();
  const onSignUp = vi.fn(async () => true);
  const searchCommanders = vi.fn(async () => [
    { name: "Atraxa, Praetors' Voice", cardId: ATRAXA },
    { name: "Atraxa, Grand Unifier", cardId: "11111111-1111-4111-8111-111111111111" },
  ]);
  const utils = render(
    <ToastProvider>
      <BracketDisplay
        tournament={tournament()}
        tv={false}
        shareUrl="https://geega-games.com/tournament?t=tok"
        tvUrl="https://geega-games.com/tournament?t=tok&view=tv"
        logoSrc="/logo.png"
        me={null}
        onPickMe={onPickMe}
        onSaveCommander={onSaveCommander}
        onSignUp={onSignUp}
        searchCommanders={searchCommanders}
        updatedAt={new Date("2026-11-27T20:05:00")}
        {...props}
      />
    </ToastProvider>,
  );
  return { ...utils, onSaveCommander, onPickMe, onSignUp, searchCommanders };
}

afterEach(() => cleanup());

describe("bracket display", () => {
  it("shows the round being played, results, standings and every round", () => {
    show();
    expect(screen.getByRole("heading", { name: "Friday Commander" })).toBeTruthy();
    expect(screen.getByText("Round 2 · 1 of 2 results in")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^Now playing · Round 2 · \d+:\d\d/ })).toBeTruthy();
    // Commanders show with names; a picked card shows its image.
    expect(screen.getAllByText("Atraxa, Praetors' Voice").length).toBeGreaterThan(0);
    const img = screen.getAllByRole("img", { name: "Atraxa, Praetors' Voice" })[0] as HTMLImageElement;
    expect(img.src).toBe(`https://cards.scryfall.io/small/front/d/0/${ATRAXA}.jpg`);
    // Standings: Alex 1-0-0 (3), Drew 1-0-1 (4) leads.
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain("Drew");
    expect(rows[0].textContent).toContain("1-0-1");
    expect(screen.getByRole("heading", { name: "Rounds" })).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("Card images © Wizards of the Coast, via Scryfall")).toBeTruthy();
  });

  it("on a phone, lets a player find their name and save a commander from the search", async () => {
    const user = userEvent.setup();
    const { onPickMe, rerender, onSaveCommander, searchCommanders } = show();
    expect(screen.queryByRole("img", { name: /QR code/ })).toBeNull();
    await user.selectOptions(screen.getByLabelText("Who are you?"), `${C}:0`);
    expect(onPickMe).toHaveBeenCalledWith({ entrantId: C, seat: 0 });

    const me: PlayerSeat = { entrantId: C, seat: 0 };
    rerender(
      <ToastProvider>
        <BracketDisplay
          tournament={tournament()}
          tv={false}
          shareUrl={null}
          logoSrc="/logo.png"
          me={me}
          onPickMe={onPickMe}
          onSaveCommander={onSaveCommander}
          searchCommanders={searchCommanders}
          updatedAt={null}
        />
      </ToastProvider>,
    );
    // Their table, first thing.
    expect(screen.getByText("vs Alex")).toBeTruthy();
    expect(screen.getByText(/Playing as/).textContent).toContain("Casey");

    const save = screen.getByRole("button", { name: "Save commander" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(screen.getByRole("combobox", { name: "Commander" }), "atr");
    const option = await screen.findByRole("option", { name: "Atraxa, Praetors' Voice" });
    expect(searchCommanders).toHaveBeenCalledWith("atr");
    await user.click(option);
    await user.click(screen.getByRole("button", { name: "Save commander" }));
    expect(onSaveCommander).toHaveBeenCalledWith(me, { name: "Atraxa, Praetors' Voice", cardId: ATRAXA });
  });

  it("on a TV, shows the QR code and leaves out the commander form", () => {
    show({ tv: true });
    expect(screen.getByRole("img", { name: /QR code: open this bracket on your phone/ })).toBeTruthy();
    expect(screen.getByText(/Scan to follow along/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Your commander" })).toBeNull();
  });

  it("shows who's playing before round 1, without empty standings", () => {
    show({ tournament: tournament({ currentRound: 0, matches: [] }) });
    expect(screen.getByRole("heading", { name: "Who's playing" })).toBeTruthy();
    expect(screen.getByText("Starting soon · 4 players")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Standings" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Rounds" })).toBeNull();
  });

  it("crowns the winner when it's over, and locks commanders", () => {
    show({
      tournament: tournament({
        status: "finished",
        finishedAt: T0,
        matches: [match("m1", 1, 1, A, B, "a"), match("m2", 1, 2, C, D, "b"), match("m3", 2, 1, A, D, "a"), match("m4", 2, 2, B, C, "a")],
      }),
    });
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Winner");
    expect(banner.textContent).toContain("Alex");
    expect(screen.getByText("Final standings")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Your commander" })).toBeNull();
  });
});

describe("sign-ups on the player display", () => {
  const signupTournament = (extra: Partial<TournamentDetail> = {}) =>
    tournament({ currentRound: 0, matches: [], spots: 6, entrants: [entrant(A, ["Alex"]), entrant(B, ["Blair"])], ...extra });

  it("lets a player join with their name and commander", async () => {
    const user = userEvent.setup();
    const { onSignUp } = show({ tournament: signupTournament() });
    expect(screen.getByText("Signing up · 2 of 6 spots filled")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Who's in · 2 of 6" })).toBeTruthy();
    expect(screen.getByText("4 open spots")).toBeTruthy();
    expect(screen.queryByLabelText("Teammate")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Join the tournament" }));
    expect(screen.getByText("Enter your name.")).toBeTruthy();
    expect(onSignUp).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Your name/), "  Casey ");
    await user.type(screen.getByRole("combobox", { name: "Commander (optional)" }), "atr");
    await user.click(await screen.findByRole("option", { name: "Atraxa, Praetors' Voice" }));
    await user.click(screen.getByRole("button", { name: "Join the tournament" }));
    expect(onSignUp).toHaveBeenCalledWith({
      name: "Casey",
      commander: { name: "Atraxa, Praetors' Voice", cardId: ATRAXA },
      teamWith: null,
    });
  });

  it("Two-Headed Giant: offers to team up with anyone still alone", async () => {
    const user = userEvent.setup();
    const t = signupTournament({ format: "2hg", entrants: [entrant(A, ["Alex", "Sam"]), entrant(B, ["Blair"])] });
    const { onSignUp } = show({ tournament: t });
    const teammate = screen.getByLabelText("Teammate") as HTMLSelectElement;
    expect([...teammate.options].map((o) => o.textContent)).toEqual(["Give me a random teammate", "Team up with Blair"]);
    expect(screen.getByText("Needs a teammate")).toBeTruthy();
    await user.type(screen.getByLabelText(/Your name/), "Jo");
    await user.selectOptions(teammate, B);
    await user.click(screen.getByRole("button", { name: "Join the tournament" }));
    expect(onSignUp).toHaveBeenCalledWith({ name: "Jo", commander: null, teamWith: B });
  });

  it("tells a signed-up player how many are still to come, and lets them change their commander", () => {
    show({ tournament: signupTournament(), me: { entrantId: B, seat: 0 } });
    expect(screen.getByRole("heading", { name: "You're in!" })).toBeTruthy();
    expect(screen.getByText(/Waiting for 4 more players/)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Commander" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Join the tournament" })).toBeNull();
  });

  it("lets someone already signed up find their name instead", async () => {
    const user = userEvent.setup();
    const { onPickMe } = show({ tournament: signupTournament() });
    await user.click(screen.getByRole("button", { name: "Already signed up? Find your name" }));
    await user.selectOptions(screen.getByLabelText("Who are you?"), `${A}:0`);
    expect(onPickMe).toHaveBeenCalledWith({ entrantId: A, seat: 0 });
  });

  it("on the TV, shows a big code to scan, the count and the open spots", () => {
    show({ tournament: signupTournament(), tv: true });
    expect(screen.getByRole("img", { name: "QR code: scan to sign up" })).toBeTruthy();
    expect(screen.getByText("Scan to join")).toBeTruthy();
    expect(screen.getByText("players in")).toBeTruthy();
    expect(screen.getAllByText("Open spot")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Join the tournament" })).toBeNull();
  });
});

describe("commander picker", () => {
  it("keeps a typed name with no card, and a picked one with its card", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const search = vi.fn(async () => [{ name: "Krenko, Mob Boss", cardId: ATRAXA }]);
    render(<CommanderPicker label="Commander" value={null} onChange={onChange} search={search} />);
    const box = screen.getByRole("combobox", { name: "Commander" });
    await user.type(box, "Thrasios");
    expect(onChange).toHaveBeenLastCalledWith({ name: "Thrasios", cardId: null });
    await user.clear(box);
    expect(onChange).toHaveBeenLastCalledWith(null);
    await user.type(box, "kren");
    await screen.findByRole("option", { name: "Krenko, Mob Boss" });
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ name: "Krenko, Mob Boss", cardId: ATRAXA });
  });

  it("says when search isn't working, and still keeps what was typed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CommanderPicker label="Commander" value={null} onChange={onChange} search={() => Promise.reject(new Error("down"))} />);
    await user.type(screen.getByRole("combobox", { name: "Commander" }), "Yuriko");
    expect(await screen.findByText(/Search isn't working right now/)).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith({ name: "Yuriko", cardId: null });
  });
});

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

  async function openPage(search: string) {
    window.history.replaceState(null, "", `/tournament${search}`);
    const { default: TournamentPage } = await import("../src/store/pages/TournamentPage");
    render(<TournamentPage />);
  }

  it("explains a link without its code", async () => {
    await openPage("");
    expect(screen.getByText("This link is missing its code")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says when a link has been turned off", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, message: "off" }), { status: 404 }));
    await openPage("?t=tokentokentokentokentoken");
    expect(await screen.findByText("This tournament link isn't available")).toBeTruthy();
  });

  it("loads the tournament with the link's code and saves a commander", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: true, tournament: tournament() }), { status: 200, headers: { "x-action": body.action } });
    });
    window.localStorage.setItem("gg-tournament-me:tokentokentokent", `${D}:0`);
    await openPage("?t=tokentokentokentokentoken");
    expect(await screen.findByRole("heading", { name: "Friday Commander" })).toBeTruthy();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ token: "tokentokentokentokentoken", action: "get" });
    // Remembered from last time: Drew.
    expect(screen.getByText(/Playing as/).textContent).toContain("Drew");
    await user.type(screen.getByRole("combobox", { name: "Commander" }), "Edgar Markov");
    await user.click(screen.getByRole("button", { name: "Save commander" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)).action)).toContain("commander"),
    );
    const saved = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body))).find((b) => b.action === "commander");
    expect(saved).toEqual({
      token: "tokentokentokentokentoken",
      action: "commander",
      entrantId: D,
      seat: 0,
      commander: { name: "Edgar Markov", cardId: null },
    });
  });
});

describe("player display page: signing up", () => {
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

  it("signs up, then remembers the player by name even after random teams move them", async () => {
    const user = userEvent.setup();
    const before = tournament({ format: "2hg", currentRound: 0, matches: [], spots: 4, entrants: [entrant(A, ["Alex"])] });
    const joined = { ...before, entrants: [entrant(A, ["Alex"]), entrant(B, ["Blair"])] };
    // Teams made: Blair's row was merged into Alex's.
    const teamed = { ...before, currentRound: 1, entrants: [entrant(A, ["Alex", "Blair"]), entrant(C, ["Casey", "Drew"])] };
    let view: TournamentDetail = before;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.action === "sign-up") {
        view = joined;
        return new Response(JSON.stringify({ ok: true, tournament: view, seat: { entrantId: B, seat: 0 }, started: false }));
      }
      return new Response(JSON.stringify({ ok: true, tournament: view }));
    });
    window.history.replaceState(null, "", "/tournament?t=tokentokentokentokentoken");
    const { default: TournamentPage } = await import("../src/store/pages/TournamentPage");
    const { unmount } = render(<TournamentPage />);
    await user.type(await screen.findByLabelText(/Your name/), "Blair");
    await user.click(screen.getByRole("button", { name: "Join the tournament" }));
    expect(await screen.findByRole("heading", { name: "You're in!" })).toBeTruthy();
    const sent = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body))).find((b) => b.action === "sign-up");
    expect(sent).toEqual({ token: "tokentokentokentokentoken", action: "sign-up", name: "Blair", commander: null, teamWith: null });
    expect(JSON.parse(window.localStorage.getItem("gg-tournament-me:tokentokentokent")!)).toEqual({
      entrantId: B,
      seat: 0,
      name: "Blair",
    });

    // Next visit: the tournament has started and Blair is now on Alex's team.
    unmount();
    view = teamed;
    render(<TournamentPage />);
    expect(await screen.findByText(/Playing as/)).toBeTruthy();
    expect(screen.getByText(/Playing as/).textContent).toContain("Blair");
  });
});
