import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff } from "../_lib/adminAuth.js";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { logAdminAction } from "../_lib/auditLog.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import {
  addEntrant,
  createTournament,
  deleteTournament,
  entrantNames,
  listTournaments,
  loadTournament,
  pairTournamentRound,
  removeEntrant,
  renameEntrant,
  renameTournament,
  reportResult,
  restoreEntrant,
  searchCommanders,
  setCommander,
  setFinished,
  setSpots,
  setStartingLife,
  startIfFull,
  startTournament,
  updateShare,
} from "../_lib/tournaments.js";

// /api/admin/tournaments — admin → Tournaments (1v1 and Two-Headed Giant).
//
//   GET                         -> { tournaments }        (newest first)
//   GET ?id=                    -> { tournament }         (entrants + every match)
//   POST { action: "create", name, format: "1v1"|"2hg", entrants: string[][], spots? } -> { id, tournament }
//        (spots: players sign up from the player display; round 1 starts when they're filled)
//   POST { action, id, ... }    -> { tournament }         (the updated tournament)
//        rename          { name }
//        add-entrant     { players: string[] }
//        rename-entrant  { entrantId, players: string[], commanders?: ({ name, cardId? } | null)[] }
//        commander       { entrantId, seat, commander: { name, cardId? } | null }
//        share           { enabled?, rotate? }   (the player display link)
//        start                                   (round 1 now: makes any random 2HG teams, then pairs)
//        spots           { spots: number | null } (sign-up spots; null turns sign-ups off)
//        starting-life   { life }                 (life at the start of each game)
//        remove-entrant  { entrantId }      (deleted before they've played, dropped after)
//        restore-entrant { entrantId }
//        pair            { round, replace? } (round = the round being written)
//        report          { matchId, result: "a"|"b"|"draw"|"pending" }
//        finish | reopen
//        delete          -> {}
//   POST { action: "commander-search", query } -> { options: { name, cardId }[] }
//
// Every call needs a staff session. Pairing happens here, not in the browser,
// and the tournament_pair_round() RPC re-checks the round in a transaction.

const MAX_BODY_BYTES = 32 * 1024;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return methodNotAllowed(res, ["GET", "POST"]);
  }
  try {
    const staff = await requireStaff(req);
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      const id = req.query.id;
      if (id !== undefined) {
        return sendJson(res, 200, { ok: true, tournament: await loadTournament(Array.isArray(id) ? id[0] : id) });
      }
      return sendJson(res, 200, { ok: true, tournaments: await listTournaments() });
    }

    const body = await readJsonBody(req, MAX_BODY_BYTES);
    const action = String(body.action ?? "");

    if (action === "create") {
      const id = await createTournament({
        name: body.name,
        format: body.format,
        entrants: body.entrants,
        spots: body.spots,
        startingLife: body.startingLife,
        actor: staff.email,
      });
      const tournament = await loadTournament(id);
      await logAdminAction(getSupabaseAdmin(), staff, {
        action: "tournament.create",
        resourceType: "tournament",
        resourceId: id,
        after: { name: tournament.name, format: tournament.format, entrants: entrantNames(tournament) },
      });
      return sendJson(res, 201, { ok: true, id, tournament });
    }

    if (action === "commander-search") {
      return sendJson(res, 200, { ok: true, options: await searchCommanders(body.query) });
    }

    const tournament = await loadTournament(body.id);

    switch (action) {
      case "rename":
        await renameTournament(tournament, body.name);
        break;
      case "add-entrant":
        await addEntrant(tournament, body.players);
        await startIfFull(tournament.id);
        break;
      case "start":
        await startTournament(tournament);
        break;
      case "starting-life":
        await setStartingLife(tournament, body.life);
        break;
      case "spots":
        await setSpots(tournament, body.spots);
        await startIfFull(tournament.id);
        break;
      case "rename-entrant":
        await renameEntrant(tournament, body.entrantId, body.players, body.commanders);
        break;
      case "commander":
        await setCommander(tournament, { entrantId: body.entrantId, seat: body.seat, commander: body.commander });
        break;
      case "share":
        await updateShare(tournament, { enabled: body.enabled, rotate: body.rotate });
        break;
      case "remove-entrant":
        await removeEntrant(tournament, body.entrantId, staff.email);
        break;
      case "restore-entrant":
        await restoreEntrant(tournament, body.entrantId);
        break;
      case "pair":
        await pairTournamentRound(tournament, { round: body.round, replace: body.replace });
        break;
      case "report":
        await reportResult(tournament, { matchId: body.matchId, result: body.result }, staff.email);
        break;
      case "finish":
        await setFinished(tournament, true);
        break;
      case "reopen":
        await setFinished(tournament, false);
        break;
      case "delete":
        await deleteTournament(tournament);
        await logAdminAction(getSupabaseAdmin(), staff, {
          action: "tournament.delete",
          resourceType: "tournament",
          resourceId: tournament.id,
          before: {
            name: tournament.name,
            format: tournament.format,
            rounds: tournament.currentRound,
            entrants: entrantNames(tournament),
          },
        });
        return sendJson(res, 200, { ok: true });
      default:
        throw new HttpError(400, "Unknown action.");
    }

    return sendJson(res, 200, { ok: true, tournament: await loadTournament(tournament.id) });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[admin/tournaments]", err);
    return sendJson(res, status, { ok: false, message });
  }
}
