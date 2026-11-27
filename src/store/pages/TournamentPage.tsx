import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ToastProvider } from "../../admin/components/ui/ToastProvider";
import { useToast } from "../../admin/hooks/useToast";
import { Spinner } from "../../admin/components/ui/States";
import { BracketDisplay } from "../../admin/components/tournaments/BracketDisplay";
import type { CommanderOption } from "../../admin/components/tournaments/CommanderPicker";
import {
  parseSeatKey,
  seatKey,
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

function readMe(token: string): PlayerSeat | null {
  try {
    return parseSeatKey(window.localStorage.getItem(meKey(token)));
  } catch {
    return null;
  }
}

function writeMe(token: string, seat: PlayerSeat | null): void {
  try {
    if (seat) window.localStorage.setItem(meKey(token), seatKey(seat));
    else window.localStorage.removeItem(meKey(token));
  } catch {
    /* storage unavailable: "me" lasts for this visit only */
  }
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
  const [me, setMe] = useState<PlayerSeat | null>(() => (token ? readMe(token) : null));
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (!token || busy.current) return;
    busy.current = true;
    try {
      const res = await post<{ tournament: TournamentDetail }>({ token, action: "get" });
      setTournament(res.tournament);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      const e = err as ApiError;
      setError({ message: e.message, gone: e.status === 404 });
    } finally {
      busy.current = false;
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep up with the room: refresh while the screen is showing, right away
  // when it comes back. A link that's been turned off stops refreshing.
  const gone = error?.gone ?? false;
  useEffect(() => {
    if (!token || gone) return;
    const every = tv ? TV_REFRESH_MS : PHONE_REFRESH_MS;
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
  }, [token, tv, gone, load]);

  // A TV or tablet showing the bracket shouldn't go to sleep.
  useEffect(() => {
    if (!tv || !("wakeLock" in navigator)) return;
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
  }, [tv]);

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
      setMe(seat);
      writeMe(token, seat);
    },
    [token],
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
        setTournament(res.tournament);
        setUpdatedAt(new Date());
        toast.success(commander ? `Saved: ${commander.name}. Good luck!` : "Commander removed.");
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't save that. Please try again.");
        return false;
      }
    },
    [token, toast],
  );

  const searchCommanders = useCallback(
    async (query: string): Promise<CommanderOption[]> => {
      const res = await post<{ options: CommanderOption[] }>({ token, action: "commander-search", query });
      return res.options;
    },
    [token],
  );

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

  // A remembered "me" who has dropped or been removed is nobody.
  const meEntrant = me ? tournament.entrants.find((e) => e.id === me.entrantId) : undefined;
  const currentMe = me && meEntrant && !meEntrant.droppedAt && me.seat < meEntrant.players.length ? me : null;
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
