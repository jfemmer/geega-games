import { Icon } from "../ui/Icon";
import { formatDuration, gameDuration, lifeOf, type ReportableResult, type TournamentMatch } from "../../utils/tournament";

// One round's pairings. Tap a side to record who won (tap it again to clear,
// in the round being played), or Draw. Byes are listed last; they count as a
// win and need nothing recorded.

export function RoundMatches({
  matches,
  labels,
  editable,
  allowClear,
  onReport,
  startingLife,
  now,
}: {
  matches: TournamentMatch[];
  /** For life totals players track on their phones. */
  startingLife: number;
  /** Server-adjusted time now, for game clocks. */
  now: number;
  /** Entrant id → "Alex" or "Alex & Sam". */
  labels: Map<string, string>;
  /** False once the tournament is finished. */
  editable: boolean;
  /** Results can go back to "not played yet" only in the round being played. */
  allowClear: boolean;
  onReport: (match: TournamentMatch, result: ReportableResult) => void;
}) {
  return (
    <ul className="gg-tourney-matches">
      {matches.map((m) =>
        m.b == null ? (
          <li key={m.id} className="gg-tourney-match gg-tourney-match--bye">
            <span className="gg-tourney-match__table">Bye</span>
            <div className="gg-tourney-bye">
              <strong>{labels.get(m.a) ?? "Unknown"}</strong>
              <span className="gg-muted">sits out this round and gets the win</span>
            </div>
          </li>
        ) : (
          <MatchRow
            key={m.id}
            match={m}
            labelA={labels.get(m.a) ?? "Unknown"}
            labelB={labels.get(m.b) ?? "Unknown"}
            editable={editable}
            allowClear={allowClear}
            onReport={onReport}
            startingLife={startingLife}
            now={now}
          />
        ),
      )}
    </ul>
  );
}

function MatchRow({
  match,
  labelA,
  labelB,
  editable,
  allowClear,
  onReport,
  startingLife,
  now,
}: {
  startingLife: number;
  now: number;
  match: TournamentMatch;
  labelA: string;
  labelB: string;
  editable: boolean;
  allowClear: boolean;
  onReport: (match: TournamentMatch, result: ReportableResult) => void;
}) {
  const decided = match.result !== "pending";
  const pick = (result: Exclude<ReportableResult, "pending">) => {
    if (match.result === result) {
      if (allowClear) onReport(match, "pending");
      return;
    }
    onReport(match, result);
  };
  const disabled = !editable;

  const tracked = match.lifeA != null || match.lifeB != null;
  const elapsed = gameDuration(match, now);
  const side = (key: "a" | "b", label: string) => {
    const won = match.result === key;
    const life = lifeOf(match, key, startingLife);
    const lost = decided && !won && match.result !== "draw";
    return (
      <button
        type="button"
        className={`gg-tourney-side ${won ? "is-winner" : ""} ${lost ? "is-loser" : ""} ${match.result === "draw" ? "is-draw" : ""}`}
        aria-pressed={won}
        aria-label={won ? `${label} won${allowClear && editable ? " (tap to clear)" : ""}` : `${label} won`}
        disabled={disabled}
        onClick={() => pick(key)}
      >
        <span className="gg-tourney-side__name">{label}</span>
        {tracked && (
          <span className={`gg-tourney-side__life ${life <= 0 ? "is-out" : ""}`} title="Life (tracked on their phone)">
            {life}
          </span>
        )}
        {won && (
          <span className="gg-tourney-side__tag">
            <Icon name="check" size={14} />
            Won
          </span>
        )}
      </button>
    );
  };

  return (
    <li className={`gg-tourney-match ${decided ? "is-decided" : ""}`}>
      <span className="gg-tourney-match__table">
        Table {match.table}
        {elapsed != null && (
          <span className="gg-tourney-match__clock">
            <Icon name="clock" size={11} /> {formatDuration(elapsed)}
          </span>
        )}
      </span>
      <div className="gg-tourney-match__sides" role="group" aria-label={`Table ${match.table}: ${labelA} vs ${labelB}`}>
        {side("a", labelA)}
        <span className="gg-tourney-match__vs" aria-hidden="true">
          vs
        </span>
        {side("b", labelB)}
      </div>
      <button
        type="button"
        className={`gg-tourney-draw ${match.result === "draw" ? "is-selected" : ""}`}
        aria-pressed={match.result === "draw"}
        disabled={disabled}
        onClick={() => pick("draw")}
      >
        Draw
      </button>
    </li>
  );
}
