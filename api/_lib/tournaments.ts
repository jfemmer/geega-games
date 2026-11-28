import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { scryfallSearchCards } from "./scryfall.js";
import type { Database } from "../../src/types/database.js";
import {
  DEFAULT_TABLE_SIZE,
  MAX_ENTRANTS,
  everyoneReady,
  doneThisRound,
  isLossReason,
  parseSourceKey,
  type GameCounters,
  type LossReason,
  TOURNAMENT_LIST_LIMIT,
  activeEntrants,
  canRepairRound,
  dealTables,
  minPlayers,
  stillIn,
  tableSizeProblem,
  type TournamentPod,
  type TournamentPodPlayer,
  cleanCommanderName,
  cleanPlayerName,
  cleanTournamentName,
  DEFAULT_STARTING_LIFE,
  duplicateName,
  entrantLabel,
  entrantProblem,
  commanderSearchQuery,
  formatInfo,
  isCardId,
  isReportableResult,
  isSigningUp,
  playerCount,
  shuffle,
  soloEntrants,
  spotsProblem,
  startBlocker,
  startingLifeProblem,
  MAX_LIFE_CHANGE,
  isTournamentFormat,
  nextRoundBlocker,
  pairRound,
  type MatchResult,
  type TournamentCommander,
  type TournamentDetail,
  type TournamentEntrant,
  type TournamentFormat,
  type TournamentMatch,
  type TournamentStatus,
  type TournamentSummary,
} from "../../src/admin/utils/tournament.js";

// Database side of admin → Tournaments (/api/admin/tournaments). The rules
// for names, pairing and standings live in src/admin/utils/tournament.ts so
// the page and the server agree; this file reads and writes the rows.
// Rounds are written only by the tournament_pair_round() RPC (free-for-all:
// tournament_deal_pods()), which checks the round number and the player list
// in one transaction.

type TournamentRow = Database["public"]["Tables"]["tournaments"]["Row"];
type EntrantRow = Database["public"]["Tables"]["tournament_entrants"]["Row"];
type MatchRow = Database["public"]["Tables"]["tournament_matches"]["Row"];
type PodRow = Pick<Database["public"]["Tables"]["tournament_pods"]["Row"], "id" | "round" | "table_number" | "created_at" | "ended_at">;
type PodPlayerRow = Pick<
  Database["public"]["Tables"]["tournament_pod_players"]["Row"],
  "id" | "pod_id" | "entrant_id" | "seat" | "life" | "out_at" | "place" | "out_reason"
>;
type CounterRow = Pick<
  Database["public"]["Tables"]["tournament_counters"]["Row"],
  "match_id" | "side" | "pod_player_id" | "kind" | "source" | "value"
>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOURNAMENT_COLUMNS =
  "id, name, format, status, current_round, created_by, created_at, updated_at, finished_at, share_token, share_enabled, spots, starting_life, table_size";
const ENTRANT_COLUMNS =
  "id, tournament_id, player_one, player_two, commander_one, commander_one_card, commander_two, commander_two_card, dropped_at, created_at, updated_at, ready_for";
/** Share links are 32 url-safe characters (the database also accepts its own 64-character default). */
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;
/** Commander suggestions per search. */
const COMMANDER_RESULTS = 8;
const MATCH_COLUMNS =
  "id, tournament_id, round, table_number, entrant_a, entrant_b, result, reported_by, reported_at, created_at, updated_at, life_a, life_b, ended_at, loss_reason";
const POD_COLUMNS = "id, round, table_number, created_at, ended_at";
const POD_PLAYER_COLUMNS = "id, pod_id, entrant_id, seat, life, out_at, place, out_reason";
const COUNTER_COLUMNS = "match_id, side, pod_player_id, kind, source, value";

function db(): SupabaseClient<Database> {
  return getSupabaseAdmin();
}

/** A database error as an HttpError the page can show. */
export function tournamentDbError(error: { code?: string; message?: string }, fallback = "Couldn't save that. Please try again."): never {
  const message = error.message ?? fallback;
  switch (error.code) {
    case "GGT01":
      throw new HttpError(400, message);
    case "GGT02":
      throw new HttpError(409, message);
    case "GGT03":
      throw new HttpError(404, message);
    case "GGT04":
    case "GGT05":
      throw new HttpError(409, message);
    case "22P02":
      throw new HttpError(400, "Something didn't look right. Refresh and try again.");
    case "23505":
      if (/no_rematch/.test(message)) {
        throw new HttpError(409, "Those two have already played. Refresh and try again.");
      }
      if (/name_uidx/.test(message)) throw new HttpError(409, "That name is already in this tournament.");
      throw new HttpError(409, "That changed while you were working. Refresh and try again.");
    default:
      console.error("[tournaments] database error", error);
      throw new HttpError(500, fallback);
  }
}

function asFormat(value: string): TournamentFormat {
  return isTournamentFormat(value) ? value : "1v1";
}

function asStatus(value: string): TournamentStatus {
  return value === "finished" ? "finished" : "active";
}

function asResult(value: string): MatchResult {
  return value === "a" || value === "b" || value === "draw" || value === "bye" ? value : "pending";
}

function toCommander(name: string | null | undefined, cardId: string | null | undefined): TournamentCommander | null {
  return name ? { name, cardId: cardId ?? null } : null;
}

function toEntrant(row: EntrantRow): TournamentEntrant {
  const two = Boolean(row.player_two);
  return {
    id: row.id,
    players: two ? [row.player_one, row.player_two as string] : [row.player_one],
    commanders: two
      ? [toCommander(row.commander_one, row.commander_one_card), toCommander(row.commander_two, row.commander_two_card)]
      : [toCommander(row.commander_one, row.commander_one_card)],
    droppedAt: row.dropped_at,
    createdAt: row.created_at,
    readyFor: row.ready_for ?? null,
  };
}

function asLossReason(value: string | null | undefined): LossReason | null {
  return isLossReason(value) ? value : null;
}

/** This round's counters by "<match id>:<side>" or pod player id. */
function toCounters(rows: CounterRow[]): Map<string, GameCounters> {
  const out = new Map<string, GameCounters>();
  for (const r of rows) {
    const key = r.match_id ? `${r.match_id}:${r.side}` : (r.pod_player_id ?? "");
    const c = out.get(key) ?? { poison: 0, commander: {} };
    if (r.kind === "poison") c.poison = r.value;
    else if (r.kind === "commander" && r.source) c.commander[r.source] = r.value;
    out.set(key, c);
  }
  return out;
}

/** Tables with their players in seat order. */
function toPods(pods: PodRow[], players: PodPlayerRow[], counters: Map<string, GameCounters>): TournamentPod[] {
  const byPod = new Map<string, TournamentPodPlayer[]>();
  for (const p of players) {
    const list = byPod.get(p.pod_id) ?? [];
    list.push({
      id: p.id,
      entrantId: p.entrant_id,
      seat: p.seat,
      life: p.life ?? null,
      outAt: p.out_at ?? null,
      place: p.place ?? null,
      outReason: asLossReason(p.out_reason),
      ...(counters.has(p.id) ? { counters: counters.get(p.id) } : {}),
    });
    byPod.set(p.pod_id, list);
  }
  return pods
    .map((row) => ({
      id: row.id,
      round: row.round,
      table: row.table_number,
      startedAt: row.created_at,
      endedAt: row.ended_at ?? null,
      players: (byPod.get(row.id) ?? []).sort((x, y) => x.seat - y.seat),
    }))
    .sort((x, y) => x.round - y.round || x.table - y.table);
}

function toMatch(row: MatchRow, counters: Map<string, GameCounters>): TournamentMatch {
  const a = counters.get(`${row.id}:a`);
  const b = counters.get(`${row.id}:b`);
  return {
    ...(a ? { countersA: a } : {}),
    ...(b ? { countersB: b } : {}),
    lossReason: asLossReason(row.loss_reason),
    id: row.id,
    round: row.round,
    table: row.table_number,
    a: row.entrant_a,
    b: row.entrant_b,
    result: asResult(row.result),
    reportedAt: row.reported_at,
    lifeA: row.life_a ?? null,
    lifeB: row.life_b ?? null,
    startedAt: row.created_at,
    endedAt: row.ended_at ?? null,
  };
}

/**
 * Trimmed names for one entrant, checked against the format. `allowSolo`:
 * a Two-Headed Giant player may be on their own (sign-ups before round 1).
 */
export function readPlayers(format: TournamentFormat, raw: unknown, allowSolo = false): string[] {
  const players = (Array.isArray(raw) ? raw.map(cleanPlayerName) : []).filter((p, i) => i === 0 || p || !allowSolo);
  const problem = entrantProblem(format, players, allowSolo);
  if (problem) throw new HttpError(400, problem);
  return players;
}

function readId(raw: unknown, what: string): string {
  if (typeof raw !== "string" || !UUID_RE.test(raw)) throw new HttpError(400, `Invalid ${what}.`);
  return raw;
}

// ───────────────────────────── reads ─────────────────────────────

export async function listTournaments(): Promise<TournamentSummary[]> {
  const { data, error } = await db()
    .from("tournaments")
    .select(TOURNAMENT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(TOURNAMENT_LIST_LIMIT);
  if (error) tournamentDbError(error, "Couldn't load tournaments.");
  const rows = (data ?? []) as TournamentRow[];
  const counts = new Map<string, number>();
  if (rows.length > 0) {
    const { data: entrants, error: entrantsError } = await db()
      .from("tournament_entrants")
      .select("tournament_id, dropped_at")
      .in(
        "tournament_id",
        rows.map((r) => r.id),
      )
      .limit(TOURNAMENT_LIST_LIMIT * MAX_ENTRANTS);
    if (entrantsError) tournamentDbError(entrantsError, "Couldn't load tournaments.");
    for (const e of (entrants ?? []) as Pick<EntrantRow, "tournament_id" | "dropped_at">[]) {
      counts.set(e.tournament_id, (counts.get(e.tournament_id) ?? 0) + 1);
    }
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    format: asFormat(row.format),
    status: asStatus(row.status),
    currentRound: row.current_round,
    entrantCount: counts.get(row.id) ?? 0,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  }));
}

/** A tournament for staff, share link included. */
export async function loadTournament(rawId: unknown): Promise<TournamentDetail> {
  const id = readId(rawId, "tournament");
  const { data, error } = await db().from("tournaments").select(TOURNAMENT_COLUMNS).eq("id", id).maybeSingle();
  if (error) tournamentDbError(error, "Couldn't load the tournament.");
  if (!data) throw new HttpError(404, "That tournament no longer exists.");
  return withEntrantsAndMatches(data as TournamentRow);
}

/**
 * The tournament a player display link opens, without the link itself.
 * Turned-off and unknown links look the same.
 */
export async function loadTournamentByToken(token: unknown): Promise<TournamentDetail> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) {
    throw new HttpError(404, "This tournament link isn't valid.");
  }
  const { data, error } = await db()
    .from("tournaments")
    .select(TOURNAMENT_COLUMNS)
    .eq("share_token", token)
    .maybeSingle();
  if (error) tournamentDbError(error, "Couldn't load the tournament.");
  const row = data as TournamentRow | null;
  if (!row || !row.share_enabled) {
    throw new HttpError(404, "This tournament link isn't valid or has been turned off.");
  }
  return withEntrantsAndMatches(row);
}

/** What players see: everything but the share link. */
export function publicView(t: TournamentDetail): TournamentDetail {
  const { share: _share, ...rest } = t;
  return rest;
}

async function withEntrantsAndMatches(row: TournamentRow): Promise<TournamentDetail> {
  const id = row.id;
  const ffa = row.format === "ffa";

  const [entrants, matches, pods, podPlayers, counterRows] = await Promise.all([
    db()
      .from("tournament_entrants")
      .select(ENTRANT_COLUMNS)
      .eq("tournament_id", id)
      .order("created_at", { ascending: true })
      .limit(MAX_ENTRANTS * 2),
    db()
      .from("tournament_matches")
      .select(MATCH_COLUMNS)
      .eq("tournament_id", id)
      .order("round", { ascending: true })
      .order("table_number", { ascending: true })
      .limit(10_000),
    // Free-for-all tables (only that format has any).
    ffa
      ? db().from("tournament_pods").select(POD_COLUMNS).eq("tournament_id", id).order("round", { ascending: true }).limit(5_000)
      : null,
    ffa ? db().from("tournament_pod_players").select(POD_PLAYER_COLUMNS).eq("tournament_id", id).limit(20_000) : null,
    // Poison and commander damage: only the round being played is shown.
    row.current_round > 0
      ? db().from("tournament_counters").select(COUNTER_COLUMNS).eq("tournament_id", id).eq("round", row.current_round).limit(5_000)
      : null,
  ]);
  if (entrants.error) tournamentDbError(entrants.error, "Couldn't load the tournament.");
  if (matches.error) tournamentDbError(matches.error, "Couldn't load the tournament.");
  if (pods?.error) tournamentDbError(pods.error, "Couldn't load the tournament.");
  if (podPlayers?.error) tournamentDbError(podPlayers.error, "Couldn't load the tournament.");
  if (counterRows?.error) tournamentDbError(counterRows.error, "Couldn't load the tournament.");
  const counters = toCounters((counterRows?.data ?? []) as CounterRow[]);

  return {
    id: row.id,
    name: row.name,
    format: asFormat(row.format),
    status: asStatus(row.status),
    currentRound: row.current_round,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    entrants: ((entrants.data ?? []) as EntrantRow[]).map(toEntrant),
    matches: ((matches.data ?? []) as MatchRow[]).map((m) => toMatch(m, counters)),
    share: { token: row.share_token, enabled: row.share_enabled },
    spots: row.spots ?? null,
    startingLife: row.starting_life ?? DEFAULT_STARTING_LIFE[asFormat(row.format)],
    tableSize: ffa ? (row.table_size ?? DEFAULT_TABLE_SIZE) : null,
    pods: ffa ? toPods((pods?.data ?? []) as PodRow[], (podPlayers?.data ?? []) as PodPlayerRow[], counters) : [],
    serverTime: new Date().toISOString(),
  };
}

function requireActive(t: TournamentDetail): void {
  if (t.status !== "active") throw new HttpError(409, "This tournament is finished. Reopen it to make changes.");
}

function findEntrant(t: TournamentDetail, rawId: unknown): TournamentEntrant {
  const id = readId(rawId, "player");
  const entrant = t.entrants.find((e) => e.id === id);
  if (!entrant) throw new HttpError(404, "That player isn't in this tournament anymore. Refresh and try again.");
  return entrant;
}

/** Throws when any of `players` is already in the tournament (ignoring `exceptId`). */
function assertNewNames(t: TournamentDetail, players: string[], exceptId?: string): void {
  const others = t.entrants.filter((e) => e.id !== exceptId).map((e) => e.players);
  const taken = new Set(others.flat().map((n) => n.toLowerCase()));
  const clash = players.find((p) => taken.has(p.toLowerCase()));
  if (clash) throw new HttpError(409, `${clash} is already in this tournament.`);
}

function entrantRow(tournamentId: string, players: string[]) {
  return { tournament_id: tournamentId, player_one: players[0], player_two: players[1] ?? null };
}

// ──────────────────────────── writes ─────────────────────────────

/**
 * Creates a tournament. With `spots`, players sign themselves up from the
 * player display (any names sent now take spots too); without, staff enter
 * at least two entrants now.
 */
export async function createTournament(input: {
  name: unknown;
  format: unknown;
  entrants: unknown;
  spots?: unknown;
  startingLife?: unknown;
  /** Free-for-all: the most players per table. */
  tableSize?: unknown;
  actor: string | null;
}): Promise<string> {
  if (!isTournamentFormat(input.format)) throw new HttpError(400, "Pick 1v1, Two-Headed Giant or free-for-all.");
  const format = input.format;
  const info = formatInfo(format);
  const name = cleanTournamentName(input.name);
  if (!name) throw new HttpError(400, "Give the tournament a name.");
  const signups = input.spots != null;
  if (signups) {
    const problem = spotsProblem(format, input.spots);
    if (problem) throw new HttpError(400, problem);
  }
  const spots = signups ? (input.spots as number) : null;
  const startingLife = input.startingLife == null ? DEFAULT_STARTING_LIFE[format] : input.startingLife;
  const lifeProblem = startingLifeProblem(startingLife);
  if (lifeProblem) throw new HttpError(400, lifeProblem);
  let tableSize: number | null = null;
  if (format === "ffa") {
    tableSize = input.tableSize == null ? DEFAULT_TABLE_SIZE : (input.tableSize as number);
    const problem = tableSizeProblem(tableSize);
    if (problem) throw new HttpError(400, problem);
  }
  const raw = Array.isArray(input.entrants) ? input.entrants : [];
  const fewest = Math.max(2, minPlayers(format) / info.teamSize);
  if (!signups && raw.length < fewest) {
    throw new HttpError(400, fewest === 2 ? `Add at least two ${info.nounPlural}.` : `Add at least ${fewest} ${info.nounPlural}.`);
  }
  if (raw.length > MAX_ENTRANTS) throw new HttpError(400, `A tournament can have up to ${MAX_ENTRANTS} ${info.nounPlural}.`);
  const entrants = raw.map((players) => readPlayers(format, players, signups));
  const dup = duplicateName(entrants);
  if (dup) throw new HttpError(400, `${dup} is entered more than once.`);
  if (spots != null && entrants.flat().length > spots) {
    throw new HttpError(400, `That's more names than the ${spots} player spots.`);
  }

  const { data, error } = await db()
    .from("tournaments")
    .insert({
      name,
      format,
      spots,
      starting_life: startingLife as number,
      table_size: tableSize,
      created_by: input.actor?.slice(0, 320) ?? null,
    })
    .select("id")
    .single();
  if (error || !data) tournamentDbError(error ?? {}, "Couldn't create the tournament.");
  const id = (data as { id: string }).id;

  if (entrants.length > 0) {
    const { error: entrantsError } = await db()
      .from("tournament_entrants")
      .insert(entrants.map((players) => entrantRow(id, players)));
    if (entrantsError) {
      // Don't leave an empty tournament behind.
      await db().from("tournaments").delete().eq("id", id);
      tournamentDbError(entrantsError, "Couldn't add the players.");
    }
  }
  return id;
}

export async function renameTournament(t: TournamentDetail, rawName: unknown): Promise<void> {
  const name = cleanTournamentName(rawName);
  if (!name) throw new HttpError(400, "Give the tournament a name.");
  const { error } = await db().from("tournaments").update({ name }).eq("id", t.id);
  if (error) tournamentDbError(error);
}

export async function setFinished(t: TournamentDetail, finished: boolean): Promise<void> {
  const { error } = await db()
    .from("tournaments")
    .update(
      finished
        ? { status: "finished", finished_at: new Date().toISOString() }
        : { status: "active", finished_at: null },
    )
    .eq("id", t.id);
  if (error) tournamentDbError(error);
}

export async function deleteTournament(t: TournamentDetail): Promise<void> {
  const { error } = await db().from("tournaments").delete().eq("id", t.id);
  if (error) tournamentDbError(error, "Couldn't delete the tournament.");
}

export async function addEntrant(t: TournamentDetail, rawPlayers: unknown): Promise<void> {
  requireActive(t);
  const info = formatInfo(t.format);
  if (t.entrants.length >= MAX_ENTRANTS) {
    throw new HttpError(409, `A tournament can have up to ${MAX_ENTRANTS} ${info.nounPlural}.`);
  }
  const signingUp = isSigningUp(t);
  const players = readPlayers(t.format, rawPlayers, signingUp);
  assertNewNames(t, players);
  if (signingUp && t.spots != null && playerCount(t) + players.length > t.spots) {
    throw new HttpError(409, `All ${t.spots} player spots are filled. Add a spot first.`);
  }
  const { error } = await db().from("tournament_entrants").insert(entrantRow(t.id, players));
  if (error) tournamentDbError(error, `Couldn't add the ${info.noun}.`);
}

/**
 * A commander as sent by the page: { name, cardId? } sets it, null or an empty
 * name clears it. A card id only counts when it looks like a Scryfall id.
 */
export function readCommander(raw: unknown): TournamentCommander | null {
  if (raw == null || typeof raw !== "object") return null;
  const { name, cardId } = raw as { name?: unknown; cardId?: unknown };
  const clean = cleanCommanderName(name);
  if (!clean) return null;
  return { name: clean, cardId: isCardId(cardId) ? cardId.toLowerCase() : null };
}

function commanderColumns(seat: number, commander: TournamentCommander | null) {
  return seat === 0
    ? { commander_one: commander?.name ?? null, commander_one_card: commander?.cardId ?? null }
    : { commander_two: commander?.name ?? null, commander_two_card: commander?.cardId ?? null };
}

/**
 * Renames a player or team (staff). `rawCommanders`, when sent, sets each
 * player's commander too (one entry per player; null clears).
 */
export async function renameEntrant(
  t: TournamentDetail,
  rawEntrantId: unknown,
  rawPlayers: unknown,
  rawCommanders?: unknown,
): Promise<void> {
  const entrant = findEntrant(t, rawEntrantId);
  const players = readPlayers(t.format, rawPlayers, isSigningUp(t));
  assertNewNames(t, players, entrant.id);
  const patch: Database["public"]["Tables"]["tournament_entrants"]["Update"] = {
    player_one: players[0],
    player_two: players[1] ?? null,
  };
  if (Array.isArray(rawCommanders)) {
    players.forEach((_, seat) => Object.assign(patch, commanderColumns(seat, readCommander(rawCommanders[seat]))));
  }
  const { error } = await db()
    .from("tournament_entrants")
    .update(patch)
    .eq("id", entrant.id)
    .eq("tournament_id", t.id);
  if (error) tournamentDbError(error);
}

/** Sets (or clears) one player's commander: players do this from the display link, staff from the admin. */
export async function setCommander(
  t: TournamentDetail,
  input: { entrantId: unknown; seat: unknown; commander: unknown },
): Promise<void> {
  if (t.status !== "active") throw new HttpError(409, "This tournament is finished, so commanders are locked in.");
  const entrant = findEntrant(t, input.entrantId);
  const seat = input.seat;
  if (typeof seat !== "number" || !Number.isInteger(seat) || seat < 0 || seat >= entrant.players.length) {
    throw new HttpError(400, "Pick which player this commander is for.");
  }
  const { error } = await db()
    .from("tournament_entrants")
    .update(commanderColumns(seat, readCommander(input.commander)))
    .eq("id", entrant.id)
    .eq("tournament_id", t.id);
  if (error) tournamentDbError(error);
}

/** Commanders whose name has the words typed, most played first (EDHREC rank). */
export async function searchCommanders(raw: unknown): Promise<{ name: string; cardId: string }[]> {
  const query = commanderSearchQuery(raw);
  if (!query) return [];
  const cards = await scryfallSearchCards(query, "edhrec");
  return cards.slice(0, COMMANDER_RESULTS).map((c) => ({ name: c.name, cardId: c.id }));
}

/** Turns the player display link on or off, or replaces it (old links stop working). */
export async function updateShare(t: TournamentDetail, input: { enabled: unknown; rotate: unknown }): Promise<void> {
  const patch: Database["public"]["Tables"]["tournaments"]["Update"] = {};
  if (typeof input.enabled === "boolean") patch.share_enabled = input.enabled;
  if (input.rotate === true) patch.share_token = randomBytes(24).toString("base64url");
  if (Object.keys(patch).length === 0) return;
  const { error } = await db().from("tournaments").update(patch).eq("id", t.id);
  if (error) tournamentDbError(error);
}

/**
 * Takes an entrant out. Before they've been paired they're deleted outright
 * (entered by mistake). After that they're dropped: their results stay in
 * the standings, they aren't paired again, and a match they're still playing
 * goes to their opponent.
 */
export async function removeEntrant(
  t: TournamentDetail,
  rawEntrantId: unknown,
  actor: string | null,
): Promise<"deleted" | "dropped"> {
  requireActive(t);
  const entrant = findEntrant(t, rawEntrantId);
  const theirs = t.matches.filter((m) => m.a === entrant.id || m.b === entrant.id);
  const seats = t.pods.flatMap((pod) => pod.players.filter((p) => p.entrantId === entrant.id).map((player) => ({ pod, player })));

  if (theirs.length === 0 && seats.length === 0) {
    const { error } = await db()
      .from("tournament_entrants")
      .delete()
      .eq("id", entrant.id)
      .eq("tournament_id", t.id);
    if (error) tournamentDbError(error);
    return "deleted";
  }

  if (entrant.droppedAt) return "dropped";
  // Free-for-all: leaving a game being played counts as going out of it.
  const playing = seats.find((s) => !s.pod.endedAt && !s.player.outAt);
  if (playing) {
    const { error } = await db().rpc("tournament_pod_knock_out", {
      p_tournament_id: t.id,
      p_pod_player_id: playing.player.id,
    });
    // Already out or the game just ended: nothing left to record.
    if (error && error.code !== "GGT02") tournamentDbError(error);
  }
  const open = theirs.find((m) => m.result === "pending" && m.b != null);
  if (open) {
    const { error } = await db()
      .from("tournament_matches")
      .update({
        result: open.a === entrant.id ? "b" : "a",
        reported_at: new Date().toISOString(),
        reported_by: actor?.slice(0, 320) ?? null,
        ended_at: new Date().toISOString(),
      })
      .eq("id", open.id)
      .eq("result", "pending");
    if (error) tournamentDbError(error);
  }
  const { error } = await db()
    .from("tournament_entrants")
    .update({ dropped_at: new Date().toISOString() })
    .eq("id", entrant.id)
    .eq("tournament_id", t.id);
  if (error) tournamentDbError(error);
  return "dropped";
}

/** Puts a dropped entrant back in; they're paired again from the next round. */
export async function restoreEntrant(t: TournamentDetail, rawEntrantId: unknown): Promise<void> {
  requireActive(t);
  const entrant = findEntrant(t, rawEntrantId);
  if (!entrant.droppedAt) return;
  const { error } = await db()
    .from("tournament_entrants")
    .update({ dropped_at: null })
    .eq("id", entrant.id)
    .eq("tournament_id", t.id);
  if (error) tournamentDbError(error);
}

/**
 * Pairs the next round (or re-pairs the current one while it has no results).
 * `round` is the round the page means to write, so a second tap — or another
 * device — can't pair twice.
 */
export async function pairTournamentRound(
  t: TournamentDetail,
  input: { round: unknown; replace: unknown },
  random: () => number = Math.random,
): Promise<number> {
  const replace = input.replace === true;
  const round = replace ? t.currentRound : t.currentRound + 1;
  if (input.round !== round) {
    throw new HttpError(
      409,
      replace ? "The rounds changed while you were working. Refresh and try again." : `Round ${t.currentRound} is already paired.`,
    );
  }

  if (replace) {
    requireActive(t);
    if (!canRepairRound(t)) {
      throw new HttpError(
        409,
        t.format === "ffa"
          ? `Someone is already out in round ${t.currentRound}, so it can't be re-dealt.`
          : `Results are already in for round ${t.currentRound}, so it can't be re-paired.`,
      );
    }
  } else {
    const blocker = nextRoundBlocker(t);
    if (blocker) throw new HttpError(409, blocker);
  }

  if (t.format === "ffa") return dealRound(t, round, replace, random);

  const history = replace ? t.matches.filter((m) => m.round !== t.currentRound) : t.matches;
  const active = activeEntrants(t);
  const pairing = pairRound(
    active.map((e) => e.id),
    history,
    random,
  );
  if (!pairing) {
    throw new HttpError(
      409,
      `Everyone still in has already played each other, so there are no new pairings left. Finish the tournament to lock in the standings.`,
    );
  }

  const { error } = await db().rpc("tournament_pair_round", {
    p_tournament_id: t.id,
    p_round: round,
    p_replace: replace,
    p_pairings: [
      ...pairing.pairs.map(([a, b]) => ({ a, b })),
      ...pairing.byes.map((a) => ({ a, b: null })),
    ],
  });
  if (error) tournamentDbError(error, "Couldn't pair the round.");
  return round;
}

/** Free-for-all: deals everyone still in onto new tables (see dealTables()). */
async function dealRound(t: TournamentDetail, round: number, replace: boolean, random: () => number): Promise<number> {
  const history = replace ? t.pods.filter((p) => p.round !== t.currentRound) : t.pods;
  const tables = dealTables(
    activeEntrants(t).map((e) => e.id),
    t.tableSize ?? DEFAULT_TABLE_SIZE,
    history,
    random,
  );
  if (!tables) throw new HttpError(409, "Add at least two players to deal a round.");
  const { error } = await db().rpc("tournament_deal_pods", {
    p_tournament_id: t.id,
    p_round: round,
    p_replace: replace,
    p_pods: tables,
  });
  if (error) tournamentDbError(error, "Couldn't deal the tables.");
  return round;
}

export async function reportResult(
  t: TournamentDetail,
  input: { matchId: unknown; result: unknown },
  actor: string | null,
): Promise<void> {
  requireActive(t);
  const matchId = readId(input.matchId, "match");
  const match = t.matches.find((m) => m.id === matchId);
  if (!match) throw new HttpError(404, "That match isn't there anymore. Refresh and try again.");
  if (match.b == null) throw new HttpError(400, "A bye doesn't need a result.");
  if (!isReportableResult(input.result)) throw new HttpError(400, "Pick who won, or a draw.");
  const result = input.result;
  if (result === "pending" && match.round !== t.currentRound) {
    throw new HttpError(400, "Only this round's results can be cleared. Pick who won instead.");
  }
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("tournament_matches")
    .update(
      result === "pending"
        ? { result, reported_at: null, reported_by: null, ended_at: null, loss_reason: null }
        : {
            result,
            reported_at: now,
            reported_by: actor?.slice(0, 320) ?? null,
            // Staff decided it: how it was lost is no longer the player's account.
            loss_reason: null,
            // The game ended when it was first decided; changing the winner later doesn't move that.
            ended_at: match.endedAt ?? (match.result === "pending" ? now : match.reportedAt ?? now),
          },
    )
    .eq("id", match.id)
    .eq("tournament_id", t.id)
    .select("id");
  if (error) tournamentDbError(error);
  if (!data || data.length === 0) throw new HttpError(409, "That match changed while you were working. Refresh and try again.");
}

// ──────────────────────────── sign-ups ────────────────────────────

/**
 * A player takes a spot from the player display: their name, an optional
 * commander, and (Two-Headed Giant) optionally someone who signed up alone
 * to team up with. Returns which entrant and seat they are.
 */
export async function signUp(
  t: TournamentDetail,
  input: { name: unknown; commander: unknown; teamWith: unknown },
): Promise<{ entrantId: string; seat: number }> {
  const name = cleanPlayerName(input.name);
  if (!name) throw new HttpError(400, "Enter your name.");
  const commander = readCommander(input.commander);
  let teamWith: string | null = null;
  if (input.teamWith != null && input.teamWith !== "") {
    teamWith = readId(input.teamWith, "teammate");
  }
  const { data, error } = await db().rpc("tournament_sign_up", {
    p_tournament_id: t.id,
    p_name: name,
    p_commander: commander?.name ?? null,
    p_card: commander?.cardId ?? null,
    p_team_with: teamWith,
  });
  if (error) tournamentDbError(error, "Couldn't sign you up. Please try again.");
  const result = (data ?? {}) as { entrant_id?: string; seat?: number };
  if (!result.entrant_id) throw new HttpError(500, "Couldn't sign you up. Please try again.");
  return { entrantId: result.entrant_id, seat: result.seat === 1 ? 1 : 0 };
}

/**
 * Starts round 1: puts Two-Headed Giant players who are still alone into
 * random teams, then pairs the round. Staff can do this before every spot
 * is filled ("Start now"); it also runs on its own when the last spot fills.
 */
export async function startTournament(t: TournamentDetail, random: () => number = Math.random): Promise<void> {
  const blocker = startBlocker(t);
  if (blocker) throw new HttpError(409, blocker);
  let current = t;
  const solos = soloEntrants(t);
  if (solos.length > 0) {
    const order = shuffle(solos, random);
    const pairs = [];
    for (let i = 0; i + 1 < order.length; i += 2) pairs.push({ keep: order[i].id, merge: order[i + 1].id });
    const { error } = await db().rpc("tournament_form_teams", { p_tournament_id: t.id, p_pairs: pairs });
    if (error) tournamentDbError(error, "Couldn't make the teams.");
    current = await loadTournament(t.id);
  }
  await pairTournamentRound(current, { round: 1, replace: false }, random);
}

/** Starts the tournament if sign-ups just filled the last spot. Never throws: the sign-up already worked. */
export async function startIfFull(tournamentId: string): Promise<boolean> {
  try {
    const t = await loadTournament(tournamentId);
    if (!isSigningUp(t) || t.spots == null || playerCount(t) < t.spots) return false;
    await startTournament(t);
    return true;
  } catch (err) {
    console.error("[tournaments] couldn't start when full", tournamentId, err);
    return false;
  }
}

/** Changes the number of player spots (not below who has signed up), or turns sign-ups off with null. */
export async function setSpots(t: TournamentDetail, raw: unknown): Promise<void> {
  if (t.currentRound > 0) throw new HttpError(409, "The tournament has started, so the spots are set.");
  requireActive(t);
  let spots: number | null = null;
  if (raw != null) {
    const problem = spotsProblem(t.format, raw);
    if (problem) throw new HttpError(400, problem);
    spots = raw as number;
    const players = playerCount(t);
    if (spots < players) {
      throw new HttpError(409, `${players} players have already signed up. Remove someone first to go below that.`);
    }
  }
  const { error } = await db().from("tournaments").update({ spots }).eq("id", t.id);
  if (error) tournamentDbError(error);
}

// ───────────────────────────── life ─────────────────────────────

function findLiveGame(t: TournamentDetail, rawMatchId: unknown, rawSide: unknown) {
  if (t.status !== "active") throw new HttpError(409, "This tournament is finished.");
  const matchId = readId(rawMatchId, "game");
  const match = t.matches.find((m) => m.id === matchId);
  if (!match || match.b == null) throw new HttpError(404, "That game isn't there anymore. Refresh and try again.");
  if (rawSide !== "a" && rawSide !== "b") throw new HttpError(400, "Pick a side.");
  if (match.result !== "pending") throw new HttpError(409, "This game is over.");
  return { match, side: rawSide as "a" | "b" };
}

/** Adds to (or takes from) one side's life while the game is played. Players do this from their phones. */
export async function changeLife(
  t: TournamentDetail,
  input: { matchId: unknown; side: unknown; delta: unknown },
): Promise<{ lifeA: number; lifeB: number }> {
  const { match, side } = findLiveGame(t, input.matchId, input.side);
  const delta = input.delta;
  if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_LIFE_CHANGE) {
    throw new HttpError(400, "That life change doesn't look right.");
  }
  const { data, error } = await db().rpc("tournament_change_life", {
    p_tournament_id: t.id,
    p_match_id: match.id,
    p_side: side,
    p_delta: delta,
  });
  if (error) tournamentDbError(error, "Couldn't update the life total.");
  const life = (data ?? {}) as { life_a?: number; life_b?: number };
  return { lifeA: life.life_a ?? t.startingLife, lifeB: life.life_b ?? t.startingLife };
}

/**
 * A player confirms they lost (their life hit 0, or they conceded): the game
 * goes to the other side and its clock stops. Only while it's being played,
 * so two phones confirming at once record it once.
 */
export async function reportLoss(
  t: TournamentDetail,
  input: { matchId: unknown; side: unknown; reason?: unknown },
): Promise<void> {
  const { match, side } = findLiveGame(t, input.matchId, input.side);
  const reason = readLossReason(input.reason);
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("tournament_matches")
    .update({ result: side === "a" ? "b" : "a", reported_at: now, reported_by: "player", ended_at: now, loss_reason: reason })
    .eq("id", match.id)
    .eq("tournament_id", t.id)
    .eq("result", "pending")
    .select("id");
  if (error) tournamentDbError(error);
  if (!data || data.length === 0) throw new HttpError(409, "This game is already over.");
}

// ───────────────────── free-for-all tables ─────────────────────

function findPodSeat(t: TournamentDetail, rawId: unknown): { pod: TournamentPod; player: TournamentPodPlayer } {
  if (t.status !== "active") throw new HttpError(409, "This tournament is finished.");
  const id = readId(rawId, "seat");
  for (const pod of t.pods) {
    const player = pod.players.find((p) => p.id === id);
    if (player) return { pod, player };
  }
  throw new HttpError(404, "That table isn't there anymore. Refresh and try again.");
}

function findPod(t: TournamentDetail, rawId: unknown): TournamentPod {
  requireActive(t);
  const id = readId(rawId, "table");
  const pod = t.pods.find((p) => p.id === id);
  if (!pod) throw new HttpError(404, "That table isn't there anymore. Refresh and try again.");
  if (pod.round !== t.currentRound) throw new HttpError(409, "Only this round's games can be changed.");
  return pod;
}

/** Adds to (or takes from) a player's life at a free-for-all table. Players do this from their phones. */
export async function changePodLife(t: TournamentDetail, input: { podPlayerId: unknown; delta: unknown }): Promise<number> {
  const { pod, player } = findPodSeat(t, input.podPlayerId);
  if (pod.endedAt || player.outAt) throw new HttpError(409, "This game is over for you.");
  const delta = input.delta;
  if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_LIFE_CHANGE) {
    throw new HttpError(400, "That life change doesn't look right.");
  }
  const { data, error } = await db().rpc("tournament_pod_change_life", {
    p_tournament_id: t.id,
    p_pod_player_id: player.id,
    p_delta: delta,
  });
  if (error) tournamentDbError(error, "Couldn't update the life total.");
  return typeof data === "number" ? data : t.startingLife;
}

/**
 * A player is out of their free-for-all game (they confirmed on their phone,
 * or staff marked it): they take the lowest place still open, and when one
 * player is left the game is theirs. Returns the place they finished.
 */
export async function knockOut(
  t: TournamentDetail,
  input: { podPlayerId: unknown; reason?: unknown; winnerEntrantId?: unknown },
): Promise<{ place: number; ended: boolean }> {
  const { pod, player } = findPodSeat(t, input.podPlayerId);
  if (pod.endedAt) throw new HttpError(409, "This game is over.");
  if (player.outAt) throw new HttpError(409, "You're already out of this game.");
  const reason = readLossReason(input.reason);
  const left = stillIn(pod);
  // Someone won with a card (Thassa's Oracle, Approach…): everyone else
  // loses at once, so the game ends with them 1st and the rest sharing 2nd.
  if (reason === "alt_win" && left.length > 2) {
    const winner = typeof input.winnerEntrantId === "string" ? left.find((p) => p.entrantId === input.winnerEntrantId) : undefined;
    if (!winner || winner.id === player.id) throw new HttpError(400, "Pick who won the game.");
    const { error } = await db().rpc("tournament_pod_set_winner", {
      p_tournament_id: t.id,
      p_pod_id: pod.id,
      p_entrant_id: winner.entrantId,
      p_reason: "alt_win",
    });
    if (error) tournamentDbError(error, "Couldn't record that. Please try again.");
    return { place: 2, ended: true };
  }
  const { data, error } = await db().rpc("tournament_pod_knock_out", {
    p_tournament_id: t.id,
    p_pod_player_id: player.id,
    ...(reason ? { p_reason: reason } : {}),
  });
  if (error) tournamentDbError(error, "Couldn't record that. Please try again.");
  const result = (data ?? {}) as { place?: number; ended?: boolean };
  return { place: result.place ?? 0, ended: result.ended === true };
}

/** Staff end a free-for-all game (time's up): the winner is 1st, everyone else still in shares 2nd. */
export async function setPodWinner(t: TournamentDetail, input: { podId: unknown; entrantId: unknown }): Promise<void> {
  const pod = findPod(t, input.podId);
  if (pod.endedAt) throw new HttpError(409, "This game is already over. Undo it first to change the winner.");
  const entrantId = readId(input.entrantId, "player");
  if (!stillIn(pod).some((p) => p.entrantId === entrantId)) {
    throw new HttpError(400, "The winner has to be someone still in the game.");
  }
  const { error } = await db().rpc("tournament_pod_set_winner", {
    p_tournament_id: t.id,
    p_pod_id: pod.id,
    p_entrant_id: entrantId,
  });
  if (error) tournamentDbError(error);
}

/** Staff take back the last thing at a table: whoever went out last is back in, and a decided game is open again. */
export async function undoPod(t: TournamentDetail, input: { podId: unknown }): Promise<void> {
  const pod = findPod(t, input.podId);
  if (pod.players.every((p) => !p.outAt)) throw new HttpError(409, "Nobody is out at this table yet.");
  const { error } = await db().rpc("tournament_pod_undo", { p_tournament_id: t.id, p_pod_id: pod.id });
  if (error) tournamentDbError(error);
}

/** Free-for-all: changes the most players per table (used from the next deal). */
export async function setTableSize(t: TournamentDetail, raw: unknown): Promise<void> {
  if (t.format !== "ffa") throw new HttpError(400, "Players per table is for free-for-all tournaments.");
  requireActive(t);
  const problem = tableSizeProblem(raw);
  if (problem) throw new HttpError(400, problem);
  const { error } = await db().from("tournaments").update({ table_size: raw as number }).eq("id", t.id);
  if (error) tournamentDbError(error);
}

/** How a game was lost, as sent by a phone: a known reason, or null when none was given. */
function readLossReason(raw: unknown): LossReason | null {
  if (raw == null || raw === "") return null;
  if (!isLossReason(raw)) throw new HttpError(400, "Pick how the game was lost.");
  return raw;
}

/**
 * Adds to poison counters or commander damage while a game is played:
 * a side of a match ({ matchId, side }) or a free-for-all seat
 * ({ podPlayerId }). Commander damage names the commander that dealt it,
 * which has to belong to someone else in that game.
 */
export async function changeCounter(
  t: TournamentDetail,
  input: { matchId?: unknown; side?: unknown; podPlayerId?: unknown; kind: unknown; source?: unknown; delta: unknown },
): Promise<number> {
  const kind = input.kind;
  if (kind !== "poison" && kind !== "commander") throw new HttpError(400, "Pick poison or commander damage.");
  const delta = input.delta;
  if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_LIFE_CHANGE) {
    throw new HttpError(400, "That change doesn't look right.");
  }

  let target: { matchId: string; side: "a" | "b" } | { podPlayerId: string };
  /** Entrants who could have dealt this player commander damage. */
  let opponents: string[];
  if (input.podPlayerId != null) {
    const { pod, player } = findPodSeat(t, input.podPlayerId);
    if (pod.endedAt || player.outAt) throw new HttpError(409, "This game is over for you.");
    target = { podPlayerId: player.id };
    opponents = pod.players.filter((p) => p.id !== player.id).map((p) => p.entrantId);
  } else {
    const { match, side } = findLiveGame(t, input.matchId, input.side);
    target = { matchId: match.id, side };
    opponents = [side === "a" ? (match.b as string) : match.a];
  }

  let source = "";
  if (kind === "commander") {
    const parsed = parseSourceKey(input.source);
    const from = parsed ? t.entrants.find((e) => e.id === parsed.entrantId) : undefined;
    if (!parsed || !from || !opponents.includes(from.id) || parsed.seat >= from.players.length) {
      throw new HttpError(400, "Pick which commander dealt the damage.");
    }
    source = `${parsed.entrantId}:${parsed.seat}:${parsed.partner}`;
  }

  const { data, error } = await db().rpc("tournament_change_counter", {
    p_tournament_id: t.id,
    p_match_id: "matchId" in target ? target.matchId : null,
    p_side: "matchId" in target ? target.side : null,
    p_pod_player_id: "podPlayerId" in target ? target.podPlayerId : null,
    p_kind: kind,
    p_source: source,
    p_delta: delta,
  });
  if (error) tournamentDbError(error, "Couldn't save that.");
  return typeof data === "number" ? data : 0;
}

/**
 * A player is ready for the next round (or takes it back). Only once their
 * game this round is over. Returns true when that made everyone ready and
 * the next round started.
 */
export async function setReady(t: TournamentDetail, input: { entrantId: unknown; ready: unknown }): Promise<boolean> {
  if (t.status !== "active") throw new HttpError(409, "This tournament is finished.");
  if (t.currentRound < 1) throw new HttpError(409, "The tournament hasn't started yet.");
  const entrant = findEntrant(t, input.entrantId);
  if (entrant.droppedAt) throw new HttpError(409, "You've been dropped from this tournament. Ask the store to bring you back.");
  const ready = input.ready !== false;
  if (ready && !doneThisRound(t, entrant.id)) throw new HttpError(409, "Finish your game first.");
  const { error } = await db()
    .from("tournament_entrants")
    .update({ ready_for: ready ? t.currentRound + 1 : null })
    .eq("id", entrant.id)
    .eq("tournament_id", t.id);
  if (error) tournamentDbError(error);
  return ready ? advanceIfAllReady(t.id) : false;
}

/**
 * Pairs (or deals) the next round when everyone still in is ready and every
 * game is decided. Never throws: two players readying at once both get here,
 * and the round check in the RPC lets only one of them start it.
 */
export async function advanceIfAllReady(tournamentId: string, random: () => number = Math.random): Promise<boolean> {
  try {
    const t = await loadTournament(tournamentId);
    if (!everyoneReady(t)) return false;
    await pairTournamentRound(t, { round: t.currentRound + 1, replace: false }, random);
    return true;
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 409)) console.error("[tournaments] couldn't start the next round", tournamentId, err);
    return false;
  }
}

/** Changes the starting life (games already being played keep what they've tracked). */
export async function setStartingLife(t: TournamentDetail, raw: unknown): Promise<void> {
  const problem = startingLifeProblem(raw);
  if (problem) throw new HttpError(400, problem);
  const { error } = await db().from("tournaments").update({ starting_life: raw as number }).eq("id", t.id);
  if (error) tournamentDbError(error);
}

/** "Alex & Sam" for audit entries. */
export function entrantNames(t: TournamentDetail): string[] {
  return t.entrants.map(entrantLabel);
}
