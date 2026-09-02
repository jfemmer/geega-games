import type { VercelRequest, VercelResponse } from "@vercel/node";

// Maximum accepted JSON body size for public POST endpoints (bytes).
const MAX_BODY_BYTES = 4 * 1024; // 4 KB is plenty for an email + honeypot.

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Read + parse a JSON body with a hard size cap. Vercel may have already parsed
// req.body; if so we re-serialize to enforce the cap consistently.
export async function readJsonBody(
  req: VercelRequest,
): Promise<Record<string, unknown>> {
  // Case 1: Vercel already parsed it.
  if (req.body && typeof req.body === "object") {
    const asString = JSON.stringify(req.body);
    if (Buffer.byteLength(asString, "utf8") > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body too large.");
    }
    return req.body as Record<string, unknown>;
  }

  // Case 2: raw stream.
  const raw = await readRawBody(req, MAX_BODY_BYTES);
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") {
      throw new HttpError(400, "Body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Invalid JSON body.");
  }
}

// Read the raw request body as a string, enforcing a byte cap. Used both for
// JSON endpoints and for webhook signature verification (which needs the exact
// unparsed bytes).
export function readRawBody(
  req: VercelRequest,
  maxBytes = 64 * 1024,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new HttpError(413, "Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => reject(new HttpError(400, "Failed to read body.")));
  });
}

export function requireJsonContentType(req: VercelRequest): void {
  const ct = String(req.headers["content-type"] ?? "");
  if (!ct.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }
}

export function methodNotAllowed(res: VercelResponse, allow: string[]): void {
  res.setHeader("Allow", allow.join(", "));
  res.status(405).json({ ok: false, message: "Method not allowed." });
}

export function sendJson(
  res: VercelResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.status(status).json(body);
}
