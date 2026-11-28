import { useCallback, useRef, useState, useEffect } from "react";
import { Button } from "../ui/Button";
import { SelectField } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { useBatchedTaps } from "../../hooks/useBatchedTaps";
import { COMMANDER_DAMAGE_TO_LOSE, LOSS_REASONS, formatDuration, type LossReason } from "../../utils/tournament";

// The player's counter on the player display (/tournament), shown while
// their game is being played: life, poison, and commander damage from each
// commander across the table. Taps change the numbers straight away and are
// sent in batches (useBatchedTaps), added on the server so teammates tapping
// at once both count. The TV picks them up on its next refresh.
//
// Any way of losing asks "Did you lose?": life at 0, poison at 10 (15 for a
// Two-Headed Giant team), or 21 damage from one commander; "I lost this
// game" covers the rest (an opponent's alternate win, decking, a card that
// says you lose, conceding). Confirming records how, and the page says what
// happens (1v1 / Two-Headed Giant: the game goes to the other side;
// free-for-all: you're out in the next place, or an alternate win ends the
// game for everyone).
//
// The same counter serves every format: the page passes this player's
// numbers, everyone else at the table, and what confirming a loss does.

/** A commander across the table and the damage it has dealt this player. */
export interface LifeSource {
  key: string;
  label: string;
  value: number;
}

/** Someone else at the table, as the counter lists them. */
export interface LifeOther {
  key: string;
  label: string;
  life: number;
  /** Free-for-all: where they finished once they're out ("8th"); null while still in. */
  out: string | null;
  /** Their commanders (commander damage dealt to this player), while they're still in. */
  sources?: LifeSource[];
}

/** How the player says they lost. */
export interface LossPick {
  reason: LossReason;
  /** Free-for-all alternate win: who won (an entrant id). */
  winnerId: string | null;
}

type Asking =
  | { trigger: "life" }
  | { trigger: "poison"; count: number }
  | { trigger: "commander"; count: number; from: string }
  | { trigger: "manual" };

export function LifeCounter({
  life: saved,
  startingLife,
  title,
  elapsed,
  others,
  team,
  poison = 0,
  poisonLimit = 10,
  altWinners,
  outcome,
  onChange,
  onCounter,
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
  /** Two-Headed Giant: the numbers are the team's. */
  team: boolean;
  /** Poison counters as saved. */
  poison?: number;
  /** Poison that loses the game (10; 15 for a Two-Headed Giant team). */
  poisonLimit?: number;
  /** Free-for-all: who could have won with an alternate win (asked when there's more than one). */
  altWinners?: { id: string; label: string }[];
  /** What confirming a loss does, as the end of a sentence: "the game is recorded as a win for Blair and its clock stops". */
  outcome: string | ((pick: LossPick) => string);
  /** Sends a life change; resolves false if it didn't save (the page shows why). */
  onChange: (delta: number) => Promise<boolean>;
  /** Sends a poison or commander damage change (source: the commander's key). */
  onCounter?: (kind: "poison" | "commander", source: string, delta: number) => Promise<boolean>;
  /** Records the loss and how; resolves false if it didn't save. */
  onLost: (pick: LossPick) => Promise<boolean>;
}) {
  const lifeTaps = useBatchedTaps(onChange);
  const life = saved + lifeTaps.pending;
  const [asking, setAsking] = useState<Asking | null>(null);

  // Every counter's flush, so confirming a loss saves all the taps first.
  const flushers = useRef(new Set<() => Promise<void>>());
  const register = useCallback((flush: () => Promise<void>) => {
    flushers.current.add(flush);
    return () => {
      flushers.current.delete(flush);
    };
  }, []);

  function tapLife(delta: number) {
    const before = life;
    lifeTaps.tap(delta);
    if ("vibrate" in navigator) navigator.vibrate?.(8);
    if (before > 0 && before + delta <= 0) setAsking({ trigger: "life" });
  }

  async function confirmLoss(pick: LossPick) {
    await Promise.all([lifeTaps.flush(), ...[...flushers.current].map((f) => f())]);
    const ok = await onLost(pick);
    if (ok) setAsking(null);
    return ok;
  }

  const low = life <= Math.ceil(startingLife / 4);
  const who = team ? "Your team" : "You";
  const live = others.filter((o) => !o.out);

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
        <button type="button" className="gg-life__btn" aria-label="Lose 1 life" onClick={() => tapLife(-1)}>
          −
        </button>
        <div className={`gg-life__total ${low ? "is-low" : ""} ${life <= 0 ? "is-out" : ""}`}>
          <span className="gg-life__who">{who}</span>
          <output aria-live="polite" aria-label={`${who}: ${life} life`}>
            {life}
          </output>
        </div>
        <button type="button" className="gg-life__btn" aria-label="Gain 1 life" onClick={() => tapLife(1)}>
          +
        </button>
      </div>

      <div className="gg-life__steps" role="group" aria-label="Change life by more">
        {[-10, -5, 5, 10].map((d) => (
          <button key={d} type="button" onClick={() => tapLife(d)} aria-label={`${d > 0 ? "Gain" : "Lose"} ${Math.abs(d)} life`}>
            {d > 0 ? `+${d}` : `−${Math.abs(d)}`}
          </button>
        ))}
      </div>

      {onCounter && (
        <CounterRow
          className="gg-life__poison"
          label="Poison"
          name="poison counter"
          icon="☠"
          saved={poison}
          limit={poisonLimit}
          send={(delta) => onCounter("poison", "", delta)}
          onReach={(count) => setAsking({ trigger: "poison", count })}
          register={register}
        />
      )}

      <ul className="gg-life__others" aria-label="Everyone else at the table">
        {others.map((o) => (
          <li key={o.key} className={`gg-life__them ${o.out ? "is-gone" : ""}`}>
            <div className="gg-life__themhead">
              <span>{o.label}</span>
              {o.out ? (
                <small className="gg-life__place">Out · {o.out}</small>
              ) : (
                <strong className={o.life <= 0 ? "is-out" : undefined}>{o.life}</strong>
              )}
            </div>
            {!o.out && onCounter && o.sources && o.sources.length > 0 && (
              <div className="gg-life__cmd">
                {o.sources.map((src) => (
                  <CounterRow
                    key={src.key}
                    label={src.label}
                    name={`commander damage from ${src.label}`}
                    icon="⚔"
                    saved={src.value}
                    limit={COMMANDER_DAMAGE_TO_LOSE}
                    send={(delta) => onCounter("commander", src.key, delta)}
                    onReach={(count) => setAsking({ trigger: "commander", count, from: src.label })}
                    register={register}
                  />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      <button type="button" className="gg-link-btn gg-life__concede" onClick={() => setAsking({ trigger: "manual" })}>
        {team ? "We lost this game" : "I lost this game"}
      </button>

      {asking && (
        <LossDialog
          asking={asking}
          life={life}
          team={team}
          altWinners={live.length > 1 ? altWinners : undefined}
          outcome={outcome}
          onConfirm={confirmLoss}
          onCancel={() => setAsking(null)}
        />
      )}
    </section>
  );
}

/** Poison, or commander damage from one commander: − value / limit +. */
function CounterRow({
  label,
  name,
  icon,
  saved,
  limit,
  send,
  onReach,
  register,
  className = "",
}: {
  label: string;
  /** For the buttons: "poison counter", "commander damage from Atraxa". */
  name: string;
  icon: string;
  saved: number;
  limit: number;
  send: (delta: number) => Promise<boolean>;
  /** The count reached the limit with this tap. */
  onReach: (count: number) => void;
  register: (flush: () => Promise<void>) => () => void;
  className?: string;
}) {
  const { pending, tap, flush } = useBatchedTaps(send);
  useEffect(() => register(flush), [register, flush]);
  const value = Math.max(0, saved + pending);
  const near = value >= Math.ceil(limit * 0.7);

  function change(delta: number) {
    if (value + delta < 0) return;
    tap(delta);
    if ("vibrate" in navigator) navigator.vibrate?.(8);
    if (value < limit && value + delta >= limit) onReach(value + delta);
  }

  const add = name.startsWith("poison") ? "Add a poison counter" : `Add 1 ${name}`;
  const remove = name.startsWith("poison") ? "Remove a poison counter" : `Remove 1 ${name}`;
  return (
    <div className={`gg-life__counterrow ${className} ${near ? "is-near" : ""} ${value >= limit ? "is-max" : ""}`}>
      <span className="gg-life__counterlabel">
        <span aria-hidden="true">{icon}</span> {label}
      </span>
      <button type="button" aria-label={remove} disabled={value <= 0} onClick={() => change(-1)}>
        −
      </button>
      <output aria-label={`${label}: ${value} of ${limit}`}>
        {value}
        <small>/{limit}</small>
      </output>
      <button type="button" aria-label={add} onClick={() => change(1)}>
        +
      </button>
    </div>
  );
}

/** "Did you lose?": how (preset from what was tapped), and for an alternate win in free-for-all, who won. */
function LossDialog({
  asking,
  life,
  team,
  altWinners,
  outcome,
  onConfirm,
  onCancel,
}: {
  asking: Asking;
  life: number;
  team: boolean;
  altWinners: { id: string; label: string }[] | undefined;
  outcome: string | ((pick: LossPick) => string);
  onConfirm: (pick: LossPick) => Promise<boolean>;
  onCancel: () => void;
}) {
  const preset: LossReason | null =
    asking.trigger === "life" ? "life" : asking.trigger === "poison" ? "poison" : asking.trigger === "commander" ? "commander" : null;
  const [reason, setReason] = useState<LossReason | null>(preset);
  const [winnerId, setWinnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const needsWinner = reason === "alt_win" && altWinners != null && altWinners.length > 1;
  const ready = reason != null && (!needsWinner || winnerId !== "");
  const pick: LossPick = { reason: reason ?? "concede", winnerId: needsWinner ? winnerId || null : null };
  const then = typeof outcome === "string" ? outcome : outcome(pick);
  const your = team ? "Your team's" : "Your";
  const youHave = team ? "Your team has" : "You have";

  const message =
    asking.trigger === "life"
      ? `${your} life is at ${life}. If you lost, ${then}.`
      : asking.trigger === "poison"
        ? `${youHave} ${asking.count} poison counters. If you lost, ${then}.`
        : asking.trigger === "commander"
          ? `${asking.from} has dealt ${team ? "your team" : "you"} ${asking.count} commander damage. If you lost, ${then}.`
          : `Pick how, then confirm and ${then}.`;

  return (
    <Modal
      open
      onClose={onCancel}
      title={team ? "Did your team lose?" : "Did you lose?"}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            No, keep playing
          </Button>
          <Button
            variant="danger"
            disabled={!ready}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm(pick);
              setBusy(false);
            }}
          >
            {team ? "Yes, we lost" : "Yes, I lost"}
          </Button>
        </>
      }
    >
      <div className="gg-loss">
        <p className="gg-confirm__message">{message}</p>
        <div className="gg-loss__reasons" role="radiogroup" aria-label="How did you lose?">
          {LOSS_REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={reason === r.value}
              className={`gg-loss__reason ${reason === r.value ? "is-selected" : ""}`}
              onClick={() => setReason(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
        {needsWinner && (
          <SelectField label="Who won?" value={winnerId} onChange={(e) => setWinnerId(e.target.value)}>
            <option value="">Pick the winner…</option>
            {altWinners!.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </SelectField>
        )}
      </div>
    </Modal>
  );
}
