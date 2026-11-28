import { useMemo, useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { SelectField, TextField } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { QrCode } from "../partners/QrCode";
import { CommanderPicker, type CommanderOption } from "./CommanderPicker";
import { LifeCounter } from "./LifeCounter";
import { CommanderCards } from "./CommanderCards";
import { FfaStandings, MyPodTable, PodCard, PodRoundColumn } from "./PodDisplay";
import { useClock } from "../../hooks/useClock";
import {
  MAX_PLAYER_NAME,
  activeEntrants,
  cleanPlayerName,
  commanderSummary,
  computeFfaStandings,
  computeStandings,
  entrantLabel,
  formatDuration,
  formatInfo,
  findSeatAt,
  gameDuration,
  hasLiveGames,
  isSigningUp,
  lifeOf,
  matchesInRound,
  ordinal,
  podLife,
  podsInRound,
  stillIn,
  parseSeatKey,
  playerCount,
  seatKey,
  soloEntrants,
  type PlayerSeat,
  type StandingRow,
  type TournamentCommander,
  type TournamentDetail,
  type TournamentEntrant,
  type TournamentMatch,
} from "../../utils/tournament";

// The player display (/tournament?t=…): what players see on the store TV or
// their phones. Presentational — the page (src/store/pages/TournamentPage.tsx)
// loads the tournament and saves commanders.
//
//   TV (view=tv): the round being played and the standings side by side, a
//   QR code for phones, and every round as columns underneath.
//   Phone: "your commander" and "your table" first, then the same sections
//   stacked.
//
// Free-for-all shows tables instead of matches (PodDisplay.tsx): everyone at
// a table with their life, who's out and where they finished.

/** What a player sends to take a spot. */
export interface SignUpInput {
  name: string;
  commander: TournamentCommander | null;
  /** Two-Headed Giant: someone who signed up alone, to team up with. */
  teamWith: string | null;
}

/** Open-spot placeholders shown before "+ N more". */
const OPEN_SPOTS_SHOWN = 12;

function statusLine(t: TournamentDetail, pending: number, pairs: number, entrants: number): string {
  const info = formatInfo(t.format);
  if (t.status === "finished") return "Final standings";
  if (isSigningUp(t)) return `Signing up · ${playerCount(t)} of ${t.spots} spots filled`;
  if (t.currentRound === 0) return `Starting soon · ${entrants} ${entrants === 1 ? info.noun : info.nounPlural}`;
  if (t.format === "ffa") {
    const pods = podsInRound(t.pods, t.currentRound);
    const over = pods.filter((p) => p.endedAt).length;
    if (pods.length === 0) return `Round ${t.currentRound}`;
    if (pods.length === 1) return `Round ${t.currentRound} · ${over === 1 ? "game over" : "playing"}`;
    return over === pods.length ? `Round ${t.currentRound} · every game is over` : `Round ${t.currentRound} · ${over} of ${pods.length} games over`;
  }
  if (pairs === 0) return `Round ${t.currentRound}`;
  return pending === 0
    ? `Round ${t.currentRound} · all results in`
    : `Round ${t.currentRound} · ${pairs - pending} of ${pairs} results in`;
}

export function BracketDisplay({
  tournament,
  tv,
  shareUrl,
  logoSrc,
  me,
  onPickMe,
  onSaveCommander,
  onSignUp,
  onChangeLife,
  onLost,
  onChangePodLife,
  onPodOut,
  searchCommanders,
  updatedAt,
  onFullscreen,
  tvUrl,
  clockOffset = 0,
}: {
  tournament: TournamentDetail;
  tv: boolean;
  /** The phone link, for the QR code on the TV. */
  shareUrl: string | null;
  logoSrc: string;
  me: PlayerSeat | null;
  onPickMe: (seat: PlayerSeat | null) => void;
  onSaveCommander: (seat: PlayerSeat, commander: TournamentCommander | null) => Promise<boolean>;
  /** Takes a spot (sign-up tournaments). */
  onSignUp?: (input: SignUpInput) => Promise<boolean>;
  /** Changes a side's life in a game being played. */
  onChangeLife?: (matchId: string, side: "a" | "b", delta: number) => Promise<boolean>;
  /** Records that a side lost a game being played. */
  onLost?: (matchId: string, side: "a" | "b") => Promise<boolean>;
  /** Free-for-all: changes a player's life at their table. */
  onChangePodLife?: (podPlayerId: string, delta: number) => Promise<boolean>;
  /** Free-for-all: the player is out of their table's game. */
  onPodOut?: (podPlayerId: string) => Promise<boolean>;
  /** Server clock minus device clock (ms), for game timers. */
  clockOffset?: number;
  searchCommanders: (query: string) => Promise<CommanderOption[]>;
  updatedAt: Date | null;
  onFullscreen?: () => void;
  /** Link to the TV layout, offered on phones. */
  tvUrl?: string;
}) {
  const t = tournament;
  const info = formatInfo(t.format);
  const ffa = t.format === "ffa";
  const derived = useMemo(() => {
    const byId = new Map(t.entrants.map((e) => [e.id, e]));
    const standings = computeStandings(t.entrants, t.matches);
    const ffaStandings = t.format === "ffa" ? computeFfaStandings(t.entrants, t.pods) : [];
    const current = matchesInRound(t.matches, t.currentRound);
    const currentPods = podsInRound(t.pods, t.currentRound);
    const pairs = current.filter((m) => m.b != null).length;
    const pending = current.filter((m) => m.result === "pending").length;
    const rounds = Array.from({ length: t.currentRound }, (_, i) => i + 1);
    return { byId, standings, ffaStandings, current, currentPods, pairs, pending, rounds };
  }, [t]);
  const { byId, standings, ffaStandings, current, currentPods, pairs, pending, rounds } = derived;
  const active = activeEntrants(t);
  const finished = t.status === "finished";
  const leaders: { entrant: TournamentEntrant }[] = finished
    ? (ffa ? ffaStandings : standings).filter((r) => r.rank === 1 && r.points > 0)
    : [];
  const signingUp = isSigningUp(t);
  const players = playerCount(t);
  const spotsLeft = signingUp && t.spots != null ? Math.max(0, t.spots - players) : 0;
  const meEntrant = me ? byId.get(me.entrantId) ?? null : null;
  const seated = me && meEntrant && me.seat < meEntrant.players.length ? me : null;
  const myMatch =
    meEntrant && !finished ? current.find((m) => m.a === meEntrant.id || m.b === meEntrant.id) ?? null : null;
  const liveGames = hasLiveGames(t);
  const now = useClock(liveGames, clockOffset);
  const games = ffa ? currentPods : current;
  const roundStart = games.length > 0 ? Math.min(...games.map((g) => new Date(g.startedAt).getTime())) : null;
  const myLiveGame =
    !ffa && myMatch && myMatch.b != null && myMatch.result === "pending" && seated && meEntrant && onChangeLife && onLost
      ? myMatch
      : null;
  // Free-for-all: this player's seat this round, and whether they're still playing it.
  const mySeat = ffa && meEntrant && !finished ? findSeatAt(t.pods, t.currentRound, meEntrant.id) : null;
  const myLiveSeat =
    mySeat && !mySeat.pod.endedAt && !mySeat.player.outAt && seated && onChangePodLife && onPodOut ? mySeat : null;
  const inLiveGame = Boolean(myLiveGame || myLiveSeat);

  const head = (
    <header className="gg-bracket__head">
      <img src={logoSrc} alt="Geega Games" className="gg-bracket__logo" />
      <div className="gg-bracket__title">
        <h1>{t.name}</h1>
        <p>
          <span className="gg-bracket__format">{info.label}</span>
          <span>{statusLine(t, pending, pairs, active.length)}</span>
        </p>
      </div>
      {tv && shareUrl && t.status === "active" && !signingUp && (
        <div className="gg-bracket__qr">
          <QrCode value={shareUrl} size={132} label="QR code: open this bracket on your phone" />
          <span>
            Scan to follow along
            <br />
            and add your commander
          </span>
        </div>
      )}
      {tv && onFullscreen && (
        <button
          type="button"
          className="gg-bracket__fullscreen"
          onClick={onFullscreen}
          aria-label="Full screen"
          title="Full screen"
        >
          <Icon name="external" size={18} />
        </button>
      )}
    </header>
  );

  const champion = leaders.length > 0 && (
    <div className="gg-bracket__champion" role="status">
      <Icon name="trophy" size={tv ? 32 : 24} />
      <div>
        <span>{leaders.length === 1 ? "Winner" : "Tied for first"}</span>
        <strong>{leaders.map((r) => entrantLabel(r.entrant)).join(", ")}</strong>
        {leaders.length === 1 && commanderSummary(leaders[0].entrant) && (
          <small>{commanderSummary(leaders[0].entrant)}</small>
        )}
      </div>
      {leaders.length === 1 && leaders[0].entrant.commanders.some((c) => c?.cardId) && (
        <CommanderCards entrant={leaders[0].entrant} size="lg" />
      )}
    </div>
  );

  const roundSection = (
    <section className="gg-bracket__section gg-bracket__now" aria-labelledby="bracket-now">
      <h2 id="bracket-now">
        {t.currentRound === 0 ? "Who's playing" : finished ? `Round ${t.currentRound}` : `Now playing · Round ${t.currentRound}`}
        {liveGames && roundStart != null && Number.isFinite(roundStart) && (
          <>
            {" · "}
            <span className="gg-bracket__roundclock">{formatDuration(now - roundStart)}</span>
          </>
        )}
      </h2>
      {t.currentRound === 0 ? (
        <ul className="gg-bracket__entrants">
          {active.map((e) => (
            <li key={e.id} className={meEntrant?.id === e.id ? "is-mine" : undefined}>
              <CommanderCards entrant={e} size="sm" />
              <div>
                <strong>{entrantLabel(e)}</strong>
                {commanderSummary(e) && <span>{commanderSummary(e)}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : ffa ? (
        <ul className="gg-bracket__matches gg-bracket__pods">
          {currentPods.map((pod) => (
            <PodCard
              key={pod.id}
              pod={pod}
              byId={byId}
              startingLife={t.startingLife}
              now={now}
              myId={meEntrant?.id ?? null}
            />
          ))}
        </ul>
      ) : (
        <ul className="gg-bracket__matches">
          {current.map((m) => (
            <MatchCard
              key={m.id}
              match={m}
              byId={byId}
              mine={myMatch?.id === m.id}
              startingLife={t.startingLife}
              now={now}
            />
          ))}
        </ul>
      )}
    </section>
  );

  const lobbySection = signingUp && (
    <section className="gg-bracket__section gg-bracket__lobby" aria-labelledby="bracket-lobby">
      <h2 id="bracket-lobby">
        Who's in · {players} of {t.spots}
      </h2>
      <div
        className="gg-bracket__spotsbar"
        role="progressbar"
        aria-label="Spots filled"
        aria-valuemin={0}
        aria-valuemax={t.spots ?? 0}
        aria-valuenow={players}
      >
        <span style={{ width: `${t.spots ? Math.min(100, (players / t.spots) * 100) : 0}%` }} />
      </div>
      <ul className="gg-bracket__entrants">
        {active.map((e) => (
          <li key={e.id} className={meEntrant?.id === e.id ? "is-mine" : undefined}>
            <CommanderCards entrant={e} size="sm" />
            <div>
              <strong>{entrantLabel(e)}</strong>
              {commanderSummary(e) && <span>{commanderSummary(e)}</span>}
              {t.format === "2hg" && e.players.length === 1 && <span className="gg-bracket__lfg">Needs a teammate</span>}
            </div>
          </li>
        ))}
        {/* The TV shows each open spot; a phone, one line. */}
        {!tv && spotsLeft > 0 && (
          <li className="gg-bracket__open">
            <span className="gg-bcards gg-bcards--sm gg-bcards--empty" aria-hidden="true">
              +
            </span>
            <span>
              {spotsLeft} open {spotsLeft === 1 ? "spot" : "spots"}
            </span>
          </li>
        )}
        {Array.from({ length: tv ? Math.min(spotsLeft, OPEN_SPOTS_SHOWN) : 0 }, (_, i) => (
          <li key={`open-${i}`} className="gg-bracket__open">
            <span className="gg-bcards gg-bcards--sm gg-bcards--empty" aria-hidden="true">
              +
            </span>
            <span>Open spot</span>
          </li>
        ))}
        {tv && spotsLeft > OPEN_SPOTS_SHOWN && (
          <li className="gg-bracket__open">
            <span>+ {spotsLeft - OPEN_SPOTS_SHOWN} more open spots</span>
          </li>
        )}
      </ul>
    </section>
  );

  // Before round 1 the standings would only repeat "who's playing" with zeros.
  const standingsSection = t.currentRound > 0 && (
    <section className="gg-bracket__section gg-bracket__standings" aria-labelledby="bracket-standings">
      <h2 id="bracket-standings">Standings</h2>
      {ffa ? (
        <FfaStandings rows={ffaStandings} started={t.currentRound > 0} myId={meEntrant?.id ?? null} />
      ) : (
        <Standings rows={standings} started={t.currentRound > 0} myId={meEntrant?.id ?? null} />
      )}
    </section>
  );

  const roundsSection = rounds.length > 0 && (
    <section className="gg-bracket__section gg-bracket__rounds" aria-labelledby="bracket-rounds">
      <h2 id="bracket-rounds">Rounds</h2>
      <div className="gg-bracket__cols">
        {rounds.map((round) =>
          ffa ? (
            <PodRoundColumn
              key={round}
              round={round}
              pods={podsInRound(t.pods, round)}
              byId={byId}
              current={round === t.currentRound && !finished}
              myId={meEntrant?.id ?? null}
            />
          ) : (
            <RoundColumn
              key={round}
              round={round}
              matches={matchesInRound(t.matches, round)}
              byId={byId}
              current={round === t.currentRound && !finished}
              myId={meEntrant?.id ?? null}
            />
          ),
        )}
      </div>
    </section>
  );

  const footer = (
    <footer className="gg-bracket__foot">
      <span>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span>
      <span>Card images © Wizards of the Coast, via Scryfall</span>
      {!tv && tvUrl && (
        <a href={tvUrl} className="gg-bracket__tvlink">
          TV view
        </a>
      )}
    </footer>
  );

  if (tv && signingUp) {
    return (
      <div className="gg-bracket gg-bracket--tv gg-bracket--lobbyview">
        {head}
        <div className="gg-bracket__lobbygrid">
          <div className="gg-bracket__join">
            {shareUrl && <QrCode value={shareUrl} size={240} label="QR code: scan to sign up" />}
            <strong>Scan to join</strong>
            <span>
              Enter your name and commander on your phone. Round 1 starts when all {t.spots} spots are filled.
            </span>
            <div className="gg-bracket__count" aria-live="polite">
              <b>{players}</b>
              <span>/ {t.spots}</span>
              <small>players in</small>
            </div>
          </div>
          {lobbySection}
        </div>
        {footer}
      </div>
    );
  }

  if (tv) {
    return (
      <div className="gg-bracket gg-bracket--tv">
        {head}
        {champion}
        {/* Everything on one screen: a TV can't scroll. */}
        <div className={`gg-bracket__grid ${standingsSection ? "" : "gg-bracket__grid--solo"}`}>
          <div className="gg-bracket__main">
            {/* Once it's over, the round columns already show the last round. */}
            {!finished && roundSection}
            {roundsSection}
          </div>
          {standingsSection}
        </div>
        {footer}
      </div>
    );
  }

  return (
    <div className="gg-bracket gg-bracket--phone">
      {head}
      {champion}
      {!inLiveGame && !finished && signingUp && !seated && onSignUp ? (
        <JoinCard
          tournament={t}
          spotsLeft={spotsLeft}
          onSignUp={onSignUp}
          onPickMe={onPickMe}
          search={searchCommanders}
        />
      ) : (
        !finished &&
        !inLiveGame && (
          <MyCommander
            tournament={t}
            me={me}
            meEntrant={meEntrant}
            onPickMe={onPickMe}
            onSave={onSaveCommander}
            search={searchCommanders}
            waitingFor={signingUp ? spotsLeft : null}
          />
        )
      )}
      {myLiveGame && meEntrant && onChangeLife && onLost ? (
        (() => {
          const side = myLiveGame.a === meEntrant.id ? "a" : "b";
          const opp = byId.get(side === "a" ? (myLiveGame.b as string) : myLiveGame.a);
          const oppLabel = opp ? entrantLabel(opp) : "your opponent";
          return (
            <LifeCounter
              key={myLiveGame.id}
              life={lifeOf(myLiveGame, side, t.startingLife)}
              startingLife={t.startingLife}
              title={`Table ${myLiveGame.table} · vs ${oppLabel}`}
              elapsed={gameDuration(myLiveGame, now)}
              others={[
                { key: opp?.id ?? "opponent", label: oppLabel, life: lifeOf(myLiveGame, side === "a" ? "b" : "a", t.startingLife), out: null },
              ]}
              team={t.format === "2hg"}
              outcome={`the game is recorded as a win for ${oppLabel} and its clock stops`}
              onChange={(delta) => onChangeLife(myLiveGame.id, side, delta)}
              onLost={() => onLost(myLiveGame.id, side)}
            />
          );
        })()
      ) : myLiveSeat && onChangePodLife && onPodOut ? (
        (() => {
          const { pod, player } = myLiveSeat;
          const left = stillIn(pod);
          const rest = left.filter((p) => p.id !== player.id);
          const last = rest.length === 1 ? byId.get(rest[0].entrantId) : undefined;
          return (
            <LifeCounter
              key={player.id}
              life={podLife(player, t.startingLife)}
              startingLife={t.startingLife}
              title={`Table ${pod.table} · ${pod.players.length}-player game`}
              elapsed={gameDuration(pod, now)}
              others={pod.players
                .filter((p) => p.id !== player.id)
                .map((p) => ({
                  key: p.id,
                  label: byId.get(p.entrantId) ? entrantLabel(byId.get(p.entrantId)!) : "Player",
                  life: podLife(p, t.startingLife),
                  out: p.outAt && p.place != null ? ordinal(p.place) : null,
                }))}
              team={false}
              outcome={
                last
                  ? `you finish 2nd of ${pod.players.length} and ${entrantLabel(last)} wins the game`
                  : `you're out and finish ${ordinal(left.length)} of ${pod.players.length}`
              }
              onChange={(delta) => onChangePodLife(player.id, delta)}
              onLost={() => onPodOut(player.id)}
            />
          );
        })()
      ) : ffa ? (
        mySeat && <MyPodTable pod={mySeat.pod} player={mySeat.player} />
      ) : (
        myMatch && meEntrant && <MyTable match={myMatch} me={meEntrant} byId={byId} />
      )}
      {signingUp ? lobbySection : roundSection}
      {standingsSection}
      {roundsSection}
      {footer}
    </div>
  );
}

function MatchCard({
  match,
  byId,
  mine,
  startingLife,
  now,
}: {
  match: TournamentMatch;
  byId: Map<string, TournamentEntrant>;
  mine: boolean;
  startingLife: number;
  now: number;
}) {
  const a = byId.get(match.a);
  if (!a) return null;
  if (match.b == null) {
    return (
      <li className={`gg-bmatch gg-bmatch--bye ${mine ? "is-mine" : ""}`}>
        <span className="gg-bmatch__table">Bye</span>
        <Side entrant={a} state="bye" />
      </li>
    );
  }
  const b = byId.get(match.b);
  if (!b) return null;
  const stateOf = (side: "a" | "b") =>
    match.result === "pending"
      ? "playing"
      : match.result === "draw"
        ? "draw"
        : match.result === side
          ? "won"
          : "lost";
  const elapsed = gameDuration(match, now);
  const done = match.result !== "pending";
  return (
    <li className={`gg-bmatch ${done ? "is-done" : ""} ${mine ? "is-mine" : ""}`}>
      <span className="gg-bmatch__table">
        <span>Table {match.table}</span>
        {elapsed != null && (
          <span className={`gg-bmatch__clock ${done ? "is-done" : ""}`}>
            <Icon name="clock" size={12} />
            {done ? `Game over · ${formatDuration(elapsed)}` : formatDuration(elapsed)}
          </span>
        )}
      </span>
      <Side entrant={a} state={stateOf("a")} life={lifeOf(match, "a", startingLife)} startingLife={startingLife} />
      <span className="gg-bmatch__vs" aria-hidden="true">
        vs
      </span>
      <Side entrant={b} state={stateOf("b")} life={lifeOf(match, "b", startingLife)} startingLife={startingLife} />
    </li>
  );
}

function Side({
  entrant,
  state,
  life,
  startingLife,
}: {
  entrant: TournamentEntrant;
  state: "playing" | "won" | "lost" | "draw" | "bye";
  /** Life in this game (not for a bye). */
  life?: number;
  startingLife?: number;
}) {
  const cmd = commanderSummary(entrant);
  const low = life != null && startingLife != null && life <= Math.ceil(startingLife / 4);
  return (
    <div className={`gg-bside gg-bside--${state}`}>
      <CommanderCards entrant={entrant} size="md" />
      <div className="gg-bside__text">
        {state === "won" && (
          <span className="gg-bside__tag">
            <Icon name="check" size={13} /> Won
          </span>
        )}
        {state === "draw" && <span className="gg-bside__tag gg-bside__tag--draw">Draw</span>}
        {state === "bye" && <span className="gg-bside__tag gg-bside__tag--bye">Free win</span>}
        <strong>{entrantLabel(entrant)}</strong>
        {cmd && <span className="gg-bside__cmd">{cmd}</span>}
      </div>
      {life != null && (
        <span
          className={`gg-bside__life ${low ? "is-low" : ""} ${life <= 0 ? "is-out" : ""}`}
          aria-label={`${life} life`}
        >
          {life}
        </span>
      )}
    </div>
  );
}

function Standings({ rows, started, myId }: { rows: StandingRow[]; started: boolean; myId: string | null }) {
  return (
    <table className="gg-bstand">
      <caption className="gg-visually-hidden">Standings: rank, record and points</caption>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Player</th>
          <th scope="col">
            <abbr title="Wins-losses-draws">W-L-D</abbr>
          </th>
          <th scope="col">
            <abbr title="Points: 3 for a win, 1 for a draw">Pts</abbr>
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
              <td className="gg-bstand__num">
                {r.wins}-{r.losses}-{r.draws}
              </td>
              <td className="gg-bstand__num gg-bstand__pts">{r.points}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RoundColumn({
  round,
  matches,
  byId,
  current,
  myId,
}: {
  round: number;
  matches: TournamentMatch[];
  byId: Map<string, TournamentEntrant>;
  current: boolean;
  myId: string | null;
}) {
  const done = matches.every((m) => m.result !== "pending");
  return (
    <div className={`gg-bcol ${current ? "is-current" : ""}`}>
      <h3>
        Round {round}
        {done ? <Icon name="check" size={14} /> : <span className="gg-bcol__live">Live</span>}
      </h3>
      <ol>
        {matches.map((m) => {
          const a = byId.get(m.a);
          const b = m.b ? byId.get(m.b) : null;
          const line = (e: TournamentEntrant | null | undefined, side: "a" | "b") => {
            if (!e) return null;
            const won = m.result === side;
            const lost = (m.result === "a" || m.result === "b") && !won;
            return (
              <span className={`gg-bmini__line ${won ? "is-won" : ""} ${lost ? "is-lost" : ""} ${myId === e.id ? "is-mine" : ""}`}>
                <span>{entrantLabel(e)}</span>
                {won && <Icon name="check" size={13} />}
              </span>
            );
          };
          return (
            <li key={m.id} className="gg-bmini">
              {line(a, "a")}
              {m.b == null ? (
                <span className="gg-bmini__note">Bye</span>
              ) : (
                <>
                  {line(b, "b")}
                  {m.result === "draw" && <span className="gg-bmini__note">Draw</span>}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function MyTable({ match, me, byId }: { match: TournamentMatch; me: TournamentEntrant; byId: Map<string, TournamentEntrant> }) {
  if (match.b == null) {
    return (
      <div className="gg-bracket__mytable" role="status">
        <Icon name="info" size={18} />
        <span>
          <strong>You have a bye this round</strong> — it counts as a win.
        </span>
      </div>
    );
  }
  const opponentId = match.a === me.id ? match.b : match.a;
  const opponent = byId.get(opponentId);
  const result =
    match.result === "pending"
      ? null
      : match.result === "draw"
        ? "Draw"
        : (match.result === "a") === (match.a === me.id)
          ? "You won"
          : "You lost";
  return (
    <div className="gg-bracket__mytable" role="status">
      <span className="gg-bracket__mytable-num">
        <small>Table</small>
        {match.table}
      </span>
      <span>
        <strong>vs {opponent ? entrantLabel(opponent) : "Unknown"}</strong>
        {opponent && commanderSummary(opponent) && <small>{commanderSummary(opponent)}</small>}
      </span>
      {result && <span className="gg-bracket__mytable-result">{result}</span>}
    </div>
  );
}

/** "Who are you?": every player still in, for someone who already has a spot. */
function SeatPicker({ tournament, onPickMe }: { tournament: TournamentDetail; onPickMe: (seat: PlayerSeat | null) => void }) {
  const seats = activeEntrants(tournament).flatMap((e) =>
    e.players.map((player, seat) => ({
      key: seatKey({ entrantId: e.id, seat }),
      label: e.players.length === 2 ? `${player} (with ${e.players[1 - seat]})` : player,
    })),
  );
  return (
    <SelectField
      label="Who are you?"
      value=""
      onChange={(e) => {
        const picked = e.target.value ? parseSeatKey(e.target.value) : null;
        if (picked) onPickMe(picked);
      }}
    >
      <option value="">Pick your name…</option>
      {seats.map((s) => (
        <option key={s.key} value={s.key}>
          {s.label}
        </option>
      ))}
    </SelectField>
  );
}

function MyCommander({
  tournament,
  me,
  meEntrant,
  onPickMe,
  onSave,
  search,
  waitingFor,
}: {
  tournament: TournamentDetail;
  me: PlayerSeat | null;
  meEntrant: TournamentEntrant | null;
  onPickMe: (seat: PlayerSeat | null) => void;
  onSave: (seat: PlayerSeat, commander: TournamentCommander | null) => Promise<boolean>;
  search: (query: string) => Promise<CommanderOption[]>;
  /** Open spots left while signing up (null once the tournament has started). */
  waitingFor: number | null;
}) {
  const seated = me && meEntrant && me.seat < meEntrant.players.length ? me : null;

  return (
    <section className="gg-card gg-bracket__mine" aria-labelledby="bracket-mine">
      <h2 id="bracket-mine">{seated && waitingFor != null ? "You're in!" : "Your commander"}</h2>
      {!seated || !meEntrant ? (
        <>
          <p className="gg-muted">Find your name, then add the commander you're playing (optional).</p>
          <SeatPicker tournament={tournament} onPickMe={onPickMe} />
        </>
      ) : (
        <>
          {waitingFor != null && (
            <p className="gg-bracket__waiting">
              {waitingFor > 0
                ? `Waiting for ${waitingFor} more ${waitingFor === 1 ? "player" : "players"}. Round 1 starts when every spot is filled. Keep this page open: your table will show up here.`
                : "Every spot is filled. Round 1 is about to start."}
            </p>
          )}
          <CommanderForm
            key={seatKey(seated)}
            seat={seated}
            entrant={meEntrant}
            onSave={onSave}
            onSwitch={() => onPickMe(null)}
            search={search}
          />
        </>
      )}
    </section>
  );
}

/** Sign-ups: take a spot with your name, commander and (Two-Headed Giant) maybe a teammate. */
function JoinCard({
  tournament,
  spotsLeft,
  onSignUp,
  onPickMe,
  search,
}: {
  tournament: TournamentDetail;
  spotsLeft: number;
  onSignUp: (input: SignUpInput) => Promise<boolean>;
  onPickMe: (seat: PlayerSeat | null) => void;
  search: (query: string) => Promise<CommanderOption[]>;
}) {
  const [finding, setFinding] = useState(false);
  const [name, setName] = useState("");
  const [commander, setCommander] = useState<TournamentCommander | null>(null);
  const [teamWith, setTeamWith] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const solos = soloEntrants(tournament);
  const full = spotsLeft <= 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = cleanPlayerName(name);
    if (!clean) {
      setError("Enter your name.");
      return;
    }
    setError(null);
    setBusy(true);
    const ok = await onSignUp({ name: clean, commander, teamWith: teamWith || null });
    setBusy(false);
    if (ok) {
      setName("");
      setCommander(null);
      setTeamWith("");
    }
  }

  return (
    <section className="gg-card gg-bracket__mine gg-bracket__joincard" aria-labelledby="bracket-join">
      <h2 id="bracket-join">{finding ? "Find your name" : full ? "Every spot is taken" : "Join the tournament"}</h2>
      {finding ? (
        <SeatPicker tournament={tournament} onPickMe={onPickMe} />
      ) : full ? (
        <p className="gg-muted">All the spots are filled. Ask the store if you'd like to play.</p>
      ) : (
        <form className="gg-bracket__joinform" onSubmit={submit} noValidate>
          <p className="gg-muted">
            {spotsLeft} {spotsLeft === 1 ? "spot" : "spots"} left. Round 1 starts when every spot is filled.
          </p>
          <TextField
            label="Your name"
            value={name}
            maxLength={MAX_PLAYER_NAME}
            autoComplete="given-name"
            autoCapitalize="words"
            required
            error={error ?? undefined}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
          <CommanderPicker label="Commander (optional)" value={commander} onChange={setCommander} search={search} />
          {tournament.format === "2hg" && (
            <SelectField
              label="Teammate"
              hint="Two-Headed Giant is played in teams of two."
              value={teamWith}
              onChange={(e) => setTeamWith(e.target.value)}
            >
              <option value="">Give me a random teammate</option>
              {solos.map((e) => (
                <option key={e.id} value={e.id}>
                  Team up with {e.players[0]}
                </option>
              ))}
            </SelectField>
          )}
          <Button type="submit" variant="primary" icon="trophy" loading={busy} className="gg-bracket__joinbtn">
            Join the tournament
          </Button>
        </form>
      )}
      <button type="button" className="gg-link-btn gg-bracket__findlink" onClick={() => setFinding((f) => !f)}>
        {finding ? "Back to sign-up" : "Already signed up? Find your name"}
      </button>
    </section>
  );
}

function CommanderForm({
  seat,
  entrant,
  onSave,
  onSwitch,
  search,
}: {
  seat: PlayerSeat;
  entrant: TournamentEntrant;
  onSave: (seat: PlayerSeat, commander: TournamentCommander | null) => Promise<boolean>;
  onSwitch: () => void;
  search: (query: string) => Promise<CommanderOption[]>;
}) {
  const saved = entrant.commanders[seat.seat] ?? null;
  const [draft, setDraft] = useState<TournamentCommander | null>(saved);
  const [busy, setBusy] = useState(false);
  const changed = (draft?.name ?? "") !== (saved?.name ?? "") || (draft?.cardId ?? null) !== (saved?.cardId ?? null);

  return (
    <form
      className="gg-bracket__cmdform"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSave(seat, draft);
        setBusy(false);
      }}
    >
      <p className="gg-bracket__playing-as">
        Playing as <strong>{entrant.players[seat.seat]}</strong>
        <button type="button" className="gg-link-btn" onClick={onSwitch}>
          Not you?
        </button>
      </p>
      <CommanderPicker label="Commander" value={draft} onChange={setDraft} search={search} />
      <div className="gg-btn-row">
        <Button type="submit" variant="primary" loading={busy} disabled={!changed}>
          {saved && !draft ? "Remove commander" : "Save commander"}
        </Button>
        {saved && !changed && (
          <span className="gg-bracket__saved">
            <Icon name="checkCircle" size={16} /> Saved
          </span>
        )}
      </div>
    </form>
  );
}
