// Tournaments (admin → Tournaments): casual 1v1 and Two-Headed Giant events.
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

export const TOURNAMENT_FORMATS = [
  { value: "1v1", label: "1v1", teamSize: 1, noun: "player", nounPlural: "players" },
  { value: "2hg", label: "Two-Headed Giant", teamSize: 2, noun: "team", nounPlural: "teams" },
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
/** The player display: /tournament?t=<share token> (add &view=tv for a big screen). */
import { TOURNAMENT_PATH } from "../../store/lib/tournamentPath.js";
export { TOURNAMENT_PATH };
/** Entrants per tournament (players for 1v1, teams for Two-Headed Giant). */
export const MAX_ENTRANTS = 64;
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
export function entrantProblem(format: TournamentFormat, players: string[]): string | null {
  const size = formatInfo(format).teamSize;
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

/** Why the next round can't be paired yet, or null when it can. */
export function nextRoundBlocker(detail: TournamentDetail): string | null {
  const info = formatInfo(detail.format);
  if (detail.status !== "active") return "This tournament is finished. Reopen it to play another round.";
  if (activeEntrants(detail).length < 2) return `Add at least two ${info.nounPlural} to start.`;
  const pending = matchesInRound(detail.matches, detail.currentRound).filter((m) => m.result === "pending").length;
  if (pending > 0) {
    return `Record ${pending === 1 ? "the last result" : `the ${pending} results still open`} in round ${detail.currentRound} first.`;
  }
  return null;
}

/** True when the current round can be re-paired: it exists and no results are in yet. */
export function canRepairRound(detail: TournamentDetail): boolean {
  if (detail.status !== "active" || detail.currentRound < 1) return false;
  return matchesInRound(detail.matches, detail.currentRound).every((m) => m.result === "pending" || m.result === "bye");
}
