import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { formatDuration, gameDuration, lifeOf, type TournamentMatch } from "../../utils/tournament";

// The player's life counter on the player display (/tournament), shown while
// their game is being played. Taps change the number straight away; changes
// are sent in batches (a quick run of taps is one request) and added on the
// server, so teammates tapping at once both count. The TV picks them up on
// its next refresh (every 2.5s while games are live).
//
// When a tap takes their life to 0 or below, it asks "Did you lose?": yes
// records the game for the other side and stops its clock. "I lost this
// game" does the same for losses that aren't about life (commander damage,
// poison, conceding).

/** Wait this long after the last tap before sending the batch. */
const SEND_AFTER_MS = 450;

export function LifeCounter({
  match,
  side,
  startingLife,
  table,
  opponentLabel,
  team,
  now,
  onChange,
  onLost,
}: {
  match: TournamentMatch;
  side: "a" | "b";
  startingLife: number;
  table: number;
  opponentLabel: string;
  /** Two-Headed Giant: the life is the team's. */
  team: boolean;
  /** Server-adjusted clock, for the game timer. */
  now: number;
  /** Sends a change; resolves false if it didn't save (the page shows why). */
  onChange: (delta: number) => Promise<boolean>;
  /** Records the loss; resolves false if it didn't save. */
  onLost: () => Promise<boolean>;
}) {
  const other = side === "a" ? "b" : "a";
  const saved = lifeOf(match, side, startingLife);
  const theirs = lifeOf(match, other, startingLife);

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

  const elapsed = gameDuration(match, now);
  const low = life <= Math.ceil(startingLife / 4);
  const who = team ? "Your team" : "You";

  return (
    <section className="gg-card gg-life" aria-labelledby="life-title">
      <div className="gg-life__top">
        <h2 id="life-title">
          Table {table} · vs {opponentLabel}
        </h2>
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

      <div className="gg-life__them">
        <span>{opponentLabel}</span>
        <strong className={theirs <= 0 ? "is-out" : undefined}>{theirs}</strong>
      </div>

      <button type="button" className="gg-link-btn gg-life__concede" onClick={() => setAsking("concede")}>
        {team ? "We lost this game" : "I lost this game"}
      </button>

      <ConfirmDialog
        open={asking != null}
        title={team ? "Did your team lose?" : "Did you lose?"}
        message={
          asking === "zero"
            ? `${team ? "Your team's" : "Your"} life is at ${life}. If you lost, the game is recorded as a win for ${opponentLabel} and its clock stops.`
            : `This records the game as a win for ${opponentLabel} and stops its clock.`
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
