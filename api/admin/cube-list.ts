import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff } from "../_lib/adminAuth.js";
import { HttpError, methodNotAllowed, sendJson } from "../_lib/http.js";
import { CUBE_ID_RE, fetchCubeList } from "../_lib/cubeCobra.js";

// GET /api/admin/cube-list?id=<cubecobra id>
//
// Staff-only proxy for the temporary Cube Checklist admin page. Returns the
// cube's mainboard as { cubeId, name, cards: [{ name, type, colorCategory }] }.
// Read-only, writes nothing; crossed-off state lives in the browser.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }
  try {
    await requireStaff(req);

    const id = String(req.query.id ?? "").trim();
    if (!CUBE_ID_RE.test(id)) {
      throw new HttpError(400, "Invalid cube id.");
    }

    const cube = await fetchCubeList(id);
    // Cube lists change rarely; let the browser reuse it briefly.
    res.setHeader("Cache-Control", "private, max-age=300");
    return sendJson(res, 200, { ...cube });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
