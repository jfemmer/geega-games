import { readFileSync } from "node:fs";
import path from "node:path";

// Which version of the bridge is running, so the dashboard's Scanner panel
// can tell a scanning PC that hasn't been updated, and every recognition
// result records the build that produced it.
//
// Updating takes three steps on the scanning PC (git pull, npm install +
// npm run build, restart), and skipping one leaves the old code running
// without any sign of it. So the bridge also reads its files on disk:
//
//   package.json's version ≠ the running one, and dist/ was built from
//   those files → it was updated and rebuilt, but not restarted;
//   dist/ is older than package.json → it was pulled but not rebuilt.

/**
 * This bridge's version. Bump it with every change to the bridge, together
 * with "version" in package.json (version.test.ts keeps the two equal) and
 * LATEST_BRIDGE_VERSION in the website's src/admin/utils/scannerBridge.ts
 * (tests/scannerBridgeVersion.test.ts there checks it against package.json).
 */
export const BRIDGE_VERSION = "1.1.0";

/** An update on disk that the running bridge isn't using yet. */
export interface PendingUpdate {
  /** The version of the files on disk. */
  version: string;
  /** What's left to do: rebuild (npm install, npm run build) and restart, or just restart. */
  step: "build" | "restart";
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** package.json's version in the bridge's folder (null when unreadable). */
export function installedVersion(bridgeDir: string): string | null {
  const text = readText(path.join(bridgeDir, "package.json"));
  if (!text) return null;
  try {
    const version = (JSON.parse(text) as { version?: unknown }).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/** The version compiled into dist/ (null when dist/ hasn't been built, or predates version reporting). */
export function builtVersion(bridgeDir: string): string | null {
  const text = readText(path.join(bridgeDir, "dist", "version.js"));
  return text?.match(/BRIDGE_VERSION\s*=\s*"([^"]+)"/)?.[1] ?? null;
}

/** The update waiting on disk, if the files there aren't the version that's running. */
export function pendingUpdate(bridgeDir: string, running = BRIDGE_VERSION): PendingUpdate | null {
  const installed = installedVersion(bridgeDir);
  if (!installed || installed === running) return null;
  return { version: installed, step: builtVersion(bridgeDir) === installed ? "restart" : "build" };
}

/** pendingUpdate, read from disk at most once per `ttlMs` (the dashboard polls every few seconds). */
export function pendingUpdateChecker(bridgeDir: string, ttlMs = 30_000, now: () => number = Date.now): () => PendingUpdate | null {
  let checkedAt = Number.NEGATIVE_INFINITY;
  let last: PendingUpdate | null = null;
  return () => {
    if (now() - checkedAt >= ttlMs) {
      last = pendingUpdate(bridgeDir);
      checkedAt = now();
    }
    return last;
  };
}
