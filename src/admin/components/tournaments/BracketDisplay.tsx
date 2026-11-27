import { useMemo, useState } from "react";
import { Button } from "../ui/Button";
import { SelectField } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { QrCode } from "../partners/QrCode";
import { CommanderPicker, type CommanderOption } from "./CommanderPicker";
import {
  activeEntrants,
  commanderImageUrl,
  commanderSummary,
  computeStandings,
  entrantLabel,
  formatInfo,
  matchesInRound,
  parseSeatKey,
  seatKey,
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

function statusLine(t: TournamentDetail, pending: number, pairs: number, entrants: number): string {
  const info = formatInfo(t.format);
  if (t.status === "finished") return "Final standings";
  if (t.currentRound === 0) return `Starting soon · ${entrants} ${entrants === 1 ? info.noun : info.nounPlural}`;
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
  searchCommanders,
  updatedAt,
  onFullscreen,
  tvUrl,
}: {
  tournament: TournamentDetail;
  tv: boolean;
  /** The phone link, for the QR code on the TV. */
  shareUrl: string | null;
  logoSrc: string;
  me: PlayerSeat | null;
  onPickMe: (seat: PlayerSeat | null) => void;
  onSaveCommander: (seat: PlayerSeat, commander: TournamentCommander | null) => Promise<boolean>;
  searchCommanders: (query: string) => Promise<CommanderOption[]>;
  updatedAt: Date | null;
  onFullscreen?: () => void;
  /** Link to the TV layout, offered on phones. */
  tvUrl?: string;
}) {
  const t = tournament;
  const info = formatInfo(t.format);
  const derived = useMemo(() => {
    const byId = new Map(t.entrants.map((e) => [e.id, e]));
    const standings = computeStandings(t.entrants, t.matches);
    const current = matchesInRound(t.matches, t.currentRound);
    const pairs = current.filter((m) => m.b != null).length;
    const pending = current.filter((m) => m.result === "pending").length;
    const rounds = Array.from({ length: t.currentRound }, (_, i) => i + 1);
    return { byId, standings, current, pairs, pending, rounds };
  }, [t]);
  const { byId, standings, current, pairs, pending, rounds } = derived;
  const active = activeEntrants(t);
  const finished = t.status === "finished";
  const leaders = finished ? standings.filter((r) => r.rank === 1 && r.points > 0) : [];
  const meEntrant = me ? byId.get(me.entrantId) ?? null : null;
  const myMatch =
    meEntrant && !finished ? current.find((m) => m.a === meEntrant.id || m.b === meEntrant.id) ?? null : null;

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
      {tv && shareUrl && t.status === "active" && (
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
      <h2 id="bracket-now">{t.currentRound === 0 ? "Who's playing" : finished ? `Round ${t.currentRound}` : `Now playing · Round ${t.currentRound}`}</h2>
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
      ) : (
        <ul className="gg-bracket__matches">
          {current.map((m) => (
            <MatchCard key={m.id} match={m} byId={byId} mine={myMatch?.id === m.id} />
          ))}
        </ul>
      )}
    </section>
  );

  // Before round 1 the standings would only repeat "who's playing" with zeros.
  const standingsSection = t.currentRound > 0 && (
    <section className="gg-bracket__section gg-bracket__standings" aria-labelledby="bracket-standings">
      <h2 id="bracket-standings">Standings</h2>
      <Standings rows={standings} started={t.currentRound > 0} myId={meEntrant?.id ?? null} />
    </section>
  );

  const roundsSection = rounds.length > 0 && (
    <section className="gg-bracket__section gg-bracket__rounds" aria-labelledby="bracket-rounds">
      <h2 id="bracket-rounds">Rounds</h2>
      <div className="gg-bracket__cols">
        {rounds.map((round) => (
          <RoundColumn
            key={round}
            round={round}
            matches={matchesInRound(t.matches, round)}
            byId={byId}
            current={round === t.currentRound && !finished}
            myId={meEntrant?.id ?? null}
          />
        ))}
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
      {!finished && (
        <MyCommander
          tournament={t}
          me={me}
          meEntrant={meEntrant}
          onPickMe={onPickMe}
          onSave={onSaveCommander}
          search={searchCommanders}
        />
      )}
      {myMatch && meEntrant && <MyTable match={myMatch} me={meEntrant} byId={byId} />}
      {roundSection}
      {standingsSection}
      {roundsSection}
      {footer}
    </div>
  );
}

/** Small card images for each commander picked from the search (nothing for typed-only names). */
function CommanderCards({ entrant, size }: { entrant: TournamentEntrant; size: "sm" | "md" | "lg" }) {
  const cards = entrant.commanders.filter((c): c is TournamentCommander & { cardId: string } => Boolean(c?.cardId));
  if (cards.length === 0) {
    return (
      <span className={`gg-bcards gg-bcards--${size} gg-bcards--empty`} aria-hidden="true">
        {entrantLabel(entrant)
          .split(/\s*&\s*/)
          .map((n) => n.slice(0, 1).toUpperCase())
          .join("")}
      </span>
    );
  }
  return (
    <span className={`gg-bcards gg-bcards--${size}`}>
      {cards.map((c) => (
        <img
          key={c.cardId}
          src={commanderImageUrl(c.cardId, size === "lg" ? "normal" : "small")}
          alt={c.name}
          title={c.name}
          loading="lazy"
        />
      ))}
    </span>
  );
}

function MatchCard({ match, byId, mine }: { match: TournamentMatch; byId: Map<string, TournamentEntrant>; mine: boolean }) {
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
  return (
    <li className={`gg-bmatch ${match.result !== "pending" ? "is-done" : ""} ${mine ? "is-mine" : ""}`}>
      <span className="gg-bmatch__table">Table {match.table}</span>
      <Side entrant={a} state={stateOf("a")} />
      <span className="gg-bmatch__vs" aria-hidden="true">
        vs
      </span>
      <Side entrant={b} state={stateOf("b")} />
    </li>
  );
}

function Side({ entrant, state }: { entrant: TournamentEntrant; state: "playing" | "won" | "lost" | "draw" | "bye" }) {
  const cmd = commanderSummary(entrant);
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

function MyCommander({
  tournament,
  me,
  meEntrant,
  onPickMe,
  onSave,
  search,
}: {
  tournament: TournamentDetail;
  me: PlayerSeat | null;
  meEntrant: TournamentEntrant | null;
  onPickMe: (seat: PlayerSeat | null) => void;
  onSave: (seat: PlayerSeat, commander: TournamentCommander | null) => Promise<boolean>;
  search: (query: string) => Promise<CommanderOption[]>;
}) {
  const seats = activeEntrants(tournament).flatMap((e) =>
    e.players.map((player, seat) => ({
      key: seatKey({ entrantId: e.id, seat }),
      label: e.players.length === 2 ? `${player} (with ${e.players[1 - seat]})` : player,
    })),
  );
  const seated = me && meEntrant && me.seat < meEntrant.players.length ? me : null;

  return (
    <section className="gg-card gg-bracket__mine" aria-labelledby="bracket-mine">
      <h2 id="bracket-mine">Your commander</h2>
      {!seated || !meEntrant ? (
        <>
          <p className="gg-muted">Find your name, then add the commander you're playing (optional).</p>
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
        </>
      ) : (
        <CommanderForm
          key={seatKey(seated)}
          seat={seated}
          entrant={meEntrant}
          onSave={onSave}
          onSwitch={() => onPickMe(null)}
          search={search}
        />
      )}
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
