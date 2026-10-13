// The local scanner bridge (scanner-bridge/, a separate Windows program next
// to the Ricoh fi-8170) serves a small status/control API on this computer's
// loopback address only. Pages that talk to it share these helpers. It's
// normal for it to be unreachable — most staff aren't at the scanning PC.

export const SCANNER_BRIDGE_URL =
  (import.meta.env.VITE_SCANNER_BRIDGE_URL as string | undefined) ?? "http://127.0.0.1:8787";

/** The bridge isn't running on this computer (or the browser blocked local network access). */
export class BridgeUnreachableError extends Error {
  constructor() {
    super("The scanner PC's bridge isn't reachable from this computer.");
  }
}

export interface BridgeReply<T> {
  status: number;
  ok: boolean;
  data: T;
}

/** POSTs JSON to the bridge. Throws BridgeUnreachableError when nothing answers. */
export async function postToBridge<T = { ok?: boolean; message?: string }>(
  path: string,
  body?: unknown,
  timeoutMs = 60_000,
): Promise<BridgeReply<T>> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${SCANNER_BRIDGE_URL}${path}`, {
      method: "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new BridgeUnreachableError();
  } finally {
    window.clearTimeout(timer);
  }
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, ok: res.ok, data };
}
