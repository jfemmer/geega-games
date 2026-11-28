import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "./_lib/http.js";
import { checkRateLimit, getClientIp } from "./_lib/rateLimit.js";
import {
  changeLife,
  changePodLife,
  knockOut,
  loadTournamentByToken,
  publicView,
  reportLoss,
  searchCommanders,
  setCommander,
  signUp,
  startIfFull,
} from "./_lib/tournaments.js";

// POST /api/tournament — the player display (/tournament?t=<token>): the
// bracket players see on the store TV or their phones. No login: the secret
// token in the link is the access. Staff turn a link off or replace it from
// admin → Tournaments (api/admin/tournaments.ts).
//
//   { token, action: "get" }                                    -> { tournament }
//   { token, action: "commander", entrantId, seat, commander }  -> { tournament }
//   { token, action: "commander-search", query }                -> { options: { name, cardId }[] }
//   { token, action: "sign-up", name, commander?, teamWith? }   -> { tournament, seat: { entrantId, seat }, started }
//   { token, action: "life", matchId, side: "a"|"b", delta }   -> { life: { a, b }, serverTime }
//   { token, action: "lost", matchId, side: "a"|"b" }          -> { tournament }   (that side lost the game)
//   { token, action: "pod-life", podPlayerId, delta }           -> { life, serverTime }  (free-for-all)
//   { token, action: "pod-out", podPlayerId }                   -> { tournament, place } (free-for-all: I'm out)
//
// Players can sign up for an open spot (when staff set spots), add or
// change commanders, track life during a game and confirm they lost it.
// When the last spot fills, round 1 starts. Pairing, names and any other
// results stay with staff. The view never includes the link itself or who
// recorded what.

const MAX_BODY_BYTES = 2 * 1024;
const WINDOW_MS = 10 * 60_000;
// Per IP, per 10 minutes. While games are live a TV refreshes every 2.5s and
// each phone every 5s, and a room full of players usually shares the store's
// Wi-Fi address (32 phones + a TV ≈ 4,100 in 10 minutes).
const LIMITS: Record<string, number> = {
  get: 12000,
  life: 6000,
  lost: 300,
  "pod-life": 6000,
  "pod-out": 300,
  commander: 300,
  "commander-search": 600,
  "sign-up": 120,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const body = await readJsonBody(req, MAX_BODY_BYTES);
    const action = String(body.action ?? "");
    const limit = LIMITS[action];
    if (!limit) throw new HttpError(400, "Unknown action.");

    const rl = checkRateLimit(`tournament-${action}`, getClientIp(req), limit, WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many requests. Please wait a moment and try again.");
    }
    res.setHeader("Cache-Control", "no-store");

    const tournament = await loadTournamentByToken(body.token);

    if (action === "commander-search") {
      return sendJson(res, 200, { ok: true, options: await searchCommanders(body.query) });
    }
    if (action === "sign-up") {
      const seat = await signUp(tournament, { name: body.name, commander: body.commander, teamWith: body.teamWith });
      const started = await startIfFull(tournament.id);
      return sendJson(res, 200, {
        ok: true,
        seat,
        started,
        tournament: publicView(await loadTournamentByToken(body.token)),
      });
    }
    if (action === "life") {
      const life = await changeLife(tournament, { matchId: body.matchId, side: body.side, delta: body.delta });
      return sendJson(res, 200, {
        ok: true,
        life: { a: life.lifeA, b: life.lifeB },
        serverTime: new Date().toISOString(),
      });
    }
    if (action === "lost") {
      await reportLoss(tournament, { matchId: body.matchId, side: body.side });
      return sendJson(res, 200, { ok: true, tournament: publicView(await loadTournamentByToken(body.token)) });
    }
    if (action === "pod-life") {
      const life = await changePodLife(tournament, { podPlayerId: body.podPlayerId, delta: body.delta });
      return sendJson(res, 200, { ok: true, life, serverTime: new Date().toISOString() });
    }
    if (action === "pod-out") {
      const { place } = await knockOut(tournament, { podPlayerId: body.podPlayerId });
      return sendJson(res, 200, { ok: true, place, tournament: publicView(await loadTournamentByToken(body.token)) });
    }
    if (action === "commander") {
      await setCommander(tournament, { entrantId: body.entrantId, seat: body.seat, commander: body.commander });
      return sendJson(res, 200, { ok: true, tournament: publicView(await loadTournamentByToken(body.token)) });
    }
    return sendJson(res, 200, { ok: true, tournament: publicView(tournament) });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[tournament]", err);
    return sendJson(res, status, { ok: false, message });
  }
}
