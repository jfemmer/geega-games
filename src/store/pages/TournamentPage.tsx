import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ToastProvider } from "../../admin/components/ui/ToastProvider";
import { useToast } from "../../admin/hooks/useToast";
import { Spinner } from "../../admin/components/ui/States";
import { BracketDisplay, type SignUpInput } from "../../admin/components/tournaments/BracketDisplay";
import type { CommanderOption } from "../../admin/components/tournaments/CommanderPicker";
import {
  hasLiveGames,
  isPlaying,
  ordinal,
  parseSeatKey,
  tournamentShareUrl,
  type PlayerSeat,
  type TournamentCommander,
  type TournamentDetail,
} from "../../admin/utils/tournament";
import { siteLogoSrc } from "../lib/siteLogo";
import "../../admin/admin.css";

// /tournament?t=<token> — the player display for a tournament run from
// admin → Tournaments. Staff put it on the store TV (&view=tv); players scan
// the QR code on it to follow along on their phones and add their commander.
// The token in the link is the only access (POST /api/tournament); staff can
// turn it off or replace it.
//
// Standalone like the kiosk and the cube checklist (App.tsx renders it
// without the storefront header, cart or account), in the admin design
// system scoped under .gg-admin.

const TV_REFRESH_MS = 10_000;
const PHONE_REFRESH_MS = 20_000;
/** While games are being played, so life totals on the TV keep up. */
const TV_LIVE_REFRESH_MS = 2_500;
/** A phone whose player is in a game (their opponent's life), or watching games. */
const PHONE_PLAYING_REFRESH_MS = 5_000;
const PHONE_WATCHING_REFRESH_MS = 10_000;
/** The smallest type the TV shrinks to so the whole bracket fits (px per rem). */
const MIN_TV_FONT_PX = 12;

type ApiError = Error & { status?: number };

async function post<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/tournament", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("You seem to be offline. Check your connection and try again.");
  }
  let json: { ok?: boolean; message?: string } & Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok || json.ok === false) {
    const err = new Error(json.message ?? `Request failed (${res.status}).`) as ApiError;
    err.status = res.status;
    throw err;
  }
  return json as T;
}

function meKey(token: string): string {
  return `gg-tournament-me:${token.slice(0, 16)}`;
}

/** Who this phone is: a seat, plus the name, so it can be found again if their team changes. */
interface SavedMe extends PlayerSeat {
  name: string | null;
}

function readMe(token: string): SavedMe | null {
  try {
    const raw = window.localStorage.getItem(meKey(token));
    if (!raw) return null;
    if (raw.startsWith("{")) {
      const v = JSON.parse(raw) as Partial<SavedMe>;
      const seat = parseSeatKey(`${v.entrantId}:${v.seat}`);
      return seat ? { ...seat, name: typeof v.name === "string" ? v.name : null } : null;
    }
    const seat = parseSeatKey(raw);
    return seat ? { ...seat, name: null } : null;
  } catch {
    return null;
  }
}

function writeMe(token: string, me: SavedMe | null): void {
  try {
    if (me) window.localStorage.setItem(meKey(token), JSON.stringify(me));
    else window.localStorage.removeItem(meKey(token));
  } catch {
    /* storage unavailable: "me" lasts for this visit only */
  }
}

/**
 * The saved player in this tournament: their seat if it still holds their
 * name, else wherever that name is now (a Two-Headed Giant player who got a
 * random teammate moves onto that team). Null if they've dropped or gone.
 */
function resolveMe(t: TournamentDetail, saved: SavedMe | null): SavedMe | null {
  if (!saved) return null;
  const sameName = (a: string | undefined) => saved.name == null || a?.toLowerCase() === saved.name.toLowerCase();
  const at = t.entrants.find((e) => e.id === saved.entrantId);
  if (at && !at.droppedAt && saved.seat < at.players.length && sameName(at.players[saved.seat])) {
    return { ...saved, name: at.players[saved.seat] };
  }
  if (!saved.name) return null;
  for (const e of t.entrants) {
    const seat = e.players.findIndex((p) => p.toLowerCase() === saved.name!.toLowerCase());
    if (seat >= 0 && !e.droppedAt) return { entrantId: e.id, seat, name: e.players[seat] };
  }
  return null;
}

export default function TournamentPage() {
  const tv = useMemo(() => new URLSearchParams(window.location.search).get("view") === "tv", []);
  // On a TV every rem gets bigger (html.gg-tv in admin.css), so it reads from across the room.
  useEffect(() => {
    if (!tv) return;
    document.documentElement.classList.add("gg-tv");
    return () => document.documentElement.classList.remove("gg-tv");
  }, [tv]);
  return (
    <div className={`gg-admin gg-bracketpage ${tv ? "gg-bracketpage--tv" : ""}`}>
      <ToastProvider>
        <TournamentScreen />
      </ToastProvider>
    </div>
  );
}

function TournamentScreen() {
  const toast = useToast();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const token = params.get("t") ?? "";
  const tv = params.get("view") === "tv";
  const [tournament, setTournament] = useState<TournamentDetail | null>(null);
  const [error, setError] = useState<{ message: string; gone: boolean } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [me, setMe] = useState<SavedMe | null>(() => (token ? readMe(token) : null));
  const [clockOffset, setClockOffset] = useState(0);
  const busy = useRef(false);
  // Life totals this phone saved, by game, with the server time they were
  // saved: a refresh that left the server before them doesn't undo them.
  const savedLife = useRef(new Map<string, { lifeA: number; lifeB: number; at: number }>());
  // The same for free-for-all, by seat.
  const savedPodLife = useRef(new Map<string, { life: number; at: number }>());

  /** Takes a tournament from the server: keeps newer life totals saved here, and the server's clock. */
  const receive = useCallback((next: TournamentDetail) => {
    const at = next.serverTime ? Date.parse(next.serverTime) : NaN;
    if (Number.isFinite(at)) setClockOffset(at - Date.now());
    const mine = savedLife.current;
    const minePods = savedPodLife.current;
    if (minePods.size > 0) {
      next = {
        ...next,
        pods: next.pods.map((pod) =>
          pod.endedAt
            ? pod
            : {
                ...pod,
                players: pod.players.map((p) => {
                  const saved = minePods.get(p.id);
                  if (!saved || p.outAt) return p;
                  if (Number.isFinite(at) && saved.at <= at) {
                    minePods.delete(p.id);
                    return p;
                  }
                  return { ...p, life: saved.life };
                }),
              },
        ),
      };
    }
    if (mine.size > 0) {
      next = {
        ...next,
        matches: next.matches.map((m) => {
          const saved = mine.get(m.id);
          if (!saved || m.result !== "pending") return m;
          if (Number.isFinite(at) && saved.at <= at) {
            mine.delete(m.id);
            return m;
          }
          return { ...m, lifeA: saved.lifeA, lifeB: saved.lifeB };
        }),
      };
    }
    setTournament(next);
    setUpdatedAt(new Date());
  }, []);

  const load = useCallback(async () => {
    if (!token || busy.current) return;
    busy.current = true;
    try {
      const res = await post<{ tournament: TournamentDetail }>({ token, action: "get" });
      receive(res.tournament);
      setError(null);
    } catch (err) {
      const e = err as ApiError;
      setError({ message: e.message, gone: e.status === 404 });
    } finally {
      busy.current = false;
    }
  }, [token, receive]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep up with the room: refresh while the screen is showing (faster while
  // games are being played), right away when it comes back. A link that's
  // been turned off stops refreshing.
  const gone = error?.gone ?? false;
  const resolvedMe = tournament ? resolveMe(tournament, me) : null;
  const live = tournament != null && hasLiveGames(tournament);
  const playing = live && resolvedMe != null && isPlaying(tournament!, resolvedMe.entrantId);
  useEffect(() => {
    if (!token || gone) return;
    const every = tv
      ? live
        ? TV_LIVE_REFRESH_MS
        : TV_REFRESH_MS
      : playing
        ? PHONE_PLAYING_REFRESH_MS
        : live
          ? PHONE_WATCHING_REFRESH_MS
          : PHONE_REFRESH_MS;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, every);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, tv, gone, load, live, playing]);

  // A TV showing the bracket, or a phone tracking life on the table, shouldn't go to sleep.
  const keepAwake = tv || playing;
  useEffect(() => {
    if (!keepAwake || !("wakeLock" in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    const request = () => {
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          lock = l;
        })
        .catch(() => undefined);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") request();
    };
    request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [keepAwake]);

  // A TV can't scroll: shrink the type (every size is in rem) until the whole
  // bracket fits the screen, down to a readable minimum. Runs before paint.
  useLayoutEffect(() => {
    if (!tv || !tournament) return;
    const html = document.documentElement;
    const fit = () => {
      html.style.fontSize = "";
      const el = document.querySelector<HTMLElement>(".gg-bracket");
      if (!el) return;
      const room = window.innerHeight - 4;
      let size = parseFloat(getComputedStyle(html).fontSize);
      // Borders and a few sizes are in px, so another pass or two closes the gap.
      for (let pass = 0; pass < 3; pass += 1) {
        const height = el.getBoundingClientRect().height;
        if (height <= room || size <= MIN_TV_FONT_PX) break;
        size = Math.max(MIN_TV_FONT_PX, (size * room) / height);
        html.style.fontSize = `${size}px`;
      }
    };
    fit();
    window.addEventListener("resize", fit);
    // Again whenever the bracket changes size (the web font arriving, a name
    // wrapping). Each fit lands on the same size, so this doesn't loop.
    const el = document.querySelector(".gg-bracket");
    const observer = typeof ResizeObserver === "undefined" || !el ? null : new ResizeObserver(() => fit());
    if (observer && el) observer.observe(el);
    void document.fonts?.ready.then(fit).catch(() => undefined);
    return () => {
      window.removeEventListener("resize", fit);
      observer?.disconnect();
      html.style.fontSize = "";
    };
  }, [tv, tournament]);


  const pickMe = useCallback(
    (seat: PlayerSeat | null) => {
      const entrant = seat ? tournament?.entrants.find((e) => e.id === seat.entrantId) : undefined;
      const next = seat ? { ...seat, name: entrant?.players[seat.seat] ?? null } : null;
      setMe(next);
      writeMe(token, next);
    },
    [token, tournament],
  );

  const signUp = useCallback(
    async (input: SignUpInput): Promise<boolean> => {
      try {
        const res = await post<{ tournament: TournamentDetail; seat: PlayerSeat; started: boolean }>({
          token,
          action: "sign-up",
          name: input.name,
          commander: input.commander,
          teamWith: input.teamWith,
        });
        const next = { ...res.seat, name: input.name };
        setMe(next);
        writeMe(token, next);
        receive(res.tournament);
        toast.success(res.started ? "You're in, and round 1 has started. Find your table below." : `You're in, ${input.name}!`);
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't sign you up. Please try again.");
        void load();
        return false;
      }
    },
    [token, toast, load, receive],
  );

  const saveCommander = useCallback(
    async (seat: PlayerSeat, commander: TournamentCommander | null): Promise<boolean> => {
      try {
        const res = await post<{ tournament: TournamentDetail }>({
          token,
          action: "commander",
          entrantId: seat.entrantId,
          seat: seat.seat,
          commander,
        });
        receive(res.tournament);
        toast.success(commander ? `Saved: ${commander.name}. Good luck!` : "Commander removed.");
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't save that. Please try again.");
        return false;
      }
    },
    [token, toast, receive],
  );

  const changeLife = useCallback(
    async (matchId: string, side: "a" | "b", delta: number): Promise<boolean> => {
      try {
        const res = await post<{ life: { a: number; b: number }; serverTime: string }>({
          token,
          action: "life",
          matchId,
          side,
          delta,
        });
        const at = Date.parse(res.serverTime);
        savedLife.current.set(matchId, { lifeA: res.life.a, lifeB: res.life.b, at: Number.isFinite(at) ? at : Date.now() });
        setTournament((t) =>
          t
            ? { ...t, matches: t.matches.map((m) => (m.id === matchId ? { ...m, lifeA: res.life.a, lifeB: res.life.b } : m)) }
            : t,
        );
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't update your life total.");
        void load();
        return false;
      }
    },
    [token, toast, load],
  );

  const reportLost = useCallback(
    async (matchId: string, side: "a" | "b"): Promise<boolean> => {
      try {
        const res = await post<{ tournament: TournamentDetail }>({ token, action: "lost", matchId, side });
        savedLife.current.delete(matchId);
        receive(res.tournament);
        toast.success("Game recorded. Good game!");
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't record the game. Please try again.");
        void load();
        return false;
      }
    },
    [token, toast, load, receive],
  );

  const changePodLife = useCallback(
    async (podPlayerId: string, delta: number): Promise<boolean> => {
      try {
        const res = await post<{ life: number; serverTime: string }>({ token, action: "pod-life", podPlayerId, delta });
        const at = Date.parse(res.serverTime);
        savedPodLife.current.set(podPlayerId, { life: res.life, at: Number.isFinite(at) ? at : Date.now() });
        setTournament((t) =>
          t
            ? {
                ...t,
                pods: t.pods.map((pod) => ({
                  ...pod,
                  players: pod.players.map((p) => (p.id === podPlayerId ? { ...p, life: res.life } : p)),
                })),
              }
            : t,
        );
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't update your life total.");
        void load();
        return false;
      }
    },
    [token, toast, load],
  );

  const podOut = useCallback(
    async (podPlayerId: string): Promise<boolean> => {
      try {
        const res = await post<{ tournament: TournamentDetail; place: number }>({ token, action: "pod-out", podPlayerId });
        savedPodLife.current.delete(podPlayerId);
        receive(res.tournament);
        toast.success(res.place ? `You finished ${ordinal(res.place)}. Good game!` : "Recorded. Good game!");
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't record that. Please try again.");
        void load();
        return false;
      }
    },
    [token, toast, load, receive],
  );

  const searchCommanders = useCallback(
    async (query: string): Promise<CommanderOption[]> => {
      const res = await post<{ options: CommanderOption[] }>({ token, action: "commander-search", query });
      return res.options;
    },
    [token],
  );

  // A player who got a random teammate moved seats: remember the new one.
  const resolved = tournament ? resolveMe(tournament, me) : null;
  const resolvedKey = resolved ? `${resolved.entrantId}:${resolved.seat}` : "";
  useEffect(() => {
    if (resolved && me && (resolved.entrantId !== me.entrantId || resolved.seat !== me.seat)) writeMe(token, resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedKey, token]);

  const fullscreen = useMemo(() => {
    if (typeof document === "undefined" || !document.fullscreenEnabled) return undefined;
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      else void document.documentElement.requestFullscreen().catch(() => undefined);
    };
  }, []);

  if (!token) {
    return <Notice title="This link is missing its code" message="Ask the store for the full tournament link or scan the QR code again." />;
  }
  if (!tournament) {
    return error ? (
      <Notice
        title={error.gone ? "This tournament link isn't available" : "Couldn't load the tournament"}
        message={error.gone ? "It may have been turned off or replaced. Scan the QR code at the store again." : error.message}
        retry={error.gone ? undefined : () => void load()}
      />
    ) : (
      <div className="gg-bracketpage__loading">
        <Spinner label="Loading the bracket" />
      </div>
    );
  }

  const currentMe = resolvedMe;
  const origin = window.location.origin;
  return (
    <>
      {error && !error.gone && (
        <div className="gg-bracketpage__offline" role="status">
          Can't reach the store right now — showing the last update.
        </div>
      )}
      {error?.gone && (
        <div className="gg-bracketpage__offline" role="status">
          This link was turned off. Scan the QR code at the store again for the latest.
        </div>
      )}
      <BracketDisplay
        tournament={tournament}
        tv={tv}
        shareUrl={tournamentShareUrl(origin, token)}
        tvUrl={tournamentShareUrl(origin, token, true)}
        logoSrc={siteLogoSrc()}
        me={currentMe}
        onPickMe={pickMe}
        onSaveCommander={saveCommander}
        onSignUp={signUp}
        onChangeLife={changeLife}
        onLost={reportLost}
        onChangePodLife={changePodLife}
        onPodOut={podOut}
        clockOffset={clockOffset}
        searchCommanders={searchCommanders}
        updatedAt={updatedAt}
        onFullscreen={fullscreen}
      />
    </>
  );
}

function Notice({ title, message, retry }: { title: string; message: string; retry?: () => void }) {
  return (
    <main className="gg-bracketpage__notice">
      <img src={siteLogoSrc()} alt="Geega Games" />
      <h1>{title}</h1>
      <p>{message}</p>
      {retry && (
        <button type="button" className="gg-btn gg-btn--primary gg-btn--md" onClick={retry}>
          <span>Try again</span>
        </button>
      )}
    </main>
  );
}
