import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seoRoutes } from "../src/seo/routes";
import { SELL_AREAS, ST_LOUIS_PATH, sellAreaPath } from "../src/seo/sellAreas";
import { GUIDES } from "../src/seo/guides";
import { SERVICE_STATES } from "../src/seo/site";
import { jsonForScript, renderSeoHead } from "../src/seo/head";

// The route registry (src/seo/routes.ts), vercel.json and the prerender must
// agree, or a page silently falls back to the SPA shell (or 404s) in
// production. These checks keep them in lockstep.

type Rewrite = { source: string; destination: string };
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
  rewrites: Rewrite[];
  redirects?: { source: string; destination: string }[];
};

/** Minimal path-to-regexp for the ":param" and "(regex)" forms vercel.json uses. */
function matchSource(source: string, path: string): Record<string, string> | null {
  const names: string[] = [];
  const pattern = source.replace(/:(\w+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  const m = new RegExp(`^${pattern}$`).exec(path);
  if (!m) return null;
  return Object.fromEntries(names.map((n, i) => [n, m[i + 1]]));
}

/** The destination the first matching rewrite sends `path` to. */
function resolveRewrite(path: string): string | null {
  for (const r of vercel.rewrites) {
    const params = matchSource(r.source, path);
    if (params) return r.destination.replace(/:(\w+)/g, (_, n: string) => params[n] ?? "");
  }
  return null;
}

describe("SEO route registry ↔ vercel.json", () => {
  const routes = seoRoutes();

  it("has no duplicate paths", () => {
    const paths = routes.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("rewrites every prerendered route (except /) to its own index.html", () => {
    for (const { path } of routes) {
      if (path === "/") continue; // served directly as dist/index.html
      expect(resolveRewrite(path), path).toBe(`${path}/index.html`);
    }
  });

  it("sends every other storefront path to the neutral SPA shell", () => {
    for (const path of ["/shop/card/force-of-will", "/shop/set/mh2", "/account/orders", "/checkout", "/admin", "/sell/offer"]) {
      expect(resolveRewrite(path), path).toBe("/spa.html");
    }
  });

  it("keeps the sitemap on its function and never rewrites /api", () => {
    expect(resolveRewrite("/sitemap.xml")).toBe("/api/sitemap");
    expect(resolveRewrite("/api/sell/submit")).toBeNull();
  });

  it("covers the St. Louis page, every area and every guide", () => {
    const paths = new Set(routes.map((r) => r.path));
    expect(paths.has(ST_LOUIS_PATH)).toBe(true);
    for (const area of SELL_AREAS) expect(paths.has(sellAreaPath(area.slug))).toBe(true);
    for (const guide of GUIDES) expect(paths.has(`/guides/${guide.slug}`)).toBe(true);
  });
});

describe("sell areas data", () => {
  it("uses unique slugs that don't collide with the St. Louis page", () => {
    const slugs = SELL_AREAS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).not.toContain("st-louis");
  });

  it("links each area to 2–3 real neighbors, never itself", () => {
    for (const area of SELL_AREAS) {
      expect(area.neighbors.length, area.slug).toBeGreaterThanOrEqual(2);
      expect(area.neighbors.length, area.slug).toBeLessThanOrEqual(3);
      expect(area.neighbors, area.slug).not.toContain(area.slug);
      for (const n of area.neighbors) {
        expect(SELL_AREAS.some((a) => a.slug === n), `${area.slug} → ${n}`).toBe(true);
      }
    }
  });

  it("stays inside the stated service area and phrases drive times as approximate", () => {
    for (const area of SELL_AREAS) {
      expect(SERVICE_STATES as readonly string[], area.slug).toContain(area.state);
      expect(area.driveTime, area.slug).toMatch(/^about /);
      expect(area.driveMiles, area.slug).toBeLessThanOrEqual(450);
    }
  });

  it("gives every area its own intro (no city-name-swapped copies)", () => {
    const normalized = SELL_AREAS.map((a) => a.intro.replaceAll(a.city, "CITY"));
    expect(new Set(normalized).size).toBe(SELL_AREAS.length);
    for (const area of SELL_AREAS) expect(area.intro.length, area.slug).toBeGreaterThan(200);
  });
});

describe("renderSeoHead", () => {
  it("gives a page its own canonical, og:url and escaped text", () => {
    const head = renderSeoHead(
      { title: 'Cards & "Things"', description: "<b>x</b>", path: "/sell-my-collection" },
      { origin: "https://geega-games.com" },
    );
    expect(head).toContain('<link rel="canonical" href="https://geega-games.com/sell-my-collection" />');
    expect(head).toContain('<meta property="og:url" content="https://geega-games.com/sell-my-collection" />');
    expect(head).toContain("<title>Cards &amp; &quot;Things&quot;</title>");
    expect(head).toContain('content="&lt;b&gt;x&lt;/b&gt;"');
    expect(head).toContain('content="index, follow"');
  });

  it("leaves the canonical out of the SPA shell and can mark it noindex", () => {
    const shell = renderSeoHead(null);
    expect(shell).not.toContain("canonical");
    expect(shell).not.toContain("og:url");
    expect(renderSeoHead(null, { noIndex: true })).toContain('content="noindex, follow"');
  });

  it("can't be broken out of a JSON-LD script tag", () => {
    const json = jsonForScript({ text: "</script><script>alert(1)</script>" });
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json)).toEqual({ text: "</script><script>alert(1)</script>" });
  });
});
