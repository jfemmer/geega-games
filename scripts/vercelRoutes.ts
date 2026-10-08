// A small model of what vercel.json does with a request, and a check — run by
// the build (scripts/prerender.ts) and by tests/vercelRouting.test.ts — that
// it serves every page the site has.
//
// Why this exists: vercel.json has no catch-all. An address it doesn't name
// gets a real 404, which is right for a mistyped or retired URL and wrong for
// a real page somebody forgot to list. The local dev server answers every
// address, so a forgotten page would look fine until it was live. The build
// fails instead.
//
// Patterns are compiled the way Vercel compiles them: path-to-regexp 6.1.0,
// strict (a trailing slash matters) and case-sensitive.

import { pathToRegexp, type Key } from "path-to-regexp";
import { APP_SHELL_ROUTES, CATALOG_ROUTES } from "../src/seo/appRoutes.js";

/**
 * A condition on a rule (vercel.json "has"). Only "host" is modelled: a rule
 * with any other kind of condition is treated as never matching, so the
 * check can't credit a rule with more than it is sure the rule does.
 */
export interface RuleCondition {
  type: string;
  key?: string;
  value?: string;
}
export interface RewriteRule {
  source: string;
  destination: string;
  has?: RuleCondition[];
}
export interface RedirectRule extends RewriteRule {
  permanent?: boolean;
  statusCode?: number;
}
export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
  has?: RuleCondition[];
}
/** The parts of vercel.json that decide where a request goes. */
export interface VercelRoutingConfig {
  redirects?: RedirectRule[];
  headers?: HeaderRule[];
  rewrites?: RewriteRule[];
}

export type RouteResult =
  | { type: "redirect"; status: number; location: string }
  /** A static file or API function at exactly this address (only reported when `exists` is given). */
  | { type: "file"; headers: Record<string, string> }
  | { type: "rewrite"; destination: string; headers: Record<string, string> }
  /** vercel.json has nothing for it: Vercel answers with the 404 page. */
  | { type: "unmatched"; headers: Record<string, string> };

interface Compiled {
  matcher: RegExp;
  keys: Key[];
}

function compile(source: string): Compiled {
  const keys: Key[] = [];
  const matcher = pathToRegexp(source, keys, { strict: true, sensitive: true, delimiter: "/" });
  return { matcher, keys };
}

/** The site's own address: what a request is for when a test or the build check names no host. */
export const PRODUCTION_HOST = "geega-games.com";

/** Whether a rule's "has" conditions hold for a request to `host`. */
function conditionsHold(conditions: RuleCondition[] | undefined, host: string): boolean {
  return (conditions ?? []).every((condition) => condition.type === "host" && condition.value === host);
}

/** Put what a source pattern captured into a destination: ":name" by name, "$1" by position. */
function fill(destination: string, match: RegExpExecArray, keys: Key[]): string {
  return destination.replace(/\$(\d+)|:([A-Za-z_]\w*)\*?/g, (token, position: string, name: string) => {
    if (position) return match[Number(position)] ?? "";
    const index = keys.findIndex((key) => key.name === name);
    return index === -1 ? token : (match[index + 1] ?? "");
  });
}

/**
 * Vercel's order: redirects, then header rules, then whatever file or
 * function is at the address, then rewrites. A rewrite whose target doesn't
 * exist doesn't end the search — matching carries on from the rewritten path.
 *
 * `exists` says whether a file or function is at a path. Leave it out to ask
 * only what vercel.json itself says (every rewrite target is taken to exist).
 *
 * `route(path, { host })` asks about a request to another host name (the
 * vercel.app address, say); the site's own address is the default.
 */
export function createRouter(config: VercelRoutingConfig, exists?: (path: string) => boolean) {
  const redirects = (config.redirects ?? []).map((rule) => ({ rule, ...compile(rule.source) }));
  const headerRules = (config.headers ?? []).map((rule) => ({ rule, ...compile(rule.source) }));
  const rewrites = (config.rewrites ?? []).map((rule) => ({ rule, ...compile(rule.source) }));

  return function route(path: string, request: { host?: string } = {}): RouteResult {
    const host = request.host ?? PRODUCTION_HOST;

    for (const { rule, matcher, keys } of redirects) {
      if (!conditionsHold(rule.has, host)) continue;
      const match = matcher.exec(path);
      if (!match) continue;
      const status = rule.statusCode ?? (rule.permanent ? 308 : 307);
      return { type: "redirect", status, location: fill(rule.destination, match, keys) };
    }

    const headers: Record<string, string> = {};
    for (const { rule, matcher } of headerRules) {
      if (!conditionsHold(rule.has, host) || !matcher.test(path)) continue;
      for (const { key, value } of rule.headers) headers[key.toLowerCase()] = value;
    }

    if (exists?.(path)) return { type: "file", headers };

    let current = path;
    for (const { rule, matcher, keys } of rewrites) {
      if (!conditionsHold(rule.has, host)) continue;
      const match = matcher.exec(current);
      if (!match) continue;
      const destination = fill(rule.destination, match, keys);
      if (!exists || exists(destination.split("?")[0])) return { type: "rewrite", destination, headers };
      current = destination.split("?")[0];
    }
    return { type: "unmatched", headers };
  };
}

/** One or two concrete addresses a source pattern matches: "/account/:path*" → /account/sample, /account/sample/deeper. */
export function sampleAddresses(source: string): string[] {
  if (/[()?+]/.test(source)) throw new Error(`Can't make a sample address for the pattern "${source}".`);
  const shallow = source.replace(/:\w+\*?/g, "sample");
  const deep = source.replace(/:\w+\*/g, "sample/deeper").replace(/:\w+/g, "sample");
  return [...new Set([shallow, deep])];
}

/** An address and where vercel.json has to send it. */
export interface ExpectedPage {
  path: string;
  destination: string;
}

/**
 * Every page the site has, from its three registries: the prerendered
 * content pages (src/seo/routes.ts — pass their paths in), the app-only
 * pages and the catalog pages (src/seo/appRoutes.ts). The homepage isn't
 * listed: it is dist/index.html itself and needs no rule.
 */
export function expectedPages(prerenderedPaths: string[]): ExpectedPage[] {
  return [
    ...prerenderedPaths.filter((path) => path !== "/").map((path) => ({ path, destination: `${path}/index.html` })),
    ...APP_SHELL_ROUTES.flatMap((source) => sampleAddresses(source).map((path) => ({ path, destination: "/spa.html" }))),
    ...CATALOG_ROUTES.flatMap(({ source, destination }) =>
      sampleAddresses(source).map((path) => ({ path, destination: destination.replace(/:\w+/g, "sample") })),
    ),
  ];
}

/** Addresses no page has. If vercel.json rewrites one of these, it has a catch-all again. */
const UNKNOWN_ADDRESSES = ["/no-such-page", "/no-such-page/deeper", "/shop/no-such-page/deeper"];

/**
 * What's wrong with vercel.json, in plain sentences; empty when every page
 * is served from where it should be and unknown addresses are left to the
 * 404 page.
 */
export function routingProblems(config: VercelRoutingConfig, pages: ExpectedPage[]): string[] {
  const route = createRouter(config);
  const problems: string[] = [];

  for (const { path, destination } of pages) {
    const result = route(path);
    if (result.type === "redirect") {
      problems.push(`${path} is redirected to ${result.location}, but it is a page: it should be served from ${destination}.`);
    } else if (result.type !== "rewrite") {
      problems.push(`${path} has no rewrite, so it would be "404 Not Found" on the live site. Add one to ${destination}.`);
    } else if (result.destination !== destination) {
      problems.push(`${path} is rewritten to ${result.destination}; it should go to ${destination}.`);
    }
  }

  for (const path of UNKNOWN_ADDRESSES) {
    const result = route(path);
    if (result.type === "rewrite") {
      problems.push(
        `${path} isn't a page, but it is rewritten to ${result.destination}. A catch-all rewrite answers every mistyped or retired address with "200 OK"; name the page's own address instead.`,
      );
    }
  }
  return problems;
}
