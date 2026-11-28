import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { formatDuration } from "../../utils/tournament";

// The player's life counter on the player display (/tournament), shown while
// their game is being played. Taps change the number straight away; changes
// are sent in batches (a quick run of taps is one request) and added on the
// server, so teammates tapping at once both count. The TV picks them up on
// its next refresh (every 2.5s while games are live).
//
// When a tap takes their life to 0 or below, it asks "Did you lose?": yes
// records the loss (1v1 / Two-Headed Giant: the game goes to the other side
// and its clock stops; free-for-all: they're out and take the next finishing
// place). "I lost this game" does the same for losses that aren't about life
// (commander damage, poison, conceding).
//
// The same counter serves every format: the page passes this player's life,
// everyone else at the table, and what confirming a loss does.

/** Wait this long after the last tap before sending the batch. */
const SEND_AFTER_MS = 450;

/** Someone else at the table, as the counter lists them. */
export interface LifeOther {
  key: string;
  label: string;
  life: number;
  /** Free-for-all: where they finished once they're out ("8th"); null while still in. */
  out: string | null;
}

export function LifeCounter({
  life: saved,
  startingLife,
  title,
  elapsed,
  others,
  team,
  outcome,
  onChange,
  onLost,
}: {
  /** This player's (or team's) life as saved. */
  life: number;
  startingLife: number;
  /** "Table 3 · vs Blair". */
  title: string;
  /** How long the game has run (ms), or null. */
  elapsed: number | null;
  /** Everyone else at the table. */
  others: LifeOther[];
  /** Two-Headed Giant: the life is the team's. */
  team: boolean;
  /** What confirming a loss does, as the end of a sentence: "the game is recorded as a win for Blair and its clock stops". */
  outcome: string;
  /** Sends a change; resolves false if it didn't save (the page shows why). */
  onChange: (delta: number) => Promise<boolean>;
  /** Records the loss; resolves false if it didn't save. */
  onLost: () => Promise<boolean>;
}) {

  // Taps not sent yet, and the batch on its way.
  const queued = useRef(0);
  const sending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [queuedView, setQueuedView] = useState(0);
  const [inFlight, setInFlight] = useState(0);
  const [asking, setAsking] = useState<null | "zero" | "concede">(null);
  const life = saved + inFlight + queuedView;

  // The latest send, for the timer, the page-hide flush and follow-up batches.
  const sendRef = useRef<() => Promise<void>>(async () => undefined);
  const send = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (sending.current || queued.current === 0) return;
    const delta = queued.current;
    queued.current = 0;
    setQueuedView(0);
    sending.current = true;
    setInFlight(delta);
    await onChange(delta);
    sending.current = false;
    setInFlight(0);
    // Taps made while that batch was on its way go next.
    if (queued.current !== 0) void sendRef.current();
  }, [onChange]);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Don't lose taps when the phone locks or the page closes.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void sendRef.current();
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      if (timer.current) clearTimeout(timer.current);
      void sendRef.current();
    };
  }, []);

  function tap(delta: number) {
    const before = life;
    queued.current += delta;
    setQueuedView(queued.current);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void sendRef.current(), SEND_AFTER_MS);
    if ("vibrate" in navigator) navigator.vibrate?.(8);
    if (before > 0 && before + delta <= 0) setAsking("zero");
  }

  async function confirmLoss() {
    // Save the taps that got here first, then record the game.
    await send();
    const ok = await onLost();
    if (ok) setAsking(null);
  }

  const low = life <= Math.ceil(startingLife / 4);
  const who = team ? "Your team" : "You";

  return (
    <section className="gg-card gg-life" aria-labelledby="life-title">
      <div className="gg-life__top">
        <h2 id="life-title">{title}</h2>
        {elapsed != null && (
          <span className="gg-life__clock" aria-label={`Game time ${formatDuration(elapsed)}`}>
            <Icon name="clock" size={14} /> {formatDuration(elapsed)}
          </span>
        )}
      </div>

      <div className="gg-life__counter">
        <button type="button" className="gg-life__btn" aria-label="Lose 1 life" onClick={() => tap(-1)}>
          −
        </button>
        <div className={`gg-life__total ${low ? "is-low" : ""} ${life <= 0 ? "is-out" : ""}`}>
          <span className="gg-life__who">{who}</span>
          <output aria-live="polite" aria-label={`${who}: ${life} life`}>
            {life}
          </output>
        </div>
        <button type="button" className="gg-life__btn" aria-label="Gain 1 life" onClick={() => tap(1)}>
          +
        </button>
      </div>

      <div className="gg-life__steps" role="group" aria-label="Change life by more">
        {[-10, -5, 5, 10].map((d) => (
          <button key={d} type="button" onClick={() => tap(d)} aria-label={`${d > 0 ? "Gain" : "Lose"} ${Math.abs(d)} life`}>
            {d > 0 ? `+${d}` : `−${Math.abs(d)}`}
          </button>
        ))}
      </div>

      <ul className={`gg-life__others ${others.length > 3 ? "gg-life__others--many" : ""}`} aria-label="Everyone else at the table">
        {others.map((o) => (
          <li key={o.key} className={`gg-life__them ${o.out ? "is-gone" : ""}`}>
            <span>{o.label}</span>
            {o.out ? (
              <small className="gg-life__place">Out · {o.out}</small>
            ) : (
              <strong className={o.life <= 0 ? "is-out" : undefined}>{o.life}</strong>
            )}
          </li>
        ))}
      </ul>

      <button type="button" className="gg-link-btn gg-life__concede" onClick={() => setAsking("concede")}>
        {team ? "We lost this game" : "I lost this game"}
      </button>

      <ConfirmDialog
        open={asking != null}
        title={team ? "Did your team lose?" : "Did you lose?"}
        message={
          asking === "zero"
            ? `${team ? "Your team's" : "Your"} life is at ${life}. If you lost, ${outcome}.`
            : `Confirm and ${outcome}.`
        }
        confirmLabel={team ? "Yes, we lost" : "Yes, I lost"}
        cancelLabel="No, keep playing"
        tone="danger"
        onConfirm={confirmLoss}
        onCancel={() => setAsking(null)}
      />
    </section>
  );
}
