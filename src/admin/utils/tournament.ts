// Tournaments (admin → Tournaments): casual 1v1, Two-Headed Giant and
// free-for-all (big multiplayer Commander games) events.
//
// Shared by the admin page (src/admin/pages/TournamentsPage.tsx) and the API
// (/api/admin/tournaments). Pure module — no browser or Node APIs — so the
// server pairs rounds with exactly the rules the page shows, and the page
// works out standings from the same rows the server stores.
//
// How a tournament runs:
//   • Entrants are players (1v1) or fixed teams of two (Two-Headed Giant).
//   • Each round pairs every entrant still in at random with someone they
//     haven't played yet. An odd count gives one bye, to whoever has had the
//     fewest byes. If no full pairing without a rematch exists, as many
//     entrants as possible are paired and the rest get byes; when nobody has
//     a new opponent left, there is no next round.
//   • A win is 3 points, a draw 1, a loss 0. A bye counts as a win.
//   • Ties in points are broken by opponents' match-win percentage (each
//     opponent counted at no less than 33%), as in Magic tournaments.
//
// Free-for-all works differently (see "free-for-all" below): each round deals
// everyone still in onto tables of up to `tableSize` players, mixing up who
// sits with whom; players go out one by one, and points go by finishing
// place (1st of 8 = 8 points … 8th = 1).

export const TOURNAMENT_FORMATS = [
  { value: "1v1", label: "1v1", teamSize: 1, noun: "player", nounPlural: "players", blurb: "One player against one player" },
  {
    value: "2hg",
    label: "Two-Headed Giant",
    teamSize: 2,
    noun: "team",
    nounPlural: "teams",
    blurb: "Teams of two share a life total",
  },
  {
    value: "ffa",
    label: "Free-for-all",
    teamSize: 1,
    noun: "player",
    nounPlural: "players",
    blurb: "Big casual games: everyone at a table plays everyone",
  },
] as const;

export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number]["value"];
export type TournamentStatus = "active" | "finished";
/** Who won: side a, side b, a draw, still playing, or a bye (no side b). */
export type MatchResult = "pending" | "a" | "b" | "draw" | "bye";
/** What staff can record for a match (pending clears it). */
export type ReportableResult = Exclude<MatchResult, "bye">;

export const MAX_TOURNAMENT_NAME = 80;
export const MAX_PLAYER_NAME = 40;
export const MAX_COMMANDER_NAME = 120;
/** Life at the start of a game, by format: Commander 40; Two-Headed Giant Commander, 60 per team. */
export const DEFAULT_STARTING_LIFE: Record<TournamentFormat, number> = { "1v1": 40, "2hg": 60, ffa: 40 };
/** Free-for-all: the most players at one table. 8 with 8 players = one big game; 4 = pods of four. */
export const MIN_TABLE_SIZE = 3;
export const MAX_TABLE_SIZE = 12;
export const DEFAULT_TABLE_SIZE = 4;
export const MAX_STARTING_LIFE = 999;
/** The most one life change may add or take away. */
export const MAX_LIFE_CHANGE = 999;
/** The player display: /tournament?t=<share token> (add &view=tv for a big screen). */
import { TOURNAMENT_PATH } from "../../store/lib/tournamentPath.js";
export { TOURNAMENT_PATH };
/** Entrants per tournament (players for 1v1, teams for Two-Headed Giant). */
export const MAX_ENTRANTS = 64;
/** Player spots for sign-ups (players, not teams). Two-Headed Giant needs an even number, at least 4. */
export const MIN_SPOTS = 2;
export const MAX_SPOTS = 64;
/** Tournaments the list returns (newest first). */
export const TOURNAMENT_LIST_LIMIT = 50;

/** The commander a player is on: the name as entered, and the Scryfall card picked (for its art). */
export interface TournamentCommander {
  name: string;
  cardId: string | null;
}

export interface TournamentEntrant {
  id: string;
  /** One name for 1v1, two for a Two-Headed Giant team. */
  players: string[];
  /** Lined up with players; null where a player hasn't said. */
  commanders: (TournamentCommander | null)[];
  droppedAt: string | null;
  createdAt: string;
  /** The round they've said they're ready to start (ready-up between rounds). */
  readyFor?: number | null;
}

/** Poison counters and commander damage (by source, see commanderSources()) for one side or player in a game. */
export interface GameCounters {
  poison: number;
  commander: Record<string, number>;
}

export interface TournamentMatch {
  id: string;
  round: number;
  table: number;
  a: string;
  /** null = a bye for a. */
  b: string | null;
  result: MatchResult;
  reportedAt: string | null;
  /** Life now for each side while the game is played (null = the starting life). */
  lifeA: number | null;
  lifeB: number | null;
  /** When the round was paired: the game clock starts here. */
  startedAt: string;
  /** When the result was first recorded (null while playing). */
  endedAt: string | null;
  /** How the losing side lost, when a player recorded it. */
  lossReason?: LossReason | null;
  /** Poison and commander damage each side has taken (this round's games). */
  countersA?: GameCounters;
  countersB?: GameCounters;
}

/** A player at a free-for-all table. */
export interface TournamentPodPlayer {
  /** This seat's id (the phone sends it to change life or go out). */
  id: string;
  entrantId: string;
  /** 1, 2, 3… around the table. */
  seat: number;
  /** Life now (null = the starting life). */
  life: number | null;
  /** When they went out (null while still in). */
  outAt: string | null;
  /** Where they finished (1 = won); null while still in. */
  place: number | null;
  /** How they went out, when a player recorded it. */
  outReason?: LossReason | null;
  /** Poison and commander damage they've taken (this round's games). */
  counters?: GameCounters;
}

/** One free-for-all table's game in a round. */
export interface TournamentPod {
  id: string;
  round: number;
  table: number;
  /** When the round was dealt: the game clock starts here. */
  startedAt: string;
  /** When the game was decided (null while it's played). */
  endedAt: string | null;
  /** In seat order. */
  players: TournamentPodPlayer[];
}

export interface TournamentSummary {
  id: string;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  currentRound: number;
  entrantCount: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface TournamentDetail {
  id: string;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  currentRound: number;
  createdAt: string;
  finishedAt: string | null;
  entrants: TournamentEntrant[];
  matches: TournamentMatch[];
  /** The player display link. Staff only: the public view never includes it. */
  share?: { token: string; enabled: boolean };
  /** Player spots players fill by signing up on the player display; null = staff enter everyone. */
  spots: number | null;
  /** Life at the start of each game (per player in 1v1 and free-for-all, per team in Two-Headed Giant). */
  startingLife: number;
  /** Free-for-all: the most players at one table (null for the other formats). */
  tableSize: number | null;
  /** Free-for-all: every table of every round (empty for the other formats). */
  pods: TournamentPod[];
  /** The server's clock when this was sent, so game timers don't depend on the device's clock. */
  serverTime?: string;
}

export function isTournamentFormat(value: unknown): value is TournamentFormat {
  return TOURNAMENT_FORMATS.some((f) => f.value === value);
}

export function formatInfo(format: TournamentFormat) {
  return TOURNAMENT_FORMATS.find((f) => f.value === format) ?? TOURNAMENT_FORMATS[0];
}

export function isReportableResult(value: unknown): value is ReportableResult {
  return value === "a" || value === "b" || value === "draw" || value === "pending";
}

/** A side's life in a game: what's been tracked, or the starting life. */
export function lifeOf(match: Pick<TournamentMatch, "lifeA" | "lifeB">, side: "a" | "b", startingLife: number): number {
  const life = side === "a" ? match.lifeA : match.lifeB;
  return life ?? startingLife;
}

/** "4:05", "41:23" or "1:02:09". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/**
 * How long a game has run: from when the round was paired (or dealt) to when
 * it was decided, or to `now` while it's being played. Null for a bye.
 */
export function gameDuration(
  game: Pick<TournamentMatch, "startedAt" | "endedAt"> & { b?: string | null },
  now: number,
): number | null {
  if (game.b === null || !game.startedAt) return null;
  const start = new Date(game.startedAt).getTime();
  const end = game.endedAt ? new Date(game.endedAt).getTime() : now;
  return Math.max(0, end - start);
}

/** Why a players-per-table number won't do, or null. */
export function tableSizeProblem(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_TABLE_SIZE || value > MAX_TABLE_SIZE) {
    return `Players per table is a whole number from ${MIN_TABLE_SIZE} to ${MAX_TABLE_SIZE}.`;
  }
  return null;
}

/** The fewest players a format can start with. */
export function minPlayers(format: TournamentFormat): number {
  return format === "2hg" ? 4 : format === "ffa" ? 3 : 2;
}

/** Why a starting life won't do, or null. */
export function startingLifeProblem(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_STARTING_LIFE) {
    return `Starting life is a whole number from 1 to ${MAX_STARTING_LIFE}.`;
  }
  return null;
}

/** "Alex" for a player, "Alex & Sam" for a team. */
export function entrantLabel(entrant: Pick<TournamentEntrant, "players">): string {
  return entrant.players.join(" & ");
}

// ───────────────────────────── names ─────────────────────────────

/** Trim, collapse spaces, drop control characters, cap the length. */
export function cleanPlayerName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return (
    raw
      // oxlint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_PLAYER_NAME)
      .trim()
  );
}

export function cleanTournamentName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return (
    raw
      // oxlint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TOURNAMENT_NAME)
      .trim()
  );
}

export function cleanCommanderName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return (
    raw
      // oxlint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_COMMANDER_NAME)
      .trim()
  );
}

const CARD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCardId(value: unknown): value is string {
  return typeof value === "string" && CARD_ID_RE.test(value);
}

/**
 * Scryfall's card image for a card id (front face). The whole card, not the
 * art crop: Scryfall asks that an art crop carry the artist and copyright
 * nearby, which the full card already shows.
 */
export function commanderImageUrl(cardId: string, size: "small" | "normal" = "small"): string {
  const id = cardId.toLowerCase();
  return `https://cards.scryfall.io/${size}/front/${id[0]}/${id[1]}/${id}.jpg`;
}

/** "Atraxa, Praetors' Voice" or "Alex: Atraxa · Sam: Kenrith" for a team, or "" when nobody has said. */
export function commanderSummary(entrant: Pick<TournamentEntrant, "players" | "commanders">): string {
  const named = entrant.players
    .map((player, i) => ({ player, commander: entrant.commanders[i] }))
    .filter((p) => p.commander);
  if (named.length === 0) return "";
  if (entrant.players.length === 1) return named[0].commander!.name;
  return named.map((p) => `${p.player}: ${p.commander!.name}`).join(" · ");
}

/** Which player a phone belongs to on the player display: an entrant and a seat (0, or 1 on a team). */
export interface PlayerSeat {
  entrantId: string;
  seat: number;
}

export function seatKey(seat: PlayerSeat): string {
  return `${seat.entrantId}:${seat.seat}`;
}

export function parseSeatKey(key: string | null): PlayerSeat | null {
  const m = key?.match(/^([0-9a-f-]{36}):([01])$/i);
  return m ? { entrantId: m[1], seat: Number(m[2]) } : null;
}

/** The player display link for a share token. */
export function tournamentShareUrl(origin: string, token: string, tv = false): string {
  return `${origin}${TOURNAMENT_PATH}?t=${encodeURIComponent(token)}${tv ? "&view=tv" : ""}`;
}

/**
 * Scryfall search terms for "commanders whose name has these words": letters,
 * digits and a few name characters only, so typing can't change the query.
 */
export function commanderSearchQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const words = raw
    .replace(/[^\p{L}\p{M}\p{N}' -]+/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-']+|[-']+$/g, ""))
    // Scryfall reads a bare "or" / "and" as an operator.
    .filter((w) => w && !/^(or|and)$/i.test(w))
    .slice(0, 6);
  if (words.join("").length < 2) return null;
  return `is:commander game:paper ${words.join(" ")}`;
}

/** One player per line (commas and semicolons also separate names). */
export function parsePlayerList(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map(cleanPlayerName)
    .filter(Boolean);
}

const TEAM_SEPARATOR = /\s*(?:&|\+|\/|,|;)\s*|\s+and\s+/i;

/**
 * One team per line, the two names joined by &, +, /, a comma or "and":
 * "Alex & Sam". Lines that aren't exactly two names come back as problems.
 */
export function parseTeamList(text: string): { teams: string[][]; problems: string[] } {
  const teams: string[][] = [];
  const problems: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const names = line.split(TEAM_SEPARATOR).map(cleanPlayerName).filter(Boolean);
    if (names.length === 2) teams.push(names);
    else problems.push(line.trim());
  }
  return { teams, problems };
}

/** Random teams of two from a list of names (an odd last name is left out). */
export function randomTeams(names: string[], random: () => number = Math.random): string[][] {
  const order = shuffle(names, random);
  const teams: string[][] = [];
  for (let i = 0; i + 1 < order.length; i += 2) teams.push([order[i], order[i + 1]]);
  return teams;
}

/**
 * Why an entrant can't be entered as typed, or null when it's fine: the right
 * number of names for the format, each with something in it, and a team's
 * two players different people.
 */
export function entrantProblem(format: TournamentFormat, players: string[], allowSolo = false): string | null {
  const size = formatInfo(format).teamSize;
  // Before a sign-up tournament starts, a Two-Headed Giant player may be waiting for a teammate.
  if (allowSolo && size === 2 && players.length === 1 && players[0]) return null;
  if (players.length !== size || players.some((p) => !p)) {
    return size === 2 ? "A Two-Headed Giant team needs two player names." : "Enter the player's name.";
  }
  if (size === 2 && players[0].toLowerCase() === players[1].toLowerCase()) {
    return "A team needs two different players.";
  }
  return null;
}

/** The first name (as typed) that appears more than once across the lists, ignoring case. */
export function duplicateName(lists: string[][]): string | null {
  const seen = new Set<string>();
  for (const players of lists) {
    for (const name of players) {
      const key = name.toLowerCase();
      if (seen.has(key)) return name;
      seen.add(key);
    }
  }
  return null;
}

// ──────────────────────────── pairing ────────────────────────────

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface RoundPairing {
  /** Each pair plays a match. */
  pairs: [string, string][];
  /** Entrants who sit this round out and get the win. */
  byes: string[];
}

/** Search steps before giving up on a full pairing and pairing as many as possible. */
const SEARCH_BUDGET = 40_000;
/** Search steps spent checking that a pairing doesn't paint later rounds into a corner. */
const LOOKAHEAD_BUDGET = 60_000;

/** Who has played whom, and how many byes each has had (by index). */
interface PairingGraph {
  n: number;
  played: boolean[][];
  byes: number[];
}

interface Found {
  pairs: [number, number][];
  byes: number[];
}

/**
 * Pairs a round: every id plays someone it hasn't played in `history`, chosen
 * at random. Odd counts give one bye, to whoever has had the fewest byes so
 * far (ties at random). Among the possible pairings it prefers one that still
 * leaves the next rounds pairable the same way, so playing on toward a full
 * round robin doesn't hit a dead end. If no rematch-free pairing covers
 * everyone, as many as possible are paired and the rest get byes. Returns
 * null when nobody has a new opponent left (or there are fewer than two ids).
 */
export function pairRound(
  ids: readonly string[],
  history: readonly Pick<TournamentMatch, "a" | "b">[],
  random: () => number = Math.random,
): RoundPairing | null {
  const order = [...new Set(ids)];
  const n = order.length;
  if (n < 2) return null;

  const index = new Map(order.map((id, i) => [id, i]));
  const graph: PairingGraph = { n, played: order.map(() => order.map(() => false)), byes: order.map(() => 0) };
  for (const m of history) {
    const ia = index.get(m.a);
    if (ia === undefined) continue;
    if (m.b == null) {
      graph.byes[ia] += 1;
      continue;
    }
    const ib = index.get(m.b);
    if (ib === undefined) continue;
    graph.played[ia][ib] = true;
    graph.played[ib][ia] = true;
  }
  // Nobody has a new opponent: the round robin is done.
  if (!hasOpenPair(graph)) return null;

  const toIds = (found: Found): RoundPairing => ({
    pairs: found.pairs.map(([x, y]) => [order[x], order[y]]),
    byes: found.byes.map((x) => order[x]),
  });
  const everyone = order.map((_, i) => i);
  const budget = { left: SEARCH_BUDGET };
  const lookBudget = { left: LOOKAHEAD_BUDGET };
  // Small fields can afford to look further ahead; big ones rarely play that many rounds.
  const attempts = n <= 16 ? 40 : n <= 32 ? 8 : 1;
  const depth = n <= 10 ? 3 : n <= 16 ? 2 : 1;

  let first: Found | null = null;
  for (let attempt = 0; attempt < attempts && budget.left > 0; attempt += 1) {
    const found = fullPairing(graph, shuffle(everyone, random), budget, false);
    if (!found) break;
    first ??= found;
    if (attempts === 1 || staysPairable(graph, found, depth, random, lookBudget)) return toIds(found);
  }
  if (first) return toIds(first);

  // No full pairing without a rematch: pair as many as possible.
  const shuffled = shuffle(everyone, random);
  const canPlay = canPlayIn(graph);
  for (let extra = (n % 2) + 2; extra < n; extra += 2) {
    const found = search(shuffled, extra, canPlay, { left: SEARCH_BUDGET });
    if (found && found.pairs.length > 0) return toIds(found);
  }
  const greedy = greedyPairs(shuffled, canPlay);
  return greedy.pairs.length > 0 ? toIds(greedy) : null;
}

/** True when at least two of `ids` haven't played each other yet (so there's a next round). */
export function hasNewOpponents(
  ids: readonly string[],
  history: readonly Pick<TournamentMatch, "a" | "b">[],
): boolean {
  const unique = [...new Set(ids)];
  const played = new Set(history.filter((m) => m.b != null).map((m) => pairKey(m.a, m.b as string)));
  for (let x = 0; x < unique.length; x += 1) {
    for (let y = x + 1; y < unique.length; y += 1) {
      if (!played.has(pairKey(unique[x], unique[y]))) return true;
    }
  }
  return false;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function canPlayIn(graph: PairingGraph): (x: number, y: number) => boolean {
  return (x, y) => x !== y && !graph.played[x][y];
}

function hasOpenPair(graph: PairingGraph): boolean {
  for (let x = 0; x < graph.n; x += 1) {
    for (let y = x + 1; y < graph.n; y += 1) {
      if (!graph.played[x][y]) return true;
    }
  }
  return false;
}

function withRound(graph: PairingGraph, found: Found): PairingGraph {
  const played = graph.played.map((row) => [...row]);
  const byes = [...graph.byes];
  for (const [x, y] of found.pairs) {
    played[x][y] = true;
    played[y][x] = true;
  }
  for (const x of found.byes) byes[x] += 1;
  return { n: graph.n, played, byes };
}

/**
 * A pairing of everyone (one bye for an odd count), trying byes in order of
 * fewest byes so far. `freshByeOnly` allows only those with the fewest.
 */
function fullPairing(
  graph: PairingGraph,
  order: number[],
  budget: { left: number },
  freshByeOnly: boolean,
): Found | null {
  const canPlay = canPlayIn(graph);
  if (order.length % 2 === 0) return search(order, 0, canPlay, budget);
  // Stable sort: the shuffled order breaks ties at random.
  const byeOrder = [...order].sort((x, y) => graph.byes[x] - graph.byes[y]);
  const fewest = graph.byes[byeOrder[0]];
  for (const bye of byeOrder) {
    if (budget.left <= 0) break;
    if (freshByeOnly && graph.byes[bye] > fewest) break;
    const found = search(
      order.filter((i) => i !== bye),
      0,
      canPlay,
      budget,
    );
    if (found) return { pairs: found.pairs, byes: [bye] };
  }
  return null;
}

/**
 * True when, after `found`, the next `depth` rounds can still be paired with
 * no rematches and byes going to whoever has had the fewest (or everyone has
 * played everyone). Runs out of budget → assume yes.
 */
function staysPairable(
  graph: PairingGraph,
  found: Found,
  depth: number,
  random: () => number,
  budget: { left: number },
): boolean {
  if (depth <= 0 || budget.left <= 0) return true;
  const next = withRound(graph, found);
  if (!hasOpenPair(next)) return true;
  const everyone = Array.from({ length: next.n }, (_, i) => i);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const following = fullPairing(next, shuffle(everyone, random), budget, true);
    if (!following) return budget.left <= 0;
    if (staysPairable(next, following, depth - 1, random, budget)) return true;
    if (budget.left <= 0) return true;
  }
  return false;
}

/**
 * Backtracking: take the entrant with the fewest possible opponents left,
 * try each of them (in the shuffled order), and let up to `skips` entrants
 * sit out. Returns null when there's no such pairing or the budget runs out.
 */
function search(
  remaining: number[],
  skips: number,
  canPlay: (x: number, y: number) => boolean,
  budget: { left: number },
): { pairs: [number, number][]; byes: number[] } | null {
  if (remaining.length === 0) return { pairs: [], byes: [] };
  budget.left -= 1;
  if (budget.left < 0) return null;
  if (remaining.length <= skips) return { pairs: [], byes: [...remaining] };

  let pick = remaining[0];
  let options: number[] | null = null;
  for (const x of remaining) {
    const opts = remaining.filter((y) => canPlay(x, y));
    if (options === null || opts.length < options.length) {
      pick = x;
      options = opts;
      if (opts.length === 0) break;
    }
  }
  const without = (...drop: number[]) => remaining.filter((r) => !drop.includes(r));

  for (const partner of options ?? []) {
    const rest = search(without(pick, partner), skips, canPlay, budget);
    if (rest) return { pairs: [[pick, partner], ...rest.pairs], byes: rest.byes };
    if (budget.left < 0) return null;
  }
  if (skips > 0) {
    const rest = search(without(pick), skips - 1, canPlay, budget);
    if (rest) return { pairs: rest.pairs, byes: [pick, ...rest.byes] };
  }
  return null;
}

/** Last resort: pair in order with the first available opponent. */
function greedyPairs(
  everyone: number[],
  canPlay: (x: number, y: number) => boolean,
): { pairs: [number, number][]; byes: number[] } {
  const left = new Set(everyone);
  const pairs: [number, number][] = [];
  const byes: number[] = [];
  for (const x of everyone) {
    if (!left.has(x)) continue;
    left.delete(x);
    const partner = [...left].find((y) => canPlay(x, y));
    if (partner === undefined) {
      byes.push(x);
    } else {
      left.delete(partner);
      pairs.push([x, partner]);
    }
  }
  return { pairs, byes };
}

// ─────────────────────────── standings ───────────────────────────

export interface StandingRow {
  entrant: TournamentEntrant;
  /** 1-based; entrants level on points and tiebreaker share a rank. */
  rank: number;
  /** Includes byes. */
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  points: number;
  /** 0–1: points ÷ (3 × results in). */
  matchWinPct: number;
  /** 0–1: average of opponents' match-win %, each counted at no less than ⅓. */
  opponentWinPct: number;
  /** Everyone they've been paired against, in round order (including this round). */
  opponents: string[];
}

const OPPONENT_FLOOR = 1 / 3;
const EPSILON = 1e-9;

export function computeStandings(
  entrants: readonly TournamentEntrant[],
  matches: readonly TournamentMatch[],
): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  const reportedOpponents = new Map<string, string[]>();
  for (const entrant of entrants) {
    rows.set(entrant.id, {
      entrant,
      rank: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      byes: 0,
      points: 0,
      matchWinPct: 0,
      opponentWinPct: 0,
      opponents: [],
    });
    reportedOpponents.set(entrant.id, []);
  }

  const ordered = [...matches].sort((x, y) => x.round - y.round || x.table - y.table);
  for (const m of ordered) {
    const a = rows.get(m.a);
    if (!a) continue;
    if (m.b == null) {
      if (m.result === "bye") {
        a.wins += 1;
        a.byes += 1;
      }
      continue;
    }
    const b = rows.get(m.b);
    if (!b) continue;
    a.opponents.push(m.b);
    b.opponents.push(m.a);
    if (m.result === "pending" || m.result === "bye") continue;
    reportedOpponents.get(m.a)?.push(m.b);
    reportedOpponents.get(m.b)?.push(m.a);
    if (m.result === "a") {
      a.wins += 1;
      b.losses += 1;
    } else if (m.result === "b") {
      b.wins += 1;
      a.losses += 1;
    } else {
      a.draws += 1;
      b.draws += 1;
    }
  }

  for (const row of rows.values()) {
    row.points = row.wins * 3 + row.draws;
    const results = row.wins + row.losses + row.draws;
    row.matchWinPct = results > 0 ? row.points / (3 * results) : 0;
  }
  for (const row of rows.values()) {
    const opps = reportedOpponents.get(row.entrant.id) ?? [];
    row.opponentWinPct =
      opps.length > 0
        ? opps.reduce((sum, id) => sum + Math.max(OPPONENT_FLOOR, rows.get(id)?.matchWinPct ?? 0), 0) /
          opps.length
        : 0;
  }

  const sorted = [...rows.values()].sort(
    (x, y) =>
      y.points - x.points ||
      (Math.abs(y.opponentWinPct - x.opponentWinPct) > EPSILON ? y.opponentWinPct - x.opponentWinPct : 0) ||
      y.wins - x.wins ||
      entrantLabel(x.entrant).localeCompare(entrantLabel(y.entrant)),
  );
  sorted.forEach((row, i) => {
    const prev = sorted[i - 1];
    row.rank =
      prev && prev.points === row.points && Math.abs(prev.opponentWinPct - row.opponentWinPct) <= EPSILON
        ? prev.rank
        : i + 1;
  });
  return sorted;
}

// ──────────────────────────── rounds ─────────────────────────────

export function matchesInRound(matches: readonly TournamentMatch[], round: number): TournamentMatch[] {
  return matches
    .filter((m) => m.round === round)
    .sort((x, y) => Number(x.b == null) - Number(y.b == null) || x.table - y.table);
}

export function activeEntrants(detail: Pick<TournamentDetail, "entrants">): TournamentEntrant[] {
  return detail.entrants.filter((e) => !e.droppedAt);
}

/** Players still in (a Two-Headed Giant team is two; someone waiting for a teammate is one). */
export function playerCount(detail: Pick<TournamentDetail, "entrants">): number {
  return activeEntrants(detail).reduce((n, e) => n + e.players.length, 0);
}

/** Signing up: spots are set and round 1 hasn't been paired. */
export function isSigningUp(detail: Pick<TournamentDetail, "spots" | "currentRound" | "status">): boolean {
  return detail.spots != null && detail.currentRound === 0 && detail.status === "active";
}

/** Two-Headed Giant sign-ups still without a teammate. */
export function soloEntrants(detail: Pick<TournamentDetail, "entrants" | "format">): TournamentEntrant[] {
  return detail.format === "2hg" ? activeEntrants(detail).filter((e) => e.players.length === 1) : [];
}

/** Why `spots` won't do for this format, or null. */
export function spotsProblem(format: TournamentFormat, spots: unknown): string | null {
  if (typeof spots !== "number" || !Number.isInteger(spots)) return "Enter the number of player spots.";
  const min = Math.max(MIN_SPOTS, minPlayers(format));
  if (spots < min || spots > MAX_SPOTS) return `Pick between ${min} and ${MAX_SPOTS} player spots.`;
  if (format === "2hg" && spots % 2 === 1) return "Two-Headed Giant needs an even number of player spots.";
  return null;
}

/** Why round 1 can't start yet, or null when it can (sign-ups may still have open spots). */
export function startBlocker(detail: TournamentDetail): string | null {
  if (detail.status !== "active") return "This tournament is finished. Reopen it to play.";
  if (detail.currentRound > 0) return "This tournament has already started.";
  const players = playerCount(detail);
  if (detail.format === "2hg") {
    if (players < 4) return "Two-Headed Giant needs at least 4 players (two teams) to start.";
    if (players % 2 === 1) return `Two-Headed Giant needs an even number of players: ${players} have signed up.`;
    return null;
  }
  if (detail.format === "ffa") {
    return players < minPlayers("ffa") ? "A free-for-all needs at least 3 players to start." : null;
  }
  return players < 2 ? "Add at least two players to start." : null;
}

/** Why the next round can't be paired yet, or null when it can. */
export function nextRoundBlocker(detail: TournamentDetail): string | null {
  const info = formatInfo(detail.format);
  if (detail.status !== "active") return "This tournament is finished. Reopen it to play another round.";
  if (detail.currentRound === 0) return startBlocker(detail);
  if (activeEntrants(detail).length < 2) return `Add at least two ${info.nounPlural} to start.`;
  if (detail.format === "ffa") {
    const open = podsInRound(detail.pods, detail.currentRound).filter((p) => !p.endedAt).length;
    if (open > 0) {
      return `Finish ${open === 1 ? "the last game" : `the ${open} games still being played`} in round ${detail.currentRound} first.`;
    }
    return null;
  }
  const pending = matchesInRound(detail.matches, detail.currentRound).filter((m) => m.result === "pending").length;
  if (pending > 0) {
    return `Record ${pending === 1 ? "the last result" : `the ${pending} results still open`} in round ${detail.currentRound} first.`;
  }
  return null;
}

/** True when the current round can be re-paired (re-dealt): it exists and no results are in yet. */
export function canRepairRound(detail: TournamentDetail): boolean {
  if (detail.status !== "active" || detail.currentRound < 1) return false;
  if (detail.format === "ffa") {
    return podsInRound(detail.pods, detail.currentRound).every((p) => !p.endedAt && p.players.every((pp) => !pp.outAt));
  }
  return matchesInRound(detail.matches, detail.currentRound).every((m) => m.result === "pending" || m.result === "bye");
}

// ────────────────────────── free-for-all ──────────────────────────
//
// Each round, everyone still in is dealt onto tables of up to `tableSize`
// players, as evenly as the count allows (10 players at 8 a table = two
// tables of 5). Among the random deals it keeps one where the fewest people
// sit with someone they've already sat with. Players go out one at a time and
// finish from the bottom (the first out of 8 is 8th); the last one standing
// is 1st. Points: a table of N gives N points for 1st, down to 1 for last.

/** A round's tables, by table number. */
export function podsInRound(pods: readonly TournamentPod[], round: number): TournamentPod[] {
  return pods.filter((p) => p.round === round).sort((x, y) => x.table - y.table);
}

/** A player's life at their table: what's been tracked, or the starting life. */
export function podLife(player: Pick<TournamentPodPlayer, "life">, startingLife: number): number {
  return player.life ?? startingLife;
}

/** Players at a table who haven't gone out. */
export function stillIn(pod: Pick<TournamentPod, "players">): TournamentPodPlayer[] {
  return pod.players.filter((p) => !p.outAt);
}

/** Where an entrant sits this round: their table and seat, or null. */
export function findSeatAt(
  pods: readonly TournamentPod[],
  round: number,
  entrantId: string,
): { pod: TournamentPod; player: TournamentPodPlayer } | null {
  for (const pod of pods) {
    if (pod.round !== round) continue;
    const player = pod.players.find((p) => p.entrantId === entrantId);
    if (player) return { pod, player };
  }
  return null;
}

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Points for a finishing place at a table of `tableCount` players: 1st = tableCount … last = 1. */
export function placePoints(place: number, tableCount: number): number {
  return Math.max(1, tableCount - place + 1);
}

/** How many sit at each table: as even as possible and none over `tableSize`. 10 at 8 a table → [5, 5]. */
export function tableSizes(players: number, tableSize: number): number[] {
  if (players < 2) return [];
  const size = Math.max(2, Math.floor(tableSize));
  const tables = Math.ceil(players / size);
  const base = Math.floor(players / tables);
  const extra = players % tables;
  return Array.from({ length: tables }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Random deals tried per round (each then improved by swapping players between tables). */
const DEAL_ATTEMPTS = 24;
/** Passes of swaps over a deal before keeping it as it is. */
const SWAP_PASSES = 12;

/**
 * Deals a free-for-all round: tables of the sizes tableSizes() gives, seats in
 * random order. Prefers deals where the fewest pairs of players sit together
 * again (two who've shared a table twice count four times as much as once).
 * Null when there aren't two players.
 */
export function dealTables(
  ids: readonly string[],
  tableSize: number,
  history: readonly Pick<TournamentPod, "players">[],
  random: () => number = Math.random,
): string[][] | null {
  const order = [...new Set(ids)];
  const sizes = tableSizes(order.length, tableSize);
  if (sizes.length === 0) return null;
  if (sizes.length === 1) return [shuffle(order, random)];

  const n = order.length;
  const index = new Map(order.map((id, i) => [id, i]));
  const met = order.map(() => new Array<number>(n).fill(0));
  for (const pod of history) {
    const at = pod.players.map((p) => index.get(p.entrantId)).filter((i): i is number => i !== undefined);
    for (let x = 0; x < at.length; x += 1) {
      for (let y = x + 1; y < at.length; y += 1) {
        met[at[x]][at[y]] += 1;
        met[at[y]][at[x]] += 1;
      }
    }
  }
  const weight = (x: number, y: number) => met[x][y] * met[x][y];
  const withTable = (x: number, table: number[], skip: number) =>
    table.reduce((sum, z) => (z === x || z === skip ? sum : sum + weight(x, z)), 0);
  const cost = (tables: number[][]) =>
    tables.reduce((sum, table) => sum + table.reduce((s, x) => s + withTable(x, table, -1), 0) / 2, 0);

  let best: number[][] | null = null;
  let bestCost = Infinity;
  const attempts = n <= 32 ? DEAL_ATTEMPTS : DEAL_ATTEMPTS / 3;
  for (let attempt = 0; attempt < attempts && bestCost > 0; attempt += 1) {
    const shuffled = shuffle(
      order.map((_, i) => i),
      random,
    );
    const tables: number[][] = [];
    let at = 0;
    for (const size of sizes) {
      tables.push(shuffled.slice(at, at + size));
      at += size;
    }
    // Swap two players between tables whenever it means fewer repeat tablemates.
    for (let pass = 0; pass < SWAP_PASSES; pass += 1) {
      let improved = false;
      for (let t1 = 0; t1 < tables.length; t1 += 1) {
        for (let t2 = t1 + 1; t2 < tables.length; t2 += 1) {
          for (let i = 0; i < tables[t1].length; i += 1) {
            for (let j = 0; j < tables[t2].length; j += 1) {
              const x = tables[t1][i];
              const y = tables[t2][j];
              const before = withTable(x, tables[t1], x) + withTable(y, tables[t2], y);
              const after = withTable(x, tables[t2], y) + withTable(y, tables[t1], x);
              if (after < before) {
                tables[t1][i] = y;
                tables[t2][j] = x;
                improved = true;
              }
            }
          }
        }
      }
      if (!improved) break;
    }
    const c = cost(tables);
    if (c < bestCost) {
      best = tables;
      bestCost = c;
    }
  }
  return (best ?? []).map((table) => shuffle(table, random).map((i) => order[i]));
}

export interface FfaStandingRow {
  entrant: TournamentEntrant;
  /** 1-based; level on points and wins share a rank. */
  rank: number;
  points: number;
  /** Games won (finished 1st). */
  wins: number;
  /** Games with a finishing place. */
  games: number;
  /** Where they finished in each round they played, in round order (null = still playing). */
  places: { round: number; place: number | null; of: number }[];
}

/** Free-for-all standings: points by finishing place, then games won. */
export function computeFfaStandings(
  entrants: readonly TournamentEntrant[],
  pods: readonly TournamentPod[],
): FfaStandingRow[] {
  const rows = new Map<string, FfaStandingRow>();
  for (const entrant of entrants) {
    rows.set(entrant.id, { entrant, rank: 0, points: 0, wins: 0, games: 0, places: [] });
  }
  const ordered = [...pods].sort((x, y) => x.round - y.round || x.table - y.table);
  for (const pod of ordered) {
    const of = pod.players.length;
    for (const p of pod.players) {
      const row = rows.get(p.entrantId);
      if (!row) continue;
      row.places.push({ round: pod.round, place: p.place, of });
      if (p.place == null) continue;
      row.games += 1;
      row.points += placePoints(p.place, of);
      if (p.place === 1) row.wins += 1;
    }
  }
  const sorted = [...rows.values()].sort(
    (x, y) => y.points - x.points || y.wins - x.wins || entrantLabel(x.entrant).localeCompare(entrantLabel(y.entrant)),
  );
  sorted.forEach((row, i) => {
    const prev = sorted[i - 1];
    row.rank = prev && prev.points === row.points && prev.wins === row.wins ? prev.rank : i + 1;
  });
  return sorted;
}

// ───────────────────────────── live ──────────────────────────────

/** True while any game in the current round is being played (screens refresh faster then). */
export function hasLiveGames(detail: Pick<TournamentDetail, "status" | "currentRound" | "format" | "matches" | "pods">): boolean {
  if (detail.status !== "active" || detail.currentRound < 1) return false;
  if (detail.format === "ffa") return detail.pods.some((p) => p.round === detail.currentRound && !p.endedAt);
  return detail.matches.some((m) => m.round === detail.currentRound && m.b != null && m.result === "pending");
}

/** True while this entrant is in a game being played (and, in free-for-all, hasn't gone out of it). */
export function isPlaying(
  detail: Pick<TournamentDetail, "status" | "currentRound" | "format" | "matches" | "pods">,
  entrantId: string,
): boolean {
  if (!hasLiveGames(detail)) return false;
  if (detail.format === "ffa") {
    const at = findSeatAt(detail.pods, detail.currentRound, entrantId);
    return at != null && !at.pod.endedAt && !at.player.outAt;
  }
  return detail.matches.some(
    (m) => m.round === detail.currentRound && m.result === "pending" && m.b != null && (m.a === entrantId || m.b === entrantId),
  );
}

// ─────────────────────────── ways to lose ───────────────────────────

/** How a game can be lost, in the order the phone offers them. */
export const LOSS_REASONS = [
  { value: "life", label: "Life total", short: "Life" },
  { value: "commander", label: "Commander damage", short: "Commander damage" },
  { value: "poison", label: "Poison", short: "Poison" },
  { value: "alt_win", label: "Alt win con", short: "Alt win con" },
  { value: "decked", label: "Decked", short: "Decked" },
  { value: "card", label: "A card said I lose", short: "Card effect" },
  { value: "concede", label: "Conceded", short: "Conceded" },
] as const;

export type LossReason = (typeof LOSS_REASONS)[number]["value"];

export function isLossReason(value: unknown): value is LossReason {
  return LOSS_REASONS.some((r) => r.value === value);
}

/** "Commander damage", "Alt win con"… */
export function lossLabel(reason: LossReason): string {
  return LOSS_REASONS.find((r) => r.value === reason)?.short ?? "";
}

/** Combat damage from one commander that loses the game. */
export const COMMANDER_DAMAGE_TO_LOSE = 21;

/** Poison counters that lose the game: 10, or 15 for a Two-Headed Giant team. */
export function poisonToLose(format: TournamentFormat): number {
  return format === "2hg" ? 15 : 10;
}

const NO_COUNTERS: GameCounters = Object.freeze({ poison: 0, commander: Object.freeze({}) }) as GameCounters;

/** A side's counters in a match (zeros when nothing's been tracked). */
export function countersOf(match: Pick<TournamentMatch, "countersA" | "countersB">, side: "a" | "b"): GameCounters {
  return (side === "a" ? match.countersA : match.countersB) ?? NO_COUNTERS;
}

/** A free-for-all player's counters (zeros when nothing's been tracked). */
export function podCounters(player: Pick<TournamentPodPlayer, "counters">): GameCounters {
  return player.counters ?? NO_COUNTERS;
}

/** The most commander damage from any one commander. */
export function topCommanderDamage(counters: GameCounters): number {
  return Math.max(0, ...Object.values(counters.commander));
}

/** A commander that can deal commander damage: one per player, and typed partners ("Thrasios & Tymna") apart. */
export interface CommanderSource {
  /** "<entrant id>:<seat>:<partner 0|1>". */
  key: string;
  entrantId: string;
  /** The commander's name, or "Alex's commander" when they haven't said. */
  label: string;
  player: string;
}

const PARTNER_SEPARATOR = /\s+(?:&|\+)\s+/;
const SOURCE_KEY_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([01]):([01])$/i;

export function commanderSources(entrant: Pick<TournamentEntrant, "id" | "players" | "commanders">): CommanderSource[] {
  return entrant.players.flatMap((player, seat) => {
    const commander = entrant.commanders[seat];
    // A card picked from the search is one commander; a typed pair is two partners.
    const names = !commander ? [] : commander.cardId ? [commander.name] : commander.name.split(PARTNER_SEPARATOR).filter(Boolean).slice(0, 2);
    if (names.length === 0) return [{ key: `${entrant.id}:${seat}:0`, entrantId: entrant.id, label: `${player}'s commander`, player }];
    return names.map((name, i) => ({ key: `${entrant.id}:${seat}:${i}`, entrantId: entrant.id, label: name, player }));
  });
}

export function parseSourceKey(key: unknown): { entrantId: string; seat: number; partner: number } | null {
  const m = typeof key === "string" ? key.match(SOURCE_KEY_RE) : null;
  return m ? { entrantId: m[1].toLowerCase(), seat: Number(m[2]), partner: Number(m[3]) } : null;
}

// ──────────────────────────── ready-up ────────────────────────────
//
// Once a player's game is over (or they're out of a free-for-all game, or
// they have a bye), their phone asks them to ready up for the next round.
// When everyone still in is ready and every game is decided, the server
// pairs (or deals) the next round. Staff can still start it early.

/** True when this entrant has nothing left to play this round. */
export function doneThisRound(
  detail: Pick<TournamentDetail, "currentRound" | "format" | "matches" | "pods">,
  entrantId: string,
): boolean {
  if (detail.currentRound < 1) return false;
  if (detail.format === "ffa") {
    const at = findSeatAt(detail.pods, detail.currentRound, entrantId);
    return !at || Boolean(at.pod.endedAt || at.player.outAt);
  }
  const match = detail.matches.find((m) => m.round === detail.currentRound && (m.a === entrantId || m.b === entrantId));
  return !match || match.result !== "pending";
}

/** True when this entrant is ready for the next round. */
export function isReady(
  detail: Pick<TournamentDetail, "currentRound" | "format" | "matches" | "pods">,
  entrant: Pick<TournamentEntrant, "id" | "readyFor">,
): boolean {
  return entrant.readyFor === detail.currentRound + 1 && doneThisRound(detail, entrant.id);
}

export interface Readiness {
  /** The round being readied for. */
  next: number;
  ready: TournamentEntrant[];
  waiting: TournamentEntrant[];
}

/**
 * Who's ready for the next round, or null when there's nothing to ready up
 * for (not started, finished, or a round robin with nobody left to play).
 */
export function readiness(detail: TournamentDetail): Readiness | null {
  if (detail.status !== "active" || detail.currentRound < 1) return null;
  const active = activeEntrants(detail);
  if (active.length < 2) return null;
  if (
    detail.format !== "ffa" &&
    !hasNewOpponents(
      active.map((e) => e.id),
      detail.matches,
    )
  ) {
    return null;
  }
  const ready = active.filter((e) => isReady(detail, e));
  return { next: detail.currentRound + 1, ready, waiting: active.filter((e) => !ready.includes(e)) };
}

/** True when the next round should start: everyone still in is ready and every game is decided. */
export function everyoneReady(detail: TournamentDetail): boolean {
  const r = readiness(detail);
  return r != null && r.waiting.length === 0 && nextRoundBlocker(detail) == null;
}
