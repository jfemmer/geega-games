import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SelectField } from "../ui/Field";
import { Icon } from "../ui/Icon";
import {
  formatDuration,
  gameDuration,
  ordinal,
  podLife,
  stillIn,
  type TournamentPod,
  type TournamentPodPlayer,
} from "../../utils/tournament";

// Free-for-all tables for staff (admin → Tournaments): everyone at each
// table with the life they're tracking on their phones, where each player
// finished, and the staff controls: mark a player out (they take the next
// place from the bottom; the last one left wins), undo the last one out, or
// call the game for someone (time's up: everyone else still in shares 2nd).

export function PodTables({
  pods,
  labels,
  editable,
  startingLife,
  now,
  busy,
  onOut,
  onWinner,
  onUndo,
}: {
  pods: TournamentPod[];
  /** Entrant id → name. */
  labels: Map<string, string>;
  /** Staff can change these games (this round, tournament not finished). */
  editable: boolean;
  startingLife: number;
  /** Server-adjusted time now, for game clocks. */
  now: number;
  /** The pod id a change is being saved for. */
  busy: string | null;
  onOut: (pod: TournamentPod, player: TournamentPodPlayer) => void;
  onWinner: (pod: TournamentPod, entrantId: string) => void;
  onUndo: (pod: TournamentPod) => void;
}) {
  return (
    <ul className="gg-tourney-pods">
      {pods.map((pod) => (
        <PodTable
          key={pod.id}
          pod={pod}
          labels={labels}
          editable={editable}
          startingLife={startingLife}
          now={now}
          busy={busy === pod.id}
          onOut={onOut}
          onWinner={onWinner}
          onUndo={onUndo}
        />
      ))}
    </ul>
  );
}

function PodTable({
  pod,
  labels,
  editable,
  startingLife,
  now,
  busy,
  onOut,
  onWinner,
  onUndo,
}: {
  pod: TournamentPod;
  labels: Map<string, string>;
  editable: boolean;
  startingLife: number;
  now: number;
  busy: boolean;
  onOut: (pod: TournamentPod, player: TournamentPodPlayer) => void;
  onWinner: (pod: TournamentPod, entrantId: string) => void;
  onUndo: (pod: TournamentPod) => void;
}) {
  const done = Boolean(pod.endedAt);
  const left = stillIn(pod);
  const anyOut = pod.players.some((p) => p.outAt);
  const elapsed = gameDuration(pod, now);
  const name = (p: TournamentPodPlayer) => labels.get(p.entrantId) ?? "Unknown";
  const tracked = pod.players.some((p) => p.life != null);

  return (
    <li className={`gg-tourney-pod ${done ? "is-decided" : ""}`}>
      <div className="gg-tourney-pod__head">
        <strong>Table {pod.table}</strong>
        <span className="gg-muted">{done ? "Game over" : `${left.length} of ${pod.players.length} still in`}</span>
        {elapsed != null && (
          <span className="gg-tourney-match__clock">
            <Icon name="clock" size={11} /> {formatDuration(elapsed)}
          </span>
        )}
      </div>
      <ol className="gg-tourney-pod__seats" aria-label={`Table ${pod.table}`}>
        {pod.players.map((p) => {
          const won = done && p.place === 1;
          const out = Boolean(p.outAt);
          const life = podLife(p, startingLife);
          return (
            <li key={p.id} className={`gg-tourney-seat ${won ? "is-winner" : ""} ${out ? "is-out" : ""}`}>
              <span className="gg-tourney-seat__name">{name(p)}</span>
              {won ? (
                <Badge tone="success">
                  <Icon name="trophy" size={12} /> Won
                </Badge>
              ) : out && p.place != null ? (
                <Badge tone="neutral">{ordinal(p.place)}</Badge>
              ) : (
                tracked && (
                  <span className={`gg-tourney-side__life ${life <= 0 ? "is-out" : ""}`} title="Life (tracked on their phone)">
                    {life}
                  </span>
                )
              )}
              {editable && !done && !out && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`${name(p)} is out`}
                  title={left.length === 2 ? "Out: the other player wins" : `Out: finishes ${ordinal(left.length)}`}
                  onClick={() => onOut(pod, p)}
                >
                  Out
                </Button>
              )}
            </li>
          );
        })}
      </ol>
      {editable && (!done || anyOut) && (
        <div className="gg-tourney-pod__actions">
          {!done && left.length > 1 && (
            <div className="gg-tourney-pod__call">
              <SelectField
                label="Time's up? Call it for"
                value=""
                disabled={busy}
                onChange={(e) => {
                  if (e.target.value) onWinner(pod, e.target.value);
                }}
              >
                <option value="">Pick the winner…</option>
                {left.map((p) => (
                  <option key={p.id} value={p.entrantId}>
                    {name(p)}
                  </option>
                ))}
              </SelectField>
            </div>
          )}
          {anyOut && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onUndo(pod)}>
              Undo last out
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
