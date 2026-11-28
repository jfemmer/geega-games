import { Icon } from "../ui/Icon";
import { CommanderCards } from "./CommanderCards";
import {
  commanderSummary,
  entrantLabel,
  formatDuration,
  gameDuration,
  ordinal,
  podLife,
  stillIn,
  type FfaStandingRow,
  type TournamentEntrant,
  type TournamentPod,
  type TournamentPodPlayer,
} from "../../utils/tournament";

// Free-for-all on the player display (BracketDisplay): each table's game with
// everyone's life, who's out and where they finished; the rounds as columns;
// standings by points; and "your table" on a player's phone.

/** One table's game: every player around it, life while they're in, place once they're out. */
export function PodCard({
  pod,
  byId,
  startingLife,
  now,
  myId,
}: {
  pod: TournamentPod;
  byId: Map<string, TournamentEntrant>;
  startingLife: number;
  now: number;
  myId: string | null;
}) {
  const done = Boolean(pod.endedAt);
  const elapsed = gameDuration(pod, now);
  const left = stillIn(pod).length;
  const mine = myId != null && pod.players.some((p) => p.entrantId === myId);
  return (
    <li className={`gg-bmatch gg-bpod ${done ? "is-done" : ""} ${mine ? "is-mine" : ""}`}>
      <span className="gg-bmatch__table">
        <span>
          Table {pod.table}
          {!done && <span className="gg-bpod__left"> · {left} of {pod.players.length} left</span>}
        </span>
        {elapsed != null && (
          <span className={`gg-bmatch__clock ${done ? "is-done" : ""}`}>
            <Icon name="clock" size={12} />
            {done ? `Game over · ${formatDuration(elapsed)}` : formatDuration(elapsed)}
          </span>
        )}
      </span>
      <ol className="gg-bpod__players">
        {pod.players.map((p) => {
          const entrant = byId.get(p.entrantId);
          return entrant ? (
            <PodSeat key={p.id} player={p} entrant={entrant} startingLife={startingLife} done={done} mine={p.entrantId === myId} />
          ) : null;
        })}
      </ol>
    </li>
  );
}

function PodSeat({
  player,
  entrant,
  startingLife,
  done,
  mine,
}: {
  player: TournamentPodPlayer;
  entrant: TournamentEntrant;
  startingLife: number;
  done: boolean;
  mine: boolean;
}) {
  const won = done && player.place === 1;
  const out = Boolean(player.outAt);
  const life = podLife(player, startingLife);
  const low = life <= Math.ceil(startingLife / 4);
  const cmd = commanderSummary(entrant);
  const state = won ? "won" : out ? "lost" : "playing";
  return (
    <li className={`gg-bside gg-bside--${state} ${mine ? "is-mine" : ""}`}>
      <CommanderCards entrant={entrant} size="md" />
      <div className="gg-bside__text">
        {won && (
          <span className="gg-bside__tag">
            <Icon name="trophy" size={13} /> Won
          </span>
        )}
        {out && player.place != null && <span className="gg-bside__tag gg-bside__tag--out">Out · {ordinal(player.place)}</span>}
        <strong>{entrantLabel(entrant)}</strong>
        {cmd && <span className="gg-bside__cmd">{cmd}</span>}
      </div>
      {!out && (
        <span className={`gg-bside__life ${low ? "is-low" : ""} ${life <= 0 ? "is-out" : ""}`} aria-label={`${life} life`}>
          {life}
        </span>
      )}
    </li>
  );
}

/** A round's tables, compactly: who finished where. */
export function PodRoundColumn({
  round,
  pods,
  byId,
  current,
  myId,
}: {
  round: number;
  pods: TournamentPod[];
  byId: Map<string, TournamentEntrant>;
  current: boolean;
  myId: string | null;
}) {
  const done = pods.every((p) => p.endedAt);
  return (
    <div className={`gg-bcol ${current ? "is-current" : ""}`}>
      <h3>
        Round {round}
        {done ? <Icon name="check" size={14} /> : <span className="gg-bcol__live">Live</span>}
      </h3>
      <ol>
        {pods.map((pod) => {
          // Still playing first (no place yet), then by finishing place.
          const byPlace = [...pod.players].sort((x, y) => (x.place ?? 0) - (y.place ?? 0) || x.seat - y.seat);
          return (
            <li key={pod.id} className="gg-bmini">
              {pods.length > 1 && <span className="gg-bmini__note">Table {pod.table}</span>}
              {byPlace.map((p) => {
                const e = byId.get(p.entrantId);
                if (!e) return null;
                const won = Boolean(pod.endedAt) && p.place === 1;
                return (
                  <span
                    key={p.id}
                    className={`gg-bmini__line ${won ? "is-won" : ""} ${p.outAt ? "is-lost" : ""} ${myId === e.id ? "is-mine" : ""}`}
                  >
                    <span>{entrantLabel(e)}</span>
                    {won ? (
                      <Icon name="check" size={13} />
                    ) : (
                      p.place != null && <small className="gg-bmini__place">{ordinal(p.place)}</small>
                    )}
                  </span>
                );
              })}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Free-for-all standings: points by finishing place, then games won. */
export function FfaStandings({ rows, started, myId }: { rows: FfaStandingRow[]; started: boolean; myId: string | null }) {
  return (
    <table className="gg-bstand">
      <caption className="gg-visually-hidden">Standings: rank, games won and points</caption>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Player</th>
          <th scope="col">
            <abbr title="Games won">W</abbr>
          </th>
          <th scope="col">
            <abbr title="Points: at a table of N players, 1st gets N, down to 1 for the first one out">Pts</abbr>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const cmd = commanderSummary(r.entrant);
          const dropped = Boolean(r.entrant.droppedAt);
          return (
            <tr
              key={r.entrant.id}
              className={[myId === r.entrant.id ? "is-mine" : "", dropped ? "is-dropped" : ""].filter(Boolean).join(" ") || undefined}
            >
              <td className="gg-bstand__rank">{started ? r.rank : "–"}</td>
              <td>
                <div className="gg-bstand__who">
                  <CommanderCards entrant={r.entrant} size="sm" />
                  <div>
                    <strong>{entrantLabel(r.entrant)}</strong>
                    {dropped && <span className="gg-bstand__dropped"> · dropped</span>}
                    {cmd && <span className="gg-bstand__cmd">{cmd}</span>}
                  </div>
                </div>
              </td>
              <td className="gg-bstand__num">{r.wins}</td>
              <td className="gg-bstand__num gg-bstand__pts">{r.points}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** "Your table" on a phone once the player is out or the game is over. */
export function MyPodTable({ pod, player }: { pod: TournamentPod; player: TournamentPodPlayer }) {
  const of = pod.players.length;
  const left = stillIn(pod).length;
  const headline = pod.endedAt
    ? player.place === 1
      ? "You won!"
      : player.place != null
        ? `You finished ${ordinal(player.place)} of ${of}`
        : "Game over"
    : player.place != null
      ? `You're out · ${ordinal(player.place)} of ${of}`
      : "You're playing";
  return (
    <div className="gg-bracket__mytable" role="status">
      <span className="gg-bracket__mytable-num">
        <small>Table</small>
        {pod.table}
      </span>
      <span>
        <strong>{headline}</strong>
        <small>
          {of}-player game{pod.endedAt ? "" : ` · ${left} still playing`}
        </small>
      </span>
    </div>
  );
}
