import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabasePublic } from "./_lib/supabasePublic.js";
import { loadSpaShell } from "./_lib/spaShell.js";
import {
  SET_SUMMARY_LIMIT,
  buildCardPage,
  buildInvalidPage,
  buildSetPage,
  findSet,
  parseCatalogRequest,
  renderCatalogHtml,
  toCardDetail,
  toSetCards,
  type CatalogPage,
  type CatalogRequest,
} from "./_lib/catalogPage.js";

// GET /shop/card/:slug and /shop/set/:code — rewritten here by vercel.json
// (see src/seo/appRoutes.ts for how every storefront address is served).
//
// These pages depend on live inventory, so they can't be prerendered at build
// time like the content pages. Without this function they were served as the
// bare app shell: every card page's HTML carried the homepage's title and
// nothing else until JavaScript ran — which is all that link previews and
// most crawlers ever see.
//
// So this fills the shell in per request: the page's own title, description,
// canonical URL, share-preview image and structured data (from the same
// builders the React pages use — src/seo/catalog.ts), an early fetch of the
// card's picture, plus a plain summary for readers without JavaScript. The
// app then starts exactly as before and renders the page; nothing about how
// it looks or works changes.
//
//   * A card page's ?listing=<id> address (one per copy for sale, used by
//     the structured data and the product feed) puts that copy first.
//
//   * A card that isn't listed, or a set with nothing in stock, is a real 404.
//   * It reads through the publishable key — the same public functions, under
//     the same row-level security, as a signed-out visitor's browser — so it
//     can only say what the storefront itself would show.
//   * Answers are cached at Vercel's edge for a few minutes, so a crawl or a
//     shared link doesn't run the function (or the database) on every hit.
//   * If the lookup fails, the plain shell is served — what this address
//     returned before this function existed — and the app loads the page.
//
// Three response headers say what happened, for checking a live deployment:
//   X-GG-Page      filled | not-found | plain-shell
//   X-GG-Shell     bundle | fetch     (where the shell came from, see spaShell.ts)
//   X-GG-Address   path | query       (where the address was read from)

const FOUND_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";
const NOT_FOUND_CACHE = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
const REDIRECT_CACHE = "public, max-age=0, s-maxage=86400";
const LOOKUP_TIMEOUT_MS = 3000;

async function lookUp(request: CatalogRequest): Promise<CatalogPage> {
  const db = getSupabasePublic();
  const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);

  if (request.kind === "card") {
    const { data, error } = await db.rpc("get_card_detail", { p_slug: request.slug }).abortSignal(signal);
    if (error) throw new Error(error.message);
    return buildCardPage(request.slug, toCardDetail(data), request.listing ?? null);
  }

  // The same two calls the set page makes in the browser (ShopSetPage.tsx).
  const [sets, cards] = await Promise.all([
    db.rpc("shop_sets_with_counts").abortSignal(signal),
    db
      .rpc("search_inventory", {
        p_sets: [request.code.toUpperCase()],
        p_in_stock_only: true,
        p_sort: "name_asc",
        p_limit: SET_SUMMARY_LIMIT,
        p_offset: 0,
      })
      .abortSignal(signal),
  ]);
  if (sets.error) throw new Error(sets.error.message);
  // The list of cards is a nicety; the page still stands without it.
  if (cards.error) console.error("[catalog-page] set card list unavailable:", cards.error.message);
  return buildSetPage(request.code, findSet(sets.data, request.code), cards.error ? [] : toSetCards(cards.data));
}

function requestHost(req: VercelRequest): string | undefined {
  const forwarded = req.headers["x-forwarded-host"];
  const host = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.headers.host;
  return typeof host === "string" ? host : undefined;
}

function sendHtml(req: VercelRequest, res: VercelResponse, status: number, html: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.method === "HEAD") return res.status(status).end();
  return res.status(status).send(html);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).send("Method not allowed");
  }

  // req.query is a getter that parses the URL with Node's legacy url.parse(),
  // which prints a deprecation warning into the error log the first time it
  // runs. The address is normally read from the path, so it's only asked for
  // when that fails.
  const parsed = parseCatalogRequest({ url: req.url, query: () => req.query });
  res.setHeader("X-GG-Address", parsed.source);

  if (parsed.type === "redirect") {
    res.setHeader("Location", parsed.location);
    res.setHeader("Cache-Control", REDIRECT_CACHE);
    return res.status(308).end();
  }

  const shell = await loadSpaShell(requestHost(req));
  if (!shell) {
    // Without the shell there is no app to hand over to. Say so honestly
    // (crawlers retry a 503) and offer a way onward that needs no function.
    console.error("[catalog-page] app shell unavailable");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Retry-After", "60");
    return sendHtml(
      req,
      res,
      503,
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">' +
        "<title>Geega Games</title></head><body><p>This page is having trouble loading. Please try again in a moment, " +
        'or <a href="/shop">browse the shop</a>.</p></body></html>',
    );
  }
  res.setHeader("X-GG-Shell", shell.source);

  let page: CatalogPage;
  if (parsed.type === "invalid") {
    page = buildInvalidPage(parsed.kind);
  } else {
    try {
      page = await lookUp(parsed.request);
    } catch (err) {
      console.error("[catalog-page] lookup failed, serving the plain shell:", err);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-GG-Page", "plain-shell");
      return sendHtml(req, res, 200, shell.html);
    }
  }

  res.setHeader("Cache-Control", page.status === 200 ? FOUND_CACHE : NOT_FOUND_CACHE);
  res.setHeader("X-GG-Page", page.status === 200 ? "filled" : "not-found");
  return sendHtml(req, res, page.status, renderCatalogHtml(shell.html, page));
}
