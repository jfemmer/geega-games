import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff } from "../_lib/adminAuth.js";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { CUBE_ID_RE } from "../_lib/cubeCobra.js";
import {
  cleanText,
  createChecklist,
  deleteChecklist,
  getListById,
  listSummaries,
  markFoundByName,
  runCardAction,
  updateChecklist,
  type CardActionBody,
} from "../_lib/cubeChecklist.js";

// /api/admin/cube-checklists — staff side of the Cube Checklist.
//
//   GET                                        -> { checklists }   (with share tokens)
//   POST { action: "create", cubeId, name?, rarityRule? }  -> { checklist }
//   POST { action: "update", id, name?, shareEnabled?, rotateToken? } -> { checklist }
//   POST { action: "delete", id }              -> {}
//   POST { action: "import-found", id, names } -> { marked }  (this browser's old ticks)
//   POST { id, action: get|found|swap|unswap|suggest|search|printings, ... }
//        -> the same card actions as the share link, credited to the staff member.

const MAX_BODY_BYTES = 64 * 1024;

/** How staff show up next to what they found: the part of their email before the @. */
function staffLabel(email: string | null): string {
  return (email?.split("@")[0] ?? "Staff").slice(0, 40) || "Staff";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return methodNotAllowed(res, ["GET", "POST"]);
  }
  try {
    const staff = await requireStaff(req);
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      return sendJson(res, 200, { ok: true, checklists: await listSummaries() });
    }

    const body = (await readJsonBody(req, MAX_BODY_BYTES)) as CardActionBody & {
      id?: unknown;
      cubeId?: unknown;
      rarityRule?: unknown;
      shareEnabled?: unknown;
      rotateToken?: unknown;
      names?: unknown;
    };
    const action = String(body.action ?? "");

    if (action === "create") {
      const cubeId = String(body.cubeId ?? "").trim();
      if (!CUBE_ID_RE.test(cubeId)) throw new HttpError(400, "Enter a CubeCobra cube id, like thepaupercube.");
      const list = await createChecklist({
        cubeId,
        name: cleanText(body.name, 120),
        rarityRule:
          body.rarityRule === "common" || body.rarityRule === "common_uncommon" ? body.rarityRule : null,
        actor: staff.email,
      });
      return sendJson(res, 201, { ok: true, checklist: { id: list.id } });
    }

    const list = await getListById(String(body.id ?? ""));

    if (action === "update") {
      await updateChecklist(list, {
        name: cleanText(body.name, 120),
        shareEnabled: typeof body.shareEnabled === "boolean" ? body.shareEnabled : undefined,
        rotateToken: body.rotateToken === true,
      });
      return sendJson(res, 200, { ok: true });
    }
    if (action === "delete") {
      await deleteChecklist(list);
      return sendJson(res, 200, { ok: true });
    }
    if (action === "import-found") {
      const marked = await markFoundByName(list, body.names, staffLabel(staff.email));
      return sendJson(res, 200, { ok: true, marked });
    }

    const result = await runCardAction(list, body, staffLabel(staff.email));
    return sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
