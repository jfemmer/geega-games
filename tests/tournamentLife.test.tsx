// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import { LifeCounter } from "../src/admin/components/tournaments/LifeCounter";
import { BracketDisplay } from "../src/admin/components/tournaments/BracketDisplay";
import type { TournamentDetail, TournamentMatch } from "../src/admin/utils/tournament";

// Life tracking on the player display: the phone counter (quick taps go as
// one change, "Did you lose?" at 0, "I lost this game"), life and game clocks
// on the TV, and the page not letting an older refresh undo a change.

const START = "2026-11-27T20:00:00.000Z";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

function game(extra: Partial<TournamentMatch> = {}): TournamentMatch {
  return {
    id: "m1",
    round: 1,
    table: 3,
    a: A,
    b: B,
    result: "pending",
    reportedAt: null,
    lifeA: null,
    lifeB: null,
    startedAt: START,
    endedAt: null,
    ...extra,
  };
}

function counter(props: Partial<Parameters<typeof LifeCounter>[0]> = {}) {
  const onChange = vi.fn(async () => true);
  const onLost = vi.fn(async () => true);
  const utils = render(
    <LifeCounter
      life={40}
      startingLife={40}
      title="Table 3 · vs Blair"
      elapsed={754_000}
      others={[{ key: B, label: "Blair", life: 40, out: null }]}
      team={false}
      outcome="the game is recorded as a win for Blair and its clock stops"
      onChange={onChange}
      onLost={onLost}
      {...props}
    />,
  );
  return { ...utils, onChange, onLost };
}

afterEach(() => cleanup());

describe("life counter", () => {
  it("shows the table, opponent, game clock and both life totals", () => {
    counter({ others: [{ key: B, label: "Blair", life: 33, out: null }] });
    expect(screen.getByRole("heading", { name: "Table 3 · vs Blair" })).toBeTruthy();
    expect(screen.getByLabelText("Game time 12:34")).toBeTruthy();
    expect(screen.getByLabelText("You: 40 life")).toBeTruthy();
    expect(screen.getByText("33")).toBeTruthy();
  });

  it("changes right away and sends a quick run of taps as one change", async () => {
    const user = userEvent.setup();
    const { onChange } = counter();
    await user.click(screen.getByRole("button", { name: "Lose 1 life" }));
    await user.click(screen.getByRole("button", { name: "Lose 1 life" }));
    await user.click(screen.getByRole("button", { name: "Lose 5 life" }));
    await user.click(screen.getByRole("button", { name: "Gain 1 life" }));
    expect(screen.getByLabelText("You: 34 life")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(onChange).toHaveBeenCalledWith(-6);
  });

  it("asks 'Did you lose?' when life reaches 0, and records the loss after saving the taps", async () => {
    const user = userEvent.setup();
    const { onChange, onLost } = counter({ life: 6 });
    await user.click(screen.getByRole("button", { name: "Lose 5 life" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Lose 1 life" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Did you lose?" })).toBeTruthy();
    expect(within(dialog).getByText("Your life is at 0. If you lost, the game is recorded as a win for Blair and its clock stops.")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Yes, I lost" }));
    await waitFor(() => expect(onLost).toHaveBeenCalledWith({ reason: "life", winnerId: null }));
    // The taps were sent first.
    expect(onChange).toHaveBeenCalledWith(-6);
    expect(onChange.mock.invocationCallOrder[0]).toBeLessThan(onLost.mock.invocationCallOrder[0]);
  });

  it("lets a player say no and keep playing", async () => {
    const user = userEvent.setup();
    const { onLost } = counter({ life: 1 });
    await user.click(screen.getByRole("button", { name: "Lose 1 life" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "No, keep playing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onLost).not.toHaveBeenCalled();
    expect(screen.getByLabelText("You: 0 life")).toBeTruthy();
  });

  it("records a loss that isn't about life, and speaks for the team in Two-Headed Giant", async () => {
    const user = userEvent.setup();
    const { onLost } = counter({ team: true });
    expect(screen.getByLabelText("Your team: 40 life")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "We lost this game" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Did your team lose?" })).toBeTruthy();
    // How they lost comes first.
    const confirm = within(dialog).getByRole("button", { name: "Yes, we lost" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.click(within(dialog).getByRole("radio", { name: "Alt win con" }));
    await user.click(confirm);
    await waitFor(() => expect(onLost).toHaveBeenCalledWith({ reason: "alt_win", winnerId: null }));
  });
});

function tournament(matches: TournamentMatch[], extra: Partial<TournamentDetail> = {}): TournamentDetail {
  return {
    id: "t1",
    name: "Friday",
    format: "1v1",
    status: "active",
    currentRound: 1,
    createdAt: START,
    finishedAt: null,
    entrants: [
      { id: A, players: ["Alex"], commanders: [null], droppedAt: null, createdAt: START },
      { id: B, players: ["Blair"], commanders: [null], droppedAt: null, createdAt: START },
    ],
    matches,
    spots: null,
    startingLife: 40,
    tableSize: null,
    pods: [],
    serverTime: START,
    ...extra,
  };
}

describe("on the TV and phones", () => {
  const base = {
    tv: true,
    shareUrl: "https://geega-games.com/tournament?t=tok",
    logoSrc: "/logo.png",
    me: null,
    onPickMe: () => undefined,
    onSaveCommander: async () => true,
    searchCommanders: async () => [],
    updatedAt: null,
  };

  it("shows each side's life and the game clock, then 'Game over' with its run time", () => {
    const { rerender } = render(<BracketDisplay {...base} tournament={tournament([game({ lifeA: 31, lifeB: 8 })])} />);
    expect(screen.getByLabelText("31 life")).toBeTruthy();
    expect(screen.getByLabelText("8 life").className).toContain("is-low");
    rerender(
      <BracketDisplay
        {...base}
        tournament={tournament([game({ lifeA: 0, lifeB: 17, result: "b", reportedAt: START, endedAt: "2026-11-27T20:41:23.000Z" })])}
      />,
    );
    expect(screen.getByText("Game over · 41:23")).toBeTruthy();
    expect(screen.getByLabelText("0 life").className).toContain("is-out");
  });

  it("puts the life counter first on the phone of a player in a game", () => {
    render(
      <ToastProvider>
        <BracketDisplay
          {...base}
          tv={false}
          tournament={tournament([game()])}
          me={{ entrantId: B, seat: 0 }}
          onChangeLife={async () => true}
          onLost={async () => true}
        />
      </ToastProvider>,
    );
    expect(screen.getByRole("heading", { name: "Table 3 · vs Alex" })).toBeTruthy();
    expect(screen.getByLabelText("You: 40 life")).toBeTruthy();
    // The commander form waits until the game is over.
    expect(screen.queryByRole("heading", { name: "Your commander" })).toBeNull();
  });
});

describe("player display page: life", () => {
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

  it("sends life changes, and a refresh that left before the change doesn't undo it", async () => {
    const user = userEvent.setup();
    const lifeSavedAt = "2026-11-27T20:10:00.000Z";
    let view = tournament([game()], { serverTime: "2026-11-27T20:09:59.000Z" });
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.action === "life") {
        return new Response(JSON.stringify({ ok: true, life: { a: 40, b: 37 }, serverTime: lifeSavedAt }));
      }
      return new Response(JSON.stringify({ ok: true, tournament: view }));
    });
    window.localStorage.setItem("gg-tournament-me:tokentokentokent", JSON.stringify({ entrantId: B, seat: 0, name: "Blair" }));
    window.history.replaceState(null, "", "/tournament?t=tokentokentokentokentoken");
    const { default: TournamentPage } = await import("../src/store/pages/TournamentPage");
    render(<TournamentPage />);

    for (let i = 0; i < 3; i += 1) await user.click(await screen.findByRole("button", { name: "Lose 1 life" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body))).find((b) => b.action === "life")).toEqual({
        token: "tokentokentokentokentoken",
        action: "life",
        matchId: "m1",
        side: "b",
        delta: -3,
      }),
      { timeout: 2000 },
    );
    expect(screen.getByLabelText("You: 37 life")).toBeTruthy();

    // A refresh read before the change landed (older server time) still says 40.
    view = tournament([game()], { serverTime: "2026-11-27T20:09:59.500Z" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => JSON.parse(String(init.body)).action === "get").length).toBeGreaterThan(1));
    expect(screen.getByLabelText("You: 37 life")).toBeTruthy();

    // A newer refresh is the truth (a teammate or staff may have changed it since).
    view = tournament([game({ lifeB: 35 })], { serverTime: "2026-11-27T20:10:05.000Z" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(screen.getByLabelText("You: 35 life")).toBeTruthy());
  });
});
