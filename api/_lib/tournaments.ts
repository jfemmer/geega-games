import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import type { Database } from "../../src/types/database.js";
import {
  MAX_ENTRANTS,
  TOURNAMENT_LIST_LIMIT,
  activeEntrants,
  cleanPlayerName,
  cleanTournamentName,
  duplicateName,
  entrantLabel,
  entrantProblem,
  formatInfo,
  isReportableResult,
  isTournamentFormat,
  matchesInRound,
  nextRoundBlocker,
  pairRound,
  type MatchResult,
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
// Rounds are written only by the tournament_pair_round() RPC, which checks
// the round number and the player list in one transaction.

type TournamentRow = Database["public"]["Tables"]["tournaments"]["Row"];
type EntrantRow = Database["public"]["Tables"]["tournament_entrants"]["Row"];
type MatchRow = Database["public"]["Tables"]["tournament_matches"]["Row"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOURNAMENT_COLUMNS = "id, name, format, status, current_round, created_by, created_at, updated_at, finished_at";
const ENTRANT_COLUMNS = "id, tournament_id, player_one, player_two, dropped_at, created_at, updated_at";
const MATCH_COLUMNS =
  "id, tournament_id, round, table_number, entrant_a, entrant_b, result, reported_by, reported_at, created_at, updated_at";

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

function toEntrant(row: EntrantRow): TournamentEntrant {
  return {
    id: row.id,
    players: row.player_two ? [row.player_one, row.player_two] : [row.player_one],
    droppedAt: row.dropped_at,
    createdAt: row.created_at,
  };
}

function toMatch(row: MatchRow): TournamentMatch {
  return {
    id: row.id,
    round: row.round,
    table: row.table_number,
    a: row.entrant_a,
    b: row.entrant_b,
    result: asResult(row.result),
    reportedAt: row.reported_at,
  };
}

/** Trimmed names for one entrant, checked against the format. */
export function readPlayers(format: TournamentFormat, raw: unknown): string[] {
  const players = Array.isArray(raw) ? raw.map(cleanPlayerName) : [];
  const problem = entrantProblem(format, players);
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

export async function loadTournament(rawId: unknown): Promise<TournamentDetail> {
  const id = readId(rawId, "tournament");
  const { data, error } = await db().from("tournaments").select(TOURNAMENT_COLUMNS).eq("id", id).maybeSingle();
  if (error) tournamentDbError(error, "Couldn't load the tournament.");
  if (!data) throw new HttpError(404, "That tournament no longer exists.");
  const row = data as TournamentRow;

  const [entrants, matches] = await Promise.all([
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
  ]);
  if (entrants.error) tournamentDbError(entrants.error, "Couldn't load the tournament.");
  if (matches.error) tournamentDbError(matches.error, "Couldn't load the tournament.");

  return {
    id: row.id,
    name: row.name,
    format: asFormat(row.format),
    status: asStatus(row.status),
    currentRound: row.current_round,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    entrants: ((entrants.data ?? []) as EntrantRow[]).map(toEntrant),
    matches: ((matches.data ?? []) as MatchRow[]).map(toMatch),
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

export async function createTournament(input: {
  name: unknown;
  format: unknown;
  entrants: unknown;
  actor: string | null;
}): Promise<string> {
  if (!isTournamentFormat(input.format)) throw new HttpError(400, "Pick 1v1 or Two-Headed Giant.");
  const format = input.format;
  const info = formatInfo(format);
  const name = cleanTournamentName(input.name);
  if (!name) throw new HttpError(400, "Give the tournament a name.");
  const raw = Array.isArray(input.entrants) ? input.entrants : [];
  if (raw.length < 2) throw new HttpError(400, `Add at least two ${info.nounPlural}.`);
  if (raw.length > MAX_ENTRANTS) throw new HttpError(400, `A tournament can have up to ${MAX_ENTRANTS} ${info.nounPlural}.`);
  const entrants = raw.map((players) => readPlayers(format, players));
  const dup = duplicateName(entrants);
  if (dup) throw new HttpError(400, `${dup} is entered more than once.`);

  const { data, error } = await db()
    .from("tournaments")
    .insert({ name, format, created_by: input.actor?.slice(0, 320) ?? null })
    .select("id")
    .single();
  if (error || !data) tournamentDbError(error ?? {}, "Couldn't create the tournament.");
  const id = (data as { id: string }).id;

  const { error: entrantsError } = await db()
    .from("tournament_entrants")
    .insert(entrants.map((players) => entrantRow(id, players)));
  if (entrantsError) {
    // Don't leave an empty tournament behind.
    await db().from("tournaments").delete().eq("id", id);
    tournamentDbError(entrantsError, "Couldn't add the players.");
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
  const players = readPlayers(t.format, rawPlayers);
  assertNewNames(t, players);
  const { error } = await db().from("tournament_entrants").insert(entrantRow(t.id, players));
  if (error) tournamentDbError(error, `Couldn't add the ${info.noun}.`);
}

export async function renameEntrant(t: TournamentDetail, rawEntrantId: unknown, rawPlayers: unknown): Promise<void> {
  const entrant = findEntrant(t, rawEntrantId);
  const players = readPlayers(t.format, rawPlayers);
  assertNewNames(t, players, entrant.id);
  const { error } = await db()
    .from("tournament_entrants")
    .update({ player_one: players[0], player_two: players[1] ?? null })
    .eq("id", entrant.id)
    .eq("tournament_id", t.id);
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

  if (theirs.length === 0) {
    const { error } = await db()
      .from("tournament_entrants")
      .delete()
      .eq("id", entrant.id)
      .eq("tournament_id", t.id);
    if (error) tournamentDbError(error);
    return "deleted";
  }

  if (entrant.droppedAt) return "dropped";
  const open = theirs.find((m) => m.result === "pending" && m.b != null);
  if (open) {
    const { error } = await db()
      .from("tournament_matches")
      .update({
        result: open.a === entrant.id ? "b" : "a",
        reported_at: new Date().toISOString(),
        reported_by: actor?.slice(0, 320) ?? null,
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
    const current = matchesInRound(t.matches, t.currentRound);
    if (t.currentRound < 1 || current.some((m) => m.result !== "pending" && m.result !== "bye")) {
      throw new HttpError(409, `Results are already in for round ${t.currentRound}, so it can't be re-paired.`);
    }
  } else {
    const blocker = nextRoundBlocker(t);
    if (blocker) throw new HttpError(409, blocker);
  }

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
  const { data, error } = await db()
    .from("tournament_matches")
    .update(
      result === "pending"
        ? { result, reported_at: null, reported_by: null }
        : { result, reported_at: new Date().toISOString(), reported_by: actor?.slice(0, 320) ?? null },
    )
    .eq("id", match.id)
    .eq("tournament_id", t.id)
    .select("id");
  if (error) tournamentDbError(error);
  if (!data || data.length === 0) throw new HttpError(409, "That match changed while you were working. Refresh and try again.");
}

/** "Alex & Sam" for audit entries. */
export function entrantNames(t: TournamentDetail): string[] {
  return t.entrants.map(entrantLabel);
}
