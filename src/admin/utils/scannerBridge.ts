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

/**
 * Why the bridge didn't answer, as far as this page can tell:
 *
 * - "browser_blocked": Chrome's local network access permission is denied
 *   for this site, so it won't let the page reach the bridge (and won't ask
 *   again by itself).
 * - "wrong_site": something answers at the bridge's address but won't share
 *   its status with this page. That's the bridge set up for a different
 *   address of the site (its GEEGA_API_BASE_URL is the only origin it
 *   answers).
 * - "not_running": nothing answers. Normal when this isn't the scanning PC.
 */
export type BridgeProblem = "browser_blocked" | "wrong_site" | "not_running";

/** Chrome 145+ calls it "loopback-network" ("Apps on device" in site settings); 142–144 "local-network-access". */
const LOCAL_ACCESS_PERMISSIONS = ["loopback-network", "local-network-access"];

async function localAccessDenied(): Promise<boolean> {
  const permissions = typeof navigator === "undefined" ? undefined : navigator.permissions;
  if (!permissions?.query) return false;
  for (const name of LOCAL_ACCESS_PERMISSIONS) {
    try {
      const result = await permissions.query({ name: name as PermissionName });
      return result.state === "denied";
    } catch {
      // This browser doesn't know that permission name; try the next one.
    }
  }
  return false;
}

export async function diagnoseUnreachableBridge(): Promise<BridgeProblem> {
  if (await localAccessDenied()) return "browser_blocked";
  try {
    // An opaque "no-cors" response still proves something answered.
    await fetch(`${SCANNER_BRIDGE_URL}/status`, { mode: "no-cors", cache: "no-store" });
    return "wrong_site";
  } catch {
    return "not_running";
  }
}
