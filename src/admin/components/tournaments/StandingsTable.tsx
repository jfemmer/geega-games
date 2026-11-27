import { useState, type FormEvent } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import {
  cleanPlayerName,
  entrantLabel,
  entrantProblem,
  formatInfo,
  type StandingRow,
  type TournamentEntrant,
  type TournamentFormat,
} from "../../utils/tournament";

// Standings (wins, losses, draws, points, tiebreaker) with who each entrant
// has played, plus the form for late arrivals. Edit / drop live on each row.

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
                    {row.byes > 0 && (
                      <Badge tone="info">
                        {row.byes} bye{row.byes === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
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
                    <div className="gg-tourney-standings__actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="edit"
                        aria-label={`Edit ${label}`}
                        title="Edit name"
                        onClick={() => onEdit(row.entrant)}
                      />
                      {dropped ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="plus"
                          className="gg-tourney-standings__restore"
                          aria-label={`Bring back ${label}`}
                          title="Bring back into the tournament"
                          onClick={() => onRestore(row.entrant)}
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
                          onClick={() => onRemove(row.entrant)}
                        />
                      )}
                    </div>
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
}: {
  format: TournamentFormat;
  values: string[];
  onChange: (values: string[]) => void;
  autoFocus?: boolean;
}) {
  const size = formatInfo(format).teamSize;
  return (
    <>
      {Array.from({ length: size }, (_, i) => (
        <TextField
          key={i}
          label={size === 1 ? "Player name" : `Player ${i + 1}`}
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
  onAdd,
}: {
  format: TournamentFormat;
  started: boolean;
  onAdd: (players: string[]) => Promise<boolean>;
}) {
  const info = formatInfo(format);
  const [values, setValues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const players = Array.from({ length: info.teamSize }, (_, i) => cleanPlayerName(values[i] ?? ""));
    const problem = entrantProblem(format, players);
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
          onChange={(next) => {
            setValues(next);
            setError(null);
          }}
        />
        <Button type="submit" variant="secondary" icon="plus" loading={busy}>
          Add {info.noun}
        </Button>
      </div>
      {error ? (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      ) : (
        <p className="gg-field__hint">
          {started ? `Late arrivals join from the next round with no wins.` : `They'll be paired in round 1.`}
        </p>
      )}
    </form>
  );
}
