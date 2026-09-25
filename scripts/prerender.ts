// Build step (runs after `vite build` and `vite build --ssr`, see package.json):
// writes static HTML for every route in src/seo/routes.ts so search engines,
// AI crawlers and link previews get each page's real title, canonical URL,
// structured data and content without running JavaScript.
//
// Before this, every URL served the same index.html: the homepage's title and
// a canonical pointing at the homepage, with an empty <body>, until the app
// ran and rewrote it client-side.
//
// Output (all inside dist/):
//   index.html            the homepage, prerendered
//   <route>/index.html    each other SEO route (vercel.json rewrites to these)
//   spa.html              neutral shell for every other path: card/set pages,
//                         account, checkout, admin… No canonical, so the one
//                         useSEO sets is the only one Google sees.
//   404.html              a missing /sell-magic-cards/:area or /guides/:slug
//
// Fails the build (non-zero exit) rather than ship a partial or broken site.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { seoRoutes } from "../src/seo/routes.js";
import { renderSeoHead, type PageSEO } from "../src/seo/head.js";

interface PrerenderModule {
  siteUrl: string;
  renderPage: (path: string) => { html: string; seo: PageSEO | null };
}

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const SSR_ENTRY = join(ROOT, "dist-ssr", "prerender.js");

const HEAD_START = "<!--seo-head-->";
const HEAD_END = "<!--/seo-head-->";
const APP_MARKER = "<!--app-html-->";

function outputFile(path: string): string {
  return path === "/" ? join(DIST, "index.html") : join(DIST, path.slice(1), "index.html");
}

/**
 * React 19 emits resource hints (e.g. <link rel="preload" as="image">) at the
 * start of a render that has no <head>. Move them into the real head.
 */
function splitLeadingLinks(html: string): { links: string; body: string } {
  const match = /^(?:\s*<link\b[^>]*>)+/.exec(html);
  if (!match) return { links: "", body: html };
  return { links: match[0].trim(), body: html.slice(match[0].length) };
}

function fillTemplate(template: string, head: string, appHtml: string): string {
  const start = template.indexOf(HEAD_START);
  const end = template.indexOf(HEAD_END);
  const { links, body } = splitLeadingLinks(appHtml);
  const headHtml = links ? `${head}\n    ${links}` : head;
  return (
    template.slice(0, start + HEAD_START.length) +
    `\n    ${headHtml}\n    ` +
    template.slice(end)
  ).replace(APP_MARKER, body);
}

async function writePage(file: string, html: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html, "utf8");
}

async function main(): Promise<void> {
  const template = await readFile(join(DIST, "index.html"), "utf8");
  for (const marker of [HEAD_START, HEAD_END, APP_MARKER]) {
    if (!template.includes(marker)) {
      throw new Error(`dist/index.html is missing the ${marker} marker (see index.html).`);
    }
  }
  const moduleScript = /<script type="module"[^>]*src="\/assets\/[^"]+"[^>]*><\/script>/.exec(template)?.[0];
  if (!moduleScript) throw new Error("dist/index.html has no built module script — did `vite build` run?");

  const { renderPage, siteUrl } = (await import(pathToFileURL(SSR_ENTRY).href)) as PrerenderModule;

  // The neutral shell first: vercel.json's catch-all serves it for every
  // path that isn't prerendered, so it must exist even if a route fails.
  await writePage(join(DIST, "spa.html"), fillTemplate(template, renderSeoHead(null), ""));

  const notFound = renderPage("/__not-found__");
  await writePage(join(DIST, "404.html"), fillTemplate(template, renderSeoHead(null, { noIndex: true }), notFound.html));

  const failures: string[] = [];
  for (const route of seoRoutes()) {
    const { html, seo } = renderPage(route.path);
    if (!seo) {
      failures.push(`${route.path}: the page never called useSEO (or the route isn't wired up in App.tsx)`);
      continue;
    }
    if (seo.path !== route.path) {
      failures.push(`${route.path}: useSEO declared path "${seo.path}"`);
      continue;
    }
    if (seo.noIndex) {
      failures.push(`${route.path}: marked noIndex — remove it from src/seo/routes.ts or drop noIndex`);
      continue;
    }
    await writePage(outputFile(route.path), fillTemplate(template, renderSeoHead(seo, { origin: siteUrl }), html));
  }

  if (failures.length) {
    throw new Error(`Prerender failed for ${failures.length} route(s):\n  ${failures.join("\n  ")}`);
  }
  console.log(`[prerender] wrote ${seoRoutes().length} pages + spa.html + 404.html`);
}

main().then(
  // The SSR bundle creates a Supabase client whose timers can keep Node alive.
  () => process.exit(0),
  (err: unknown) => {
    console.error("[prerender]", err);
    process.exit(1);
  },
);
