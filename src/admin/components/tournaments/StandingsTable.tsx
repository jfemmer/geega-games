import { useState, type FormEvent } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import {
  cleanPlayerName,
  commanderSummary,
  entrantLabel,
  entrantProblem,
  formatInfo,
  ordinal,
  type FfaStandingRow,
  type StandingRow,
  type TournamentEntrant,
  type TournamentFormat,
} from "../../utils/tournament";

// Standings (wins, losses, draws, points, tiebreaker) with who each entrant
// has played, plus the form for late arrivals. Edit / drop live on each row.
// Free-for-all has its own table: points by finishing place, games won, and
// where they finished each round.

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function StandingsTable({
  rows,
  format,
  labels,
  editable,
  started,
  onEdit,
  onRemove,
  onRestore,
}: {
  rows: StandingRow[];
  format: TournamentFormat;
  labels: Map<string, string>;
  editable: boolean;
  /** Round 1 has been paired. */
  started: boolean;
  onEdit: (entrant: TournamentEntrant) => void;
  onRemove: (entrant: TournamentEntrant) => void;
  onRestore: (entrant: TournamentEntrant) => void;
}) {
  const info = formatInfo(format);
  return (
    <div className="gg-table-wrap">
      <table className="gg-table gg-tourney-standings">
        <caption className="gg-visually-hidden">
          Standings: wins, losses, draws and points for each {info.noun}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="gg-align-center">
              #
            </th>
            <th scope="col">{format === "2hg" ? "Team" : "Player"}</th>
            <th scope="col" className="gg-align-center gg-tourney-standings__wld">
              <abbr title="Wins">W</abbr>
            </th>
            <th scope="col" className="gg-align-center gg-tourney-standings__wld">
              <abbr title="Losses">L</abbr>
            </th>
            <th scope="col" className="gg-align-center gg-tourney-standings__wld">
              <abbr title="Draws">D</abbr>
            </th>
            <th scope="col" className="gg-align-center gg-tourney-standings__record">
              <abbr title="Wins-losses-draws">W-L-D</abbr>
            </th>
            <th scope="col" className="gg-align-center">
              <abbr title="Points: 3 for a win, 1 for a draw">Pts</abbr>
            </th>
            <th scope="col" className="gg-align-center gg-tourney-standings__omw">
              <abbr title="Tiebreaker: opponents' match-win percentage">Opp %</abbr>
            </th>
            {editable && (
              <th scope="col">
                <span className="gg-visually-hidden">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const label = entrantLabel(row.entrant);
            const dropped = Boolean(row.entrant.droppedAt);
            const played = row.opponents.map((id) => labels.get(id) ?? "Unknown");
            return (
              <tr key={row.entrant.id} className={dropped ? "gg-tourney-standings__dropped" : undefined}>
                <td className="gg-align-center gg-tourney-standings__rank">{started ? row.rank : "–"}</td>
                <td>
                  <div className="gg-tourney-standings__name">
                    <strong>{label}</strong>
                    {dropped && <Badge tone="neutral">Dropped</Badge>}
                    {format === "2hg" && row.entrant.players.length === 1 && <Badge tone="warning">Needs a teammate</Badge>}
                    {row.byes > 0 && (
                      <Badge tone="info">
                        {row.byes} bye{row.byes === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
                  {commanderSummary(row.entrant) && (
                    <div className="gg-tourney-standings__commander">{commanderSummary(row.entrant)}</div>
                  )}
                  {played.length > 0 && <div className="gg-tourney-standings__played">vs {played.join(", ")}</div>}
                </td>
                <td className="gg-align-center gg-tourney-standings__wld">{row.wins}</td>
                <td className="gg-align-center gg-tourney-standings__wld">{row.losses}</td>
                <td className="gg-align-center gg-tourney-standings__wld">{row.draws}</td>
                <td className="gg-align-center gg-tourney-standings__record">
                  {row.wins}-{row.losses}-{row.draws}
                </td>
                <td className="gg-align-center">
                  <strong>{row.points}</strong>
                </td>
                <td className="gg-align-center gg-tourney-standings__omw">
                  {row.opponents.length > 0 ? pct(row.opponentWinPct) : "–"}
                </td>
                {editable && (
                  <td>
                    <RowActions entrant={row.entrant} started={started} onEdit={onEdit} onRemove={onRemove} onRestore={onRestore} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Edit, and drop / remove / bring back, for one row. */
function RowActions({
  entrant,
  started,
  onEdit,
  onRemove,
  onRestore,
}: {
  entrant: TournamentEntrant;
  started: boolean;
  onEdit: (entrant: TournamentEntrant) => void;
  onRemove: (entrant: TournamentEntrant) => void;
  onRestore: (entrant: TournamentEntrant) => void;
}) {
  const label = entrantLabel(entrant);
  return (
    <div className="gg-tourney-standings__actions">
      <Button size="sm" variant="ghost" icon="edit" aria-label={`Edit ${label}`} title="Edit name" onClick={() => onEdit(entrant)} />
      {entrant.droppedAt ? (
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          className="gg-tourney-standings__restore"
          aria-label={`Bring back ${label}`}
          title="Bring back into the tournament"
          onClick={() => onRestore(entrant)}
        >
          Bring back
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          icon="trash"
          aria-label={`${started ? "Drop" : "Remove"} ${label}`}
          title={started ? "Drop from the tournament" : "Remove"}
          onClick={() => onRemove(entrant)}
        />
      )}
    </div>
  );
}

/** Free-for-all standings: points by finishing place, games won, and each round's finish. */
export function FfaStandingsTable({
  rows,
  editable,
  started,
  onEdit,
  onRemove,
  onRestore,
}: {
  rows: FfaStandingRow[];
  editable: boolean;
  /** Round 1 has been dealt. */
  started: boolean;
  onEdit: (entrant: TournamentEntrant) => void;
  onRemove: (entrant: TournamentEntrant) => void;
  onRestore: (entrant: TournamentEntrant) => void;
}) {
  return (
    <div className="gg-table-wrap">
      <table className="gg-table gg-tourney-standings">
        <caption className="gg-visually-hidden">Standings: points, games won and games played for each player</caption>
        <thead>
          <tr>
            <th scope="col" className="gg-align-center">
              #
            </th>
            <th scope="col">Player</th>
            <th scope="col" className="gg-align-center">
              <abbr title="Points: at a table of N players, 1st gets N, down to 1 for the first one out">Pts</abbr>
            </th>
            <th scope="col" className="gg-align-center">
              <abbr title="Games won (last one standing)">Wins</abbr>
            </th>
            <th scope="col" className="gg-align-center gg-tourney-standings__omw">
              Games
            </th>
            {editable && (
              <th scope="col">
                <span className="gg-visually-hidden">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const dropped = Boolean(row.entrant.droppedAt);
            const finishes = row.places.map((p) => (p.place == null ? "playing" : `${ordinal(p.place)} of ${p.of}`));
            return (
              <tr key={row.entrant.id} className={dropped ? "gg-tourney-standings__dropped" : undefined}>
                <td className="gg-align-center gg-tourney-standings__rank">{started ? row.rank : "–"}</td>
                <td>
                  <div className="gg-tourney-standings__name">
                    <strong>{entrantLabel(row.entrant)}</strong>
                    {dropped && <Badge tone="neutral">Dropped</Badge>}
                  </div>
                  {commanderSummary(row.entrant) && (
                    <div className="gg-tourney-standings__commander">{commanderSummary(row.entrant)}</div>
                  )}
                  {finishes.length > 0 && <div className="gg-tourney-standings__played">Finished {finishes.join(", ")}</div>}
                </td>
                <td className="gg-align-center">
                  <strong>{row.points}</strong>
                </td>
                <td className="gg-align-center">{row.wins}</td>
                <td className="gg-align-center gg-tourney-standings__omw">{row.games}</td>
                {editable && (
                  <td>
                    <RowActions entrant={row.entrant} started={started} onEdit={onEdit} onRemove={onRemove} onRestore={onRestore} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Name fields for one entrant: one for 1v1, two for a Two-Headed Giant team. */
export function EntrantFields({
  format,
  values,
  onChange,
  autoFocus,
  allowSolo,
}: {
  format: TournamentFormat;
  values: string[];
  onChange: (values: string[]) => void;
  autoFocus?: boolean;
  /** Player 2 may be left empty (sign-ups: they get a teammate later). */
  allowSolo?: boolean;
}) {
  const size = formatInfo(format).teamSize;
  return (
    <>
      {Array.from({ length: size }, (_, i) => (
        <TextField
          key={i}
          label={size === 1 ? "Player name" : i === 1 && allowSolo ? "Player 2 (optional)" : `Player ${i + 1}`}
          value={values[i] ?? ""}
          maxLength={40}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => {
            const next = [...values];
            next[i] = e.target.value;
            onChange(next);
          }}
        />
      ))}
    </>
  );
}

/** Late arrivals: they're paired from the next round. */
export function AddEntrantForm({
  format,
  started,
  allowSolo = false,
  onAdd,
}: {
  format: TournamentFormat;
  started: boolean;
  /** Sign-ups: a Two-Headed Giant player can be added alone. */
  allowSolo?: boolean;
  onAdd: (players: string[]) => Promise<boolean>;
}) {
  const info = formatInfo(format);
  const [values, setValues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const players = Array.from({ length: info.teamSize }, (_, i) => cleanPlayerName(values[i] ?? "")).filter(
      (p, i) => i === 0 || p || !allowSolo,
    );
    const problem = entrantProblem(format, players, allowSolo);
    setError(problem);
    if (problem) return;
    setBusy(true);
    const ok = await onAdd(players);
    setBusy(false);
    if (ok) setValues([]);
  }

  return (
    <form className="gg-tourney-add" onSubmit={submit} noValidate>
      <div className="gg-tourney-add__fields">
        <EntrantFields
          format={format}
          values={values}
          allowSolo={allowSolo}
          onChange={(next) => {
            setValues(next);
            setError(null);
          }}
        />
        <Button type="submit" variant="secondary" icon="plus" loading={busy}>
          Add {allowSolo ? "player" : info.noun}
        </Button>
      </div>
      {error ? (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      ) : (
        <p className="gg-field__hint">
          {started
            ? `Late arrivals join from the next round with no wins.`
            : allowSolo && format === "2hg"
              ? "Leave Player 2 empty and they'll get a teammate. Added players take spots."
              : allowSolo
                ? "Added players take spots, like sign-ups."
                : `They'll be paired in round 1.`}
        </p>
      )}
    </form>
  );
}
