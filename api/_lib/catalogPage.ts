import { cardPagePath, cardPageSeo, setPagePath, setPageSeo } from "../../src/seo/catalog.js";
import { escapeHtml, renderSeoHead, type PageSEO } from "../../src/seo/head.js";
import { refillShell } from "../../src/seo/template.js";
import { slugifyCardName } from "../../src/store/lib/cardSlug.js";
import { CONDITION_LABELS } from "../../src/store/lib/conditionLabels.js";
import { formatCents } from "../../src/store/lib/money.js";

// What api/catalog-page.ts puts into the app shell for a card page
// (/shop/card/:slug) or a set page (/shop/set/:code): the page's own head
// tags — from the same builders the React pages use (src/seo/catalog.ts) —
// and a plain summary for anything that doesn't run JavaScript.
//
// Pure functions of (address, data): no database, no HTTP. The handler does
// the fetching; these decide the answer, which keeps them easy to test.

// ---- The address -----------------------------------------------------------

export type CatalogKind = "card" | "set";
export type CatalogRequest = { kind: "card"; slug: string } | { kind: "set"; code: string };

/**
 * Where the address was read from: the request's own path ("path"), or the
 * query the vercel.json rewrite adds ("query"). Reported on the response
 * (X-GG-Address) so it can be checked on a live deployment.
 */
export type AddressSource = "path" | "query";

export type ParsedCatalogRequest = { source: AddressSource } & (
  // A well-formed card or set address.
  | { type: "page"; request: CatalogRequest }
  // Right page, wrong spelling (upper-case letters): send it to the real address.
  | { type: "redirect"; location: string }
  // Nothing we could ever have a page for — no need to ask the database.
  | { type: "invalid"; kind: CatalogKind | null }
);

// public.slugify_card_name only ever produces lower-case words joined by
// single hyphens; set codes are short and alphanumeric. The length limits are
// far above anything real (the longest card name is 141 characters, and a
// two-faced card's slug holds both names), so a real card is never refused.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SET_CODE = /^[a-z0-9]{1,12}$/;
const MAX_SLUG_LENGTH = 300;

const CATALOG_PATH = /^\/shop\/(card|set)\/([^/]+)$/;
/** What the vercel.json rewrite adds to the query: never part of the visitor's own address. */
const REWRITE_PARAMS = ["kind", "slug", "code"];

function first(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment; // malformed escape: left as it is, which no slug or code can match
  }
}

function searchFrom(params: URLSearchParams): string {
  for (const name of REWRITE_PARAMS) params.delete(name);
  const search = params.toString();
  return search ? `?${search}` : "";
}

interface RawAddress {
  kind: string;
  raw: string;
  /** The visitor's own query string ("?utm_source=…" or ""), kept across a redirect. */
  search: string;
  source: AddressSource;
}

/** The address as the visitor asked for it, when the request URL still shows it. */
function addressFromPath(url: string | undefined): RawAddress | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url, "http://localhost");
  } catch {
    return null;
  }
  const match = CATALOG_PATH.exec(parsed.pathname);
  if (!match) return null;
  return { kind: match[1], raw: decodeSegment(match[2]), search: searchFrom(parsed.searchParams), source: "path" };
}

/** The address as the rewrite describes it (?kind=card&slug=… or ?kind=set&code=…). */
function addressFromQuery(query: Record<string, unknown>): RawAddress {
  const kind = first(query.kind);
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string") params.append(name, item);
    }
  }
  return { kind, raw: first(kind === "set" ? query.code : query.slug), search: searchFrom(params), source: "query" };
}

/**
 * Which card or set page a request is for.
 *
 * vercel.json rewrites /shop/card/:slug and /shop/set/:code to this function
 * and passes the address along in the query. The request's own path is read
 * first — it is the address the visitor is actually at, so nothing they add
 * to the query string can make the page describe a different card — and the
 * rewrite's query is the fallback for when the path isn't shown.
 */
export function parseCatalogRequest(input: {
  url?: string;
  query: Record<string, unknown>;
}): ParsedCatalogRequest {
  const { kind, raw, search, source } = addressFromPath(input.url) ?? addressFromQuery(input.query);

  if (kind === "card") {
    const slug = raw.toLowerCase();
    if (slug.length > MAX_SLUG_LENGTH || !SLUG.test(slug)) return { type: "invalid", kind, source };
    if (raw !== slug) return { type: "redirect", location: cardPagePath(slug) + search, source };
    return { type: "page", request: { kind, slug }, source };
  }

  if (kind === "set") {
    const code = raw.toLowerCase();
    if (!SET_CODE.test(code)) return { type: "invalid", kind, source };
    if (raw !== code) return { type: "redirect", location: setPagePath(code) + search, source };
    return { type: "page", request: { kind, code }, source };
  }

  return { type: "invalid", kind: null, source };
}

// ---- The data --------------------------------------------------------------

export interface CardListing {
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  condition: string;
  finish: string;
  variantType: string | null;
  imageUrl: string | null;
  priceCents: number | null;
}

/** The parts of public.get_card_detail's answer a server-rendered page uses. */
export interface CardDetail {
  cardName: string;
  listings: CardListing[];
  inStockCount: number;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  typeLine: string | null;
  oracleText: string | null;
}

export interface SetInfo {
  set_code: string;
  set_name: string;
  card_count: number;
}

/** One in-stock listing from public.search_inventory, for a set page's list. */
export interface SetCard {
  name: string;
  condition: string;
  finish: string;
  priceCents: number | null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;
const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;

/**
 * public.get_card_detail returns JSON, so nothing about its shape is
 * guaranteed by a type. Null when there's no such card or the answer isn't
 * recognisable — both mean "we can't describe this card".
 */
export function toCardDetail(value: unknown): CardDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const cardName = text(row.cardName);
  if (!cardName) return null;

  const listings: CardListing[] = [];
  for (const item of Array.isArray(row.listings) ? row.listings : []) {
    if (!item || typeof item !== "object") continue;
    const l = item as Record<string, unknown>;
    listings.push({
      setCode: text(l.setCode),
      setName: text(l.setName),
      collectorNumber: text(l.collectorNumber),
      condition: text(l.condition) ?? "NM",
      finish: text(l.finish) ?? "nonfoil",
      variantType: text(l.variantType),
      imageUrl: text(l.imageUrl),
      priceCents: whole(l.priceCents),
    });
  }

  return {
    cardName,
    listings,
    inStockCount: whole(row.inStockCount) ?? listings.length,
    minPriceCents: whole(row.minPriceCents),
    maxPriceCents: whole(row.maxPriceCents),
    typeLine: text(row.typeLine),
    oracleText: text(row.oracleText),
  };
}

/** The row for `code` among public.shop_sets_with_counts' in-stock sets, if any. */
export function findSet(rows: unknown, code: string): SetInfo | null {
  for (const item of Array.isArray(rows) ? rows : []) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const setCode = text(row.set_code);
    const setName = text(row.set_name);
    if (!setCode || !setName || setCode.toLowerCase() !== code.toLowerCase()) continue;
    return { set_code: setCode, set_name: setName, card_count: whole(row.card_count) ?? 0 };
  }
  return null;
}

export function toSetCards(rows: unknown): SetCard[] {
  const cards: SetCard[] = [];
  for (const item of Array.isArray(rows) ? rows : []) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = text(row.card_name);
    if (!name) continue;
    cards.push({
      name,
      condition: text(row.condition) ?? "NM",
      finish: text(row.finish) ?? "nonfoil",
      priceCents: whole(row.price_cents),
    });
  }
  return cards;
}

// ---- The page --------------------------------------------------------------

export interface CatalogPage {
  /** 404 when there is no such card, or nothing from that set is in stock. */
  status: 200 | 404;
  seo: PageSEO;
  /** Shown only without JavaScript; the app replaces it when it starts. */
  summaryHtml: string;
}

const SHOP_LINK = '<a href="/shop">All Magic: The Gathering singles</a>';
const NEEDS_JAVASCRIPT = "<p>This store needs JavaScript turned on to add cards to your cart.</p>";

function noscript(lines: string[]): string {
  return `<noscript><div class="gg-page">${lines.filter(Boolean).join("")}</div></noscript>`;
}

function conditionLabel(condition: string): string {
  return CONDITION_LABELS[condition] ?? condition;
}

/** "Double Masters 2022 · #393 · Near Mint · foil · $27.00" */
function listingLine(listing: CardListing): string {
  const parts = [
    listing.setName ?? listing.setCode?.toUpperCase() ?? null,
    listing.collectorNumber ? `#${listing.collectorNumber}` : null,
    conditionLabel(listing.condition),
    listing.finish !== "nonfoil" ? listing.finish : null,
    listing.variantType,
    listing.priceCents != null ? formatCents(listing.priceCents) : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function cardPriceLine(detail: CardDetail): string {
  if (detail.listings.length === 0) return "Currently out of stock";
  const range =
    detail.minPriceCents === detail.maxPriceCents
      ? formatCents(detail.minPriceCents)
      : `${formatCents(detail.minPriceCents)} – ${formatCents(detail.maxPriceCents)}`;
  return `${range} · ${detail.inStockCount} listing${detail.inStockCount === 1 ? "" : "s"} in stock`;
}

/** The sets this card's listings come from, each once, as links to their set pages. */
function setLinks(detail: CardDetail): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const listing of detail.listings) {
    const code = listing.setCode?.toLowerCase();
    if (!code || seen.has(code) || !SET_CODE.test(code)) continue;
    seen.add(code);
    links.push(
      `<a href="${escapeHtml(setPagePath(code))}">More from ${escapeHtml(listing.setName ?? code.toUpperCase())}</a>`,
    );
  }
  return links;
}

export function buildCardPage(slug: string, detail: CardDetail | null): CatalogPage {
  const seo = cardPageSeo(slug, detail);
  if (!detail) {
    return {
      status: 404,
      seo,
      summaryHtml: noscript([
        "<h1>Card not found</h1>",
        "<p>We couldn&rsquo;t find that card in our current inventory.</p>",
        `<p>${SHOP_LINK}</p>`,
      ]),
    };
  }

  return {
    status: 200,
    seo,
    summaryHtml: noscript([
      `<h1>${escapeHtml(detail.cardName)}</h1>`,
      detail.typeLine ? `<p>${escapeHtml(detail.typeLine)}</p>` : "",
      detail.oracleText ? `<p>${escapeHtml(detail.oracleText).replace(/\r?\n/g, "<br />")}</p>` : "",
      `<p><strong>${escapeHtml(cardPriceLine(detail))}</strong></p>`,
      detail.listings.length > 0
        ? `<ul>${detail.listings.map((l) => `<li>${escapeHtml(listingLine(l))}</li>`).join("")}</ul>`
        : "",
      NEEDS_JAVASCRIPT,
      `<p>${[...setLinks(detail), SHOP_LINK].join(" · ")}</p>`,
    ]),
  };
}

/** How many of a set's cards the summary lists (the page itself shows them all). */
export const SET_SUMMARY_LIMIT = 100;

export function buildSetPage(code: string, set: SetInfo | null, cards: SetCard[]): CatalogPage {
  const seo = setPageSeo(code, set);
  if (!set) {
    return {
      status: 404,
      seo,
      summaryHtml: noscript([
        "<h1>Set not found</h1>",
        "<p>We don&rsquo;t have any cards from that set in stock right now.</p>",
        `<p><a href="/shop/sets">Browse all sets</a> · ${SHOP_LINK}</p>`,
      ]),
    };
  }

  const items = cards.slice(0, SET_SUMMARY_LIMIT).map((card) => {
    const slug = slugifyCardName(card.name);
    const name = escapeHtml(card.name);
    const link = slug ? `<a href="${escapeHtml(cardPagePath(slug))}">${name}</a>` : name;
    const details = [
      conditionLabel(card.condition),
      card.finish !== "nonfoil" ? card.finish : null,
      card.priceCents != null ? formatCents(card.priceCents) : null,
    ];
    return `<li>${link} · ${escapeHtml(details.filter(Boolean).join(" · "))}</li>`;
  });

  return {
    status: 200,
    seo,
    summaryHtml: noscript([
      `<h1>${escapeHtml(set.set_name)}</h1>`,
      `<p>${set.card_count} listing${set.card_count === 1 ? "" : "s"} in stock.</p>`,
      items.length > 0 ? `<ul>${items.join("")}</ul>` : "",
      NEEDS_JAVASCRIPT,
      `<p><a href="/shop/sets">Browse all sets</a> · ${SHOP_LINK}</p>`,
    ]),
  };
}

/**
 * The page for an address that could never match anything (see
 * parseCatalogRequest): the same "not found" a well-formed address gets when
 * there's no such card or set, so the app and the server say the same thing.
 */
export function buildInvalidPage(kind: CatalogKind | null): CatalogPage {
  if (kind === "card") return buildCardPage("", null);
  if (kind === "set") return buildSetPage("", null, []);
  return {
    status: 404,
    seo: {
      title: "Page Not Found | Geega Games",
      description:
        "That page doesn't exist. Browse Magic: The Gathering singles or sell your cards at Geega Games.",
      path: null,
      noIndex: true,
    },
    summaryHtml: noscript(["<h1>Page not found</h1>", `<p>${SHOP_LINK}</p>`]),
  };
}

/** The shell with this page's head tags and summary in place. */
export function renderCatalogHtml(shell: string, page: CatalogPage): string {
  return refillShell(shell, renderSeoHead(page.seo), page.summaryHtml);
}
