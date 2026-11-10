// Browser client for the public cube checklist share link (POST /api/cube-checklist).
// The admin page talks to /api/admin/cube-checklists through its own caller;
// both plug into CubeChecklistView as a CubeChecklistCaller.

import { CHECKLIST_LIMITS } from "./cubeChecklist";

/** Sends one checklist action and returns the JSON body (throws with the server's message). */
export type CubeChecklistCaller = <T>(body: Record<string, unknown>) => Promise<T>;

const NAME_KEY = "gg-cube-checklist-name";

export function readSavedName(): string {
  try {
    return (window.localStorage.getItem(NAME_KEY) ?? "").slice(0, CHECKLIST_LIMITS.personName);
  } catch {
    return "";
  }
}

export function saveName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage unavailable — the name still works for this visit */
  }
}

/** A caller bound to a share token and the name to credit. */
export function shareLinkCaller(token: string, who: string): CubeChecklistCaller {
  return async <T,>(body: Record<string, unknown>): Promise<T> => {
    let res: Response;
    try {
      res = await fetch("/api/cube-checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...body, token, who }),
      });
    } catch {
      throw new Error("You seem to be offline. Check your connection and try again.");
    }
    let json: { ok?: boolean; message?: string } & Record<string, unknown> = {};
    try {
      json = await res.json();
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok || json.ok === false) {
      const err = new Error(json.message ?? `Request failed (${res.status}).`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return json as T;
  };
}
