import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_ORIGIN } from "../../src/seo/site.js";
import { hasHeadMarkers } from "../../src/seo/template.js";

// The storefront's HTML shell (dist/spa.html, written by scripts/prerender.ts
// after the Vite build): the built script and stylesheet tags, an empty root,
// and the head markers a page's own tags go between.
//
// A function can't see the static output unless it's packaged with it, so
// vercel.json lists dist/spa.html under the catalog function's `includeFiles`.
// Vercel builds the site before it packages the functions, so the file is
// there to include. Should that ever stop being true, the shell is fetched
// from the site instead — it's a public static file — so pages keep working,
// and the response says which was used (X-GG-Shell).

export type ShellSource = "bundle" | "fetch";
export interface SpaShell {
  html: string;
  source: ShellSource;
}

const FETCH_TIMEOUT_MS = 3000;

/**
 * How long a fetched shell is trusted. The packaged copy belongs to this
 * deployment and never changes; a fetched one might have come from the
 * deployment before this one while a release was switching over, and that
 * shell names script files this deployment doesn't have. Asking again soon
 * means such a mix-up fixes itself.
 */
export const FETCHED_SHELL_MAX_AGE_MS = 5 * 60 * 1000;

export interface ShellLoaderDeps {
  /** Where the packaged copy can be, in the order to try. */
  files: string[];
  readFile: (file: string) => Promise<string>;
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; text: () => Promise<string> }>;
  now: () => number;
}

/** Only ever fetch from this site: the host the request came in on, if it's ours, then the production origin. */
export function shellOrigins(host: string | undefined): string[] {
  const origins: string[] = [];
  const clean = (host ?? "").trim().toLowerCase();
  if (/^(?:www\.)?geega-games\.com$/.test(clean) || /^geega-games[a-z0-9-]*\.vercel\.app$/.test(clean)) {
    origins.push(`https://${clean}`);
  }
  if (!origins.includes(PRODUCTION_ORIGIN)) origins.push(PRODUCTION_ORIGIN);
  return origins;
}

export function createSpaShellLoader(deps: ShellLoaderDeps) {
  let cached: { shell: SpaShell; freshUntil: number } | null = null;

  async function fromBundle(): Promise<string | null> {
    for (const file of new Set(deps.files)) {
      try {
        const html = await deps.readFile(file);
        if (hasHeadMarkers(html)) return html;
      } catch {
        // Not packaged at this path — try the next one.
      }
    }
    return null;
  }

  async function fromSite(host: string | undefined): Promise<string | null> {
    for (const origin of shellOrigins(host)) {
      try {
        const res = await deps.fetch(`${origin}/spa.html`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) continue;
        const html = await res.text();
        // A sign-in wall or an error page is HTML too; only the real shell has the markers.
        if (hasHeadMarkers(html)) return html;
      } catch {
        // Unreachable or too slow — try the next origin.
      }
    }
    return null;
  }

  return {
    /**
     * The shell, or null when it can't be had at all. Remembered for this
     * function instance once found: the packaged copy for good, a fetched one
     * for a few minutes. A miss is not remembered, so the next request tries
     * again.
     */
    async load(host?: string): Promise<SpaShell | null> {
      if (cached && deps.now() < cached.freshUntil) return cached.shell;

      const bundled = await fromBundle();
      if (bundled) {
        cached = { shell: { html: bundled, source: "bundle" }, freshUntil: Infinity };
        return cached.shell;
      }
      const fetched = await fromSite(host);
      if (fetched) {
        cached = { shell: { html: fetched, source: "fetch" }, freshUntil: deps.now() + FETCHED_SHELL_MAX_AGE_MS };
        return cached.shell;
      }
      // Couldn't get a fresh one. The copy from a few minutes ago still beats no page.
      return cached?.shell ?? null;
    },
    /** Tests only: forget the remembered shell. */
    reset(): void {
      cached = null;
    },
  };
}

/** Where the packaged copy can be, depending on how the function is laid out. */
function bundledPaths(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [path.join(process.cwd(), "dist", "spa.html"), path.resolve(here, "..", "..", "dist", "spa.html")];
}

const loader = createSpaShellLoader({
  files: bundledPaths(),
  readFile: (file) => readFile(file, "utf8"),
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
});

export const loadSpaShell = loader.load;
