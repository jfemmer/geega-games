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
//   spa.html              neutral shell for the app-only pages (login,
//                         account, checkout… — src/seo/appRoutes.ts). No
//                         canonical, so the one useSEO sets is the only one
//                         Google sees. api/catalog-page.ts also starts from it
//                         for card and set pages, filling in their own tags.
//   404.html              what Vercel serves, with a 404 status, for any
//                         address nothing else answers
//   admin.html            the admin dashboard's shell: spa.html plus the
//                         installable-app tags (see scripts/adminShell.ts)
//
// Before writing anything it checks that vercel.json serves every one of
// those pages (scripts/vercelRoutes.ts): vercel.json has no catch-all, so a
// page it doesn't name would be a 404 on the live site.
//
// Fails the build (non-zero exit) rather than ship a partial or broken site.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { seoRoutes } from "../src/seo/routes.js";
import { renderSeoHead, type PageSEO } from "../src/seo/head.js";
import { APP_MARKER, HEAD_END, HEAD_START, fillTemplate } from "../src/seo/template.js";
import { ADMIN_APP_HEAD, toAdminShell } from "./adminShell.js";
import { expectedPages, routingProblems, type VercelRoutingConfig } from "./vercelRoutes.js";

interface PrerenderModule {
  siteUrl: string;
  renderPage: (path: string) => { html: string; seo: PageSEO | null };
}

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const SSR_ENTRY = join(ROOT, "dist-ssr", "prerender.js");

function outputFile(path: string): string {
  return path === "/" ? join(DIST, "index.html") : join(DIST, path.slice(1), "index.html");
}

async function writePage(file: string, html: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html, "utf8");
}

/** Stop the build if vercel.json would leave a real page unserved (or serve unknown addresses). */
async function checkRouting(): Promise<void> {
  const config = JSON.parse(await readFile(join(ROOT, "vercel.json"), "utf8")) as VercelRoutingConfig;
  const problems = routingProblems(config, expectedPages(seoRoutes().map((route) => route.path)));
  if (problems.length) {
    throw new Error(
      `vercel.json doesn't match the site's pages (see src/seo/appRoutes.ts):\n  ${problems.join("\n  ")}`,
    );
  }
}

async function main(): Promise<void> {
  await checkRouting();

  const template = await readFile(join(DIST, "index.html"), "utf8");
  for (const marker of [HEAD_START, HEAD_END, APP_MARKER]) {
    if (!template.includes(marker)) {
      throw new Error(`dist/index.html is missing the ${marker} marker (see index.html).`);
    }
  }
  const moduleScript = /<script type="module"[^>]*src="\/assets\/[^"]+"[^>]*><\/script>/.exec(template)?.[0];
  if (!moduleScript) throw new Error("dist/index.html has no built module script — did `vite build` run?");

  const { renderPage, siteUrl } = (await import(pathToFileURL(SSR_ENTRY).href)) as PrerenderModule;

  // The neutral shell first: vercel.json serves it for every app-only page
  // and the catalog function builds on it, so it must exist even if a route
  // fails.
  await writePage(join(DIST, "spa.html"), fillTemplate(template, renderSeoHead(null), ""));
  await writePage(join(DIST, "admin.html"), toAdminShell(fillTemplate(template, ADMIN_APP_HEAD, "")));

  // The not-found page, with its own title and no canonical (it stands in for
  // any address), always marked noindex.
  const notFound = renderPage("/__not-found__");
  if (!notFound.html.includes("Page not found")) {
    throw new Error("The not-found page didn't render — is NotFoundPage still the router's fallback?");
  }
  await writePage(
    join(DIST, "404.html"),
    fillTemplate(template, renderSeoHead(notFound.seo, { noIndex: true }), notFound.html),
  );

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
    // Search Console / Bing Webmaster Tools ownership codes, from Vercel env
    // vars, on the homepage only (that's where both tools look).
    const verification =
      route.path === "/"
        ? {
            google: process.env.SEO_GOOGLE_SITE_VERIFICATION,
            bing: process.env.SEO_BING_SITE_VERIFICATION,
          }
        : undefined;
    await writePage(
      outputFile(route.path),
      fillTemplate(template, renderSeoHead(seo, { origin: siteUrl, verification }), html),
    );
  }

  if (failures.length) {
    throw new Error(`Prerender failed for ${failures.length} route(s):\n  ${failures.join("\n  ")}`);
  }
  console.log(`[prerender] wrote ${seoRoutes().length} pages + spa.html + admin.html + 404.html`);
}

main().then(
  // The SSR bundle creates a Supabase client whose timers can keep Node alive.
  () => process.exit(0),
  (err: unknown) => {
    console.error("[prerender]", err);
    process.exit(1);
  },
);
