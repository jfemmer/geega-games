// Filling the app's HTML template (index.html) with one page's head tags and
// markup. Shared by the build-time prerender (scripts/prerender.ts), which
// fills the freshly built template, and the catalog function
// (api/catalog-page.ts), which refills the neutral shell the prerender wrote.
// Pure module — string work only.

/** The per-page tags sit between these two comments in <head>. */
export const HEAD_START = "<!--seo-head-->";
export const HEAD_END = "<!--/seo-head-->";
/** Where the page's markup goes, inside the app's root element. */
export const APP_MARKER = "<!--app-html-->";
/** What the root element looks like once a shell has been written without markup. */
const EMPTY_ROOT = '<div id="root"></div>';

/**
 * React 19 emits resource hints (e.g. <link rel="preload" as="image">) at the
 * start of a render that has no <head>. Move them into the real head.
 */
function splitLeadingLinks(html: string): { links: string; body: string } {
  const match = /^(?:\s*<link\b[^>]*>)+/.exec(html);
  if (!match) return { links: "", body: html };
  return { links: match[0].trim(), body: html.slice(match[0].length) };
}

/** True when `html` has both head markers, in order — i.e. it can be (re)filled. */
export function hasHeadMarkers(html: string): boolean {
  const start = html.indexOf(HEAD_START);
  return start !== -1 && html.indexOf(HEAD_END, start) > start;
}

function replaceHead(html: string, head: string): string {
  const start = html.indexOf(HEAD_START);
  const end = html.indexOf(HEAD_END, start);
  return html.slice(0, start + HEAD_START.length) + `\n    ${head}\n    ` + html.slice(end);
}

/** The built template with one page's head tags and markup. */
export function fillTemplate(template: string, head: string, appHtml: string): string {
  const { links, body } = splitLeadingLinks(appHtml);
  const headHtml = links ? `${head}\n    ${links}` : head;
  return replaceHead(template, headHtml).replace(APP_MARKER, () => body);
}

/**
 * A shell that fillTemplate already wrote (its app marker is gone and its
 * root is empty), given different head tags and, optionally, markup inside
 * the root. The app replaces whatever is in the root when it starts.
 */
export function refillShell(shell: string, head: string, rootHtml = ""): string {
  const withHead = replaceHead(shell, head);
  if (!rootHtml) return withHead;
  return withHead.replace(EMPTY_ROOT, () => `<div id="root">${rootHtml}</div>`);
}
