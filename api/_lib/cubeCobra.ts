import { HttpError } from "./http.js";

// Thin server-side CubeCobra client for the admin Cube Checklist.
//
// The browser can't call CubeCobra itself (no CORS), so /api/admin/cube-list
// fetches here and returns a normalized card list. CubeCobra has no versioned
// public API; we read two long-standing endpoints and fall back between them:
//
//   1. /cube/api/cubeJSON/:id  -> full cube JSON (names + type + color info)
//   2. /cube/api/cubelist/:id  -> plain text, one card name per line
//
// The parsers are pure so they're unit-tested against both shapes
// (tests/cubeCobra.test.ts).

const BASE = "https://cubecobra.com";
const REQUEST_TIMEOUT_MS = 8000;

const HEADERS = {
  Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
  "User-Agent": "GeegaGames/1.0 (+https://geega-games.com)",
};

/** CubeCobra cube ids / short ids: letters, digits, dash, underscore. */
export const CUBE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

export interface CubeCard {
  name: string;
  /** Type line, e.g. "Creature — Elf Druid" (null when unknown). */
  type: string | null;
  /** CubeCobra color category, e.g. "White", "Multicolored", "Lands" (null when unknown). */
  colorCategory: string | null;
  /** CubeCobra draft rating (Elo from picks across all its drafts), when sent. */
  elo?: number | null;
  /** How many picks the rating rests on (0 = no data; the rating is then CubeCobra's default). */
  pickCount?: number | null;
  /** Mana value, when sent. */
  cmc?: number | null;
}

export interface CubeList {
  cubeId: string;
  name: string | null;
  cards: CubeCard[];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** One card entry from cubeJSON (shape varies across CubeCobra versions). */
function cardFromJson(raw: unknown): CubeCard | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const details = (c.details && typeof c.details === "object"
    ? c.details
    : {}) as Record<string, unknown>;
  const name = str(details.name) ?? str(c.name);
  if (!name) return null;
  const elo = num(details.elo);
  return {
    name,
    type: str(c.type_line) ?? str(details.type),
    colorCategory: str(c.colorCategory) ?? str(details.colorcategory),
    elo: elo == null ? null : Math.round(elo),
    pickCount: num(details.pickCount),
    cmc: num(c.cmc) ?? num(details.cmc),
  };
}

/**
 * Parse CubeCobra's cubeJSON. Newer cubes keep cards in
 * `cards.mainboard`; older exports used a flat `cards` array.
 */
export function parseCubeJson(json: unknown): { name: string | null; cards: CubeCard[] } {
  if (!json || typeof json !== "object") return { name: null, cards: [] };
  const root = json as Record<string, unknown>;
  const rawCards = root.cards;
  let list: unknown[] = [];
  if (Array.isArray(rawCards)) {
    list = rawCards;
  } else if (rawCards && typeof rawCards === "object") {
    const mainboard = (rawCards as Record<string, unknown>).mainboard;
    if (Array.isArray(mainboard)) list = mainboard;
  }
  const cards = list.map(cardFromJson).filter((c): c is CubeCard => c !== null);
  return { name: str(root.name), cards };
}

/** Parse the plain-text cubelist: one card name per line. */
export function parseCubeListText(text: string): CubeCard[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((name) => ({ name, type: null, colorCategory: null }));
}

async function get(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: HEADERS, signal: controller.signal });
  } catch {
    throw new HttpError(502, "Couldn't reach CubeCobra. Please try again.");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Draft ratings for a cube's mainboard (cubeJSON only; the text list has
 * none). Empty when CubeCobra sends no ratings.
 */
export async function fetchCubeRatings(cubeId: string): Promise<CubeCard[]> {
  if (!CUBE_ID_RE.test(cubeId)) throw new HttpError(400, "Invalid cube id.");
  const res = await get(`${BASE}/cube/api/cubeJSON/${encodeURIComponent(cubeId)}`);
  if (!res.ok) throw new HttpError(502, `CubeCobra returned an error (${res.status}).`);
  return parseCubeJson(await res.json()).cards.filter((c) => c.elo != null);
}

/** Fetch a cube's mainboard from CubeCobra. */
export async function fetchCubeList(cubeId: string): Promise<CubeList> {
  if (!CUBE_ID_RE.test(cubeId)) {
    throw new HttpError(400, "Invalid cube id.");
  }
  const id = encodeURIComponent(cubeId);

  // 1. Rich JSON.
  try {
    const res = await get(`${BASE}/cube/api/cubeJSON/${id}`);
    if (res.status === 404) throw new HttpError(404, "Cube not found on CubeCobra.");
    if (res.ok) {
      const parsed = parseCubeJson(await res.json());
      if (parsed.cards.length > 0) return { cubeId, ...parsed };
    }
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) throw err;
    // Anything else: fall through to the text endpoint.
  }

  // 2. Plain-text list.
  const res = await get(`${BASE}/cube/api/cubelist/${id}`);
  if (res.status === 404) throw new HttpError(404, "Cube not found on CubeCobra.");
  if (!res.ok) throw new HttpError(502, `CubeCobra returned an error (${res.status}).`);
  const cards = parseCubeListText(await res.text());
  if (cards.length === 0) throw new HttpError(502, "CubeCobra returned an empty card list.");
  return { cubeId, name: null, cards };
}
