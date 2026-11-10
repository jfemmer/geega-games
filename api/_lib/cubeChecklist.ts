import { randomBytes } from "node:crypto";
import { HttpError } from "./http.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { fetchCubeList } from "./cubeCobra.js";
import { scryfallSearchCards, scryfallSearchPage } from "./scryfall.js";
import { normalizeScryfallCards } from "../../src/admin/services/scryfall.js";
import type { ScryfallCard } from "../../src/admin/services/scryfall.types.js";
import type { CardPrinting } from "../../src/admin/types/index.js";
import {
  CHECKLIST_LIMITS,
  colorCategoryFor,
  defaultRarityRule,
  exactNameTerm,
  mainType,
  normalizeName,
  rarityClause,
  type ChecklistAdminSummary,
  type ChecklistCard,
  type ChecklistView,
  type RarityRule,
  type SwapOption,
} from "../../src/store/lib/cubeChecklist.js";

// Cube checklists — everything both endpoints share:
//   api/cube-checklist.ts          the public share link (secret token)
//   api/admin/cube-checklists.ts   staff (create, share settings, delete)
// Both run card actions through runCardAction(), so the share page and the
// admin page can do exactly the same things and the rules (rarity, no
// duplicates) are enforced once, here.

const CARD_COLUMNS =
  "id, position, name, type_line, color_category, original_name, original_type_line, original_color_category, swapped_by, swapped_at, found_by, found_at, updated_at";
const LIST_COLUMNS = "id, name, cube_id, rarity_rule, share_token, share_enabled, created_at, updated_at";

/** Re-send a little of what came just before `since`, so nothing in flight is missed. */
const SYNC_OVERLAP_MS = 15_000;
const SUGGESTION_COUNT = 8;
const SEARCH_COUNT = 12;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

type CardRow = {
  id: string;
  position: number;
  name: string;
  type_line: string | null;
  color_category: string | null;
  original_name: string | null;
  original_type_line: string | null;
  original_color_category: string | null;
  swapped_by: string | null;
  swapped_at: string | null;
  found_by: string | null;
  found_at: string | null;
  updated_at: string;
};

export type ListRow = {
  id: string;
  name: string;
  cube_id: string;
  rarity_rule: string;
  share_token: string;
  share_enabled: boolean;
  created_at: string;
  updated_at: string;
};

/** Front-face colors (double-faced cards keep them on the face). */
function faceColors(c: ScryfallCardExtra): string[] | undefined {
  return (c.card_faces?.[0] as { colors?: string[] } | undefined)?.colors;
}

type ScryfallCardExtra = ScryfallCard & {
  colors?: string[];
  color_identity?: string[];
  cmc?: number;
  edhrec_rank?: number;
};

function db() {
  return getSupabaseAdmin();
}

function dbError(error: { message: string; code?: string } | null): never {
  if (error?.code === "23505") {
    throw new HttpError(409, "That card is already on the list.");
  }
  throw new HttpError(500, "The checklist couldn't be saved. Please try again.");
}

function toCard(r: CardRow): ChecklistCard {
  return {
    id: r.id,
    position: r.position,
    name: r.name,
    typeLine: r.type_line,
    colorCategory: r.color_category,
    originalName: r.original_name,
    swappedBy: r.swapped_by,
    swappedAt: r.swapped_at,
    foundBy: r.found_by,
    foundAt: r.found_at,
    updatedAt: r.updated_at,
  };
}

function asRule(v: string): RarityRule {
  return v === "common_uncommon" ? "common_uncommon" : "common";
}

/** Trimmed, single-spaced, length-capped text, or null. */
export function cleanText(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, maxLen) : null;
}

export function newShareToken(): string {
  return randomBytes(24).toString("base64url");
}

/* ------------------------------------------------------------------ *
 * Lookups
 * ------------------------------------------------------------------ */

export async function getListById(id: string): Promise<ListRow> {
  if (!UUID_RE.test(id)) throw new HttpError(400, "Invalid checklist id.");
  const { data, error } = await db().from("cube_checklists").select(LIST_COLUMNS).eq("id", id).maybeSingle();
  if (error) dbError(error);
  if (!data) throw new HttpError(404, "Checklist not found.");
  return data as ListRow;
}

/** The checklist a share link opens. Turned-off and unknown links look the same. */
export async function getListByToken(token: unknown): Promise<ListRow> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) {
    throw new HttpError(404, "This checklist link isn't valid.");
  }
  const { data, error } = await db()
    .from("cube_checklists")
    .select(LIST_COLUMNS)
    .eq("share_token", token)
    .maybeSingle();
  if (error) dbError(error);
  if (!data || !data.share_enabled) {
    throw new HttpError(404, "This checklist link isn't valid or has been turned off.");
  }
  return data as ListRow;
}

/** The list and its cards — all of them, or only those changed since `since`. */
export async function loadView(list: ListRow, since?: unknown): Promise<ChecklistView> {
  const syncedAt = new Date().toISOString();
  let q = db()
    .from("cube_checklist_cards")
    .select(CARD_COLUMNS)
    .eq("checklist_id", list.id)
    .order("position", { ascending: true })
    .limit(5000);
  if (typeof since === "string" && !Number.isNaN(Date.parse(since))) {
    q = q.gt("updated_at", new Date(Date.parse(since) - SYNC_OVERLAP_MS).toISOString());
  }
  const { data, error } = await q;
  if (error) dbError(error);
  return {
    id: list.id,
    name: list.name,
    cubeId: list.cube_id,
    rarityRule: asRule(list.rarity_rule),
    cards: ((data ?? []) as CardRow[]).map(toCard),
    syncedAt,
  };
}

async function getCard(list: ListRow, cardId: unknown): Promise<CardRow> {
  if (typeof cardId !== "string" || !UUID_RE.test(cardId)) throw new HttpError(400, "Invalid card.");
  const { data, error } = await db()
    .from("cube_checklist_cards")
    .select(CARD_COLUMNS)
    .eq("checklist_id", list.id)
    .eq("id", cardId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw new HttpError(404, "That card isn't on this checklist anymore.");
  return data as CardRow;
}

async function listNames(list: ListRow): Promise<Set<string>> {
  const { data, error } = await db()
    .from("cube_checklist_cards")
    .select("name")
    .eq("checklist_id", list.id)
    .limit(5000);
  if (error) dbError(error);
  return new Set((data ?? []).map((r) => normalizeName(r.name)));
}

async function updateCard(list: ListRow, cardId: string, patch: Partial<CardRow>): Promise<ChecklistCard> {
  const { data, error } = await db()
    .from("cube_checklist_cards")
    .update(patch)
    .eq("checklist_id", list.id)
    .eq("id", cardId)
    .select(CARD_COLUMNS)
    .single();
  if (error) dbError(error);
  return toCard(data as CardRow);
}

/* ------------------------------------------------------------------ *
 * Scryfall helpers
 * ------------------------------------------------------------------ */

function toOption(c: ScryfallCardExtra): SwapOption {
  const face = c.card_faces?.[0];
  const images = c.image_uris ?? face?.image_uris;
  return {
    name: c.name,
    typeLine: c.type_line ?? face?.type_line ?? null,
    manaCost: c.mana_cost ?? face?.mana_cost ?? null,
    imageSmall: images?.small ?? null,
    imageNormal: images?.normal ?? null,
    edhrecRank: typeof c.edhrec_rank === "number" ? c.edhrec_rank : null,
  };
}

/** The card by exact name, only if it's printed in paper at an allowed rarity. */
async function findAllowedCard(name: string, rule: RarityRule): Promise<ScryfallCardExtra | null> {
  const found = (await scryfallSearchCards(
    `${exactNameTerm(name)} game:paper ${rarityClause(rule)}`,
    "name",
  )) as ScryfallCardExtra[];
  return found.find((c) => normalizeName(c.name) === normalizeName(name)) ?? found[0] ?? null;
}

function colorLetters(colors: string[] | undefined): string {
  const l = (colors ?? []).filter((c) => "WUBRG".includes(c)).join("").toLowerCase();
  return l || "c";
}

/** The Scryfall query for "cards like this one": same colors, type and about the same cost. */
export function similarCardsQuery(card: ScryfallCardExtra, rule: RarityRule): string {
  const parts = [`game:paper`, rarityClause(rule), `-${exactNameTerm(card.name)}`];
  const typeLine = card.type_line ?? card.card_faces?.[0]?.type_line ?? null;
  const type = mainType(typeLine);
  if (type === "Land") {
    parts.push("t:land", `id=${colorLetters(card.color_identity)}`);
  } else {
    const colors = card.colors ?? faceColors(card) ?? card.color_identity;
    parts.push(`c=${colorLetters(colors)}`);
    if (type) parts.push(`t:${type.toLowerCase()}`);
    if (typeof card.cmc === "number") {
      const mv = Math.round(card.cmc);
      parts.push(`mv>=${Math.max(0, mv - 1)}`, `mv<=${mv + 1}`);
    }
  }
  return parts.join(" ");
}

/* ------------------------------------------------------------------ *
 * Card actions (shared by both endpoints)
 * ------------------------------------------------------------------ */

export interface CardActionBody {
  action?: unknown;
  cardId?: unknown;
  found?: unknown;
  newName?: unknown;
  query?: unknown;
  name?: unknown;
  page?: unknown;
  since?: unknown;
  cardIds?: unknown;
}

export type CardActionResult =
  | { view: ChecklistView }
  | { card: ChecklistCard; alreadyFound?: boolean }
  | { cards: ChecklistCard[] }
  | { options: SwapOption[] }
  | { printings: CardPrinting[]; hasMore: boolean };

/** Actions that change the list need a name to credit. */
export const WRITE_ACTIONS = new Set(["found", "swap", "unswap"]);

export async function runCardAction(
  list: ListRow,
  body: CardActionBody,
  actor: string | null,
): Promise<CardActionResult> {
  const rule = asRule(list.rarity_rule);
  const action = String(body.action ?? "");

  if (WRITE_ACTIONS.has(action) && !actor) {
    throw new HttpError(400, "Enter your name first.");
  }

  switch (action) {
    case "get":
      return { view: await loadView(list, body.since) };

    case "found": {
      const card = await getCard(list, body.cardId);
      const found = body.found === true;
      // Someone beat you to it: keep their credit.
      if (found && card.found_at) return { card: toCard(card), alreadyFound: true };
      return {
        card: await updateCard(list, card.id, {
          found_by: found ? actor : null,
          found_at: found ? new Date().toISOString() : null,
        }),
      };
    }

    case "swap": {
      const card = await getCard(list, body.cardId);
      const newName = cleanText(body.newName, CHECKLIST_LIMITS.cardName);
      if (!newName) throw new HttpError(400, "Choose a card to swap in.");
      if (normalizeName(newName) === normalizeName(card.name)) {
        throw new HttpError(400, "That's the card already in this slot.");
      }
      const names = await listNames(list);
      if (names.has(normalizeName(newName))) throw new HttpError(409, `${newName} is already on the list.`);

      const sc = await findAllowedCard(newName, rule);
      if (!sc) {
        throw new HttpError(
          400,
          rule === "common"
            ? `${newName} hasn't been printed at common, so it can't go in this cube.`
            : `${newName} hasn't been printed at common or uncommon, so it can't go in this cube.`,
        );
      }
      const typeLine = sc.type_line ?? sc.card_faces?.[0]?.type_line ?? null;
      const colors = sc.colors ?? faceColors(sc);
      const first = card.original_name == null;
      return {
        card: await updateCard(list, card.id, {
          name: sc.name,
          type_line: typeLine,
          color_category: colorCategoryFor(typeLine, colors),
          // Keep the cube's own card from the first swap, so undo goes back to it.
          original_name: first ? card.name : card.original_name,
          original_type_line: first ? card.type_line : card.original_type_line,
          original_color_category: first ? card.color_category : card.original_color_category,
          swapped_by: actor,
          swapped_at: new Date().toISOString(),
          // A different card hasn't been found yet.
          found_by: null,
          found_at: null,
        }),
      };
    }

    case "unswap": {
      const card = await getCard(list, body.cardId);
      if (!card.original_name) return { card: toCard(card) };
      return {
        card: await updateCard(list, card.id, {
          name: card.original_name,
          type_line: card.original_type_line,
          color_category: card.original_color_category,
          original_name: null,
          original_type_line: null,
          original_color_category: null,
          swapped_by: null,
          swapped_at: null,
          found_by: null,
          found_at: null,
        }),
      };
    }

    case "suggest": {
      const card = await getCard(list, body.cardId);
      // Look the card up without the rarity rule: the cube's own card may not be one.
      const [sc] = (await scryfallSearchCards(`${exactNameTerm(card.name)} game:paper`, "name")) as ScryfallCardExtra[];
      if (!sc) return { options: [] };
      const names = await listNames(list);
      const similar = (await scryfallSearchCards(similarCardsQuery(sc, rule), "edhrec")) as ScryfallCardExtra[];
      return {
        options: similar
          .filter((c) => !names.has(normalizeName(c.name)))
          .slice(0, SUGGESTION_COUNT)
          .map(toOption),
      };
    }

    case "search": {
      const q = cleanText(body.query, CHECKLIST_LIMITS.search);
      if (!q || q.length < 2) return { options: [] };
      // Treat what they typed as part of a name, not Scryfall syntax.
      const term = `name:"${q.replace(/["\\]/g, "")}"`;
      const names = await listNames(list);
      const found = (await scryfallSearchCards(`${term} game:paper ${rarityClause(rule)}`, "edhrec")) as ScryfallCardExtra[];
      return {
        options: found
          .filter((c) => !names.has(normalizeName(c.name)))
          .slice(0, SEARCH_COUNT)
          .map(toOption),
      };
    }

    case "printings": {
      const name = cleanText(body.name, CHECKLIST_LIMITS.cardName);
      if (!name) throw new HttpError(400, "Missing card name.");
      const page = Math.min(20, Math.max(1, Number.parseInt(String(body.page ?? "1"), 10) || 1));
      try {
        const result = await scryfallSearchPage(`${exactNameTerm(name)} game:paper`, page);
        return { printings: normalizeScryfallCards(result.data), hasMore: result.hasMore };
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) return { printings: [], hasMore: false };
        throw err;
      }
    }

    default:
      throw new HttpError(400, "Unknown action.");
  }
}

/* ------------------------------------------------------------------ *
 * Staff-only
 * ------------------------------------------------------------------ */

export async function listSummaries(): Promise<ChecklistAdminSummary[]> {
  const { data, error } = await db()
    .from("cube_checklists")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) dbError(error);
  const lists = (data ?? []) as ListRow[];
  return Promise.all(
    lists.map(async (l) => {
      const [all, found] = await Promise.all([
        db().from("cube_checklist_cards").select("id", { count: "exact", head: true }).eq("checklist_id", l.id),
        db()
          .from("cube_checklist_cards")
          .select("id", { count: "exact", head: true })
          .eq("checklist_id", l.id)
          .not("found_at", "is", null),
      ]);
      return {
        id: l.id,
        name: l.name,
        cubeId: l.cube_id,
        rarityRule: asRule(l.rarity_rule),
        shareToken: l.share_token,
        shareEnabled: l.share_enabled,
        createdAt: l.created_at,
        cardCount: all.count ?? 0,
        foundCount: found.count ?? 0,
      };
    }),
  );
}

/** Copy a CubeCobra cube into a new checklist. */
export async function createChecklist(input: {
  cubeId: string;
  name: string | null;
  rarityRule: RarityRule | null;
  actor: string | null;
}): Promise<ListRow> {
  const cube = await fetchCubeList(input.cubeId);
  // Pauper cubes are commons only, whatever was asked for.
  const rule: RarityRule =
    defaultRarityRule(input.cubeId) === "common" ? "common" : (input.rarityRule ?? "common_uncommon");

  const { data: list, error } = await db()
    .from("cube_checklists")
    .insert({
      name: (input.name ?? cube.name ?? input.cubeId).slice(0, 120),
      cube_id: input.cubeId,
      rarity_rule: rule,
      share_token: newShareToken(),
      created_by: input.actor,
    })
    .select(LIST_COLUMNS)
    .single();
  if (error || !list) dbError(error);

  const seen = new Set<string>();
  const rows = cube.cards
    .filter((c) => {
      const key = normalizeName(c.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c, i) => ({
      checklist_id: list.id,
      position: i,
      name: c.name.slice(0, 200),
      type_line: c.type?.slice(0, 200) ?? null,
      color_category: c.colorCategory?.slice(0, 40) ?? null,
    }));

  for (let i = 0; i < rows.length; i += 500) {
    const { error: insErr } = await db().from("cube_checklist_cards").insert(rows.slice(i, i + 500));
    if (insErr) {
      await db().from("cube_checklists").delete().eq("id", list.id);
      dbError(insErr);
    }
  }
  return list as ListRow;
}

export async function updateChecklist(
  list: ListRow,
  patch: { name?: string | null; shareEnabled?: boolean; rotateToken?: boolean },
): Promise<ListRow> {
  const update: Partial<ListRow> = {};
  if (patch.name) update.name = patch.name.slice(0, 120);
  if (typeof patch.shareEnabled === "boolean") update.share_enabled = patch.shareEnabled;
  if (patch.rotateToken) update.share_token = newShareToken();
  if (Object.keys(update).length === 0) return list;
  const { data, error } = await db()
    .from("cube_checklists")
    .update(update)
    .eq("id", list.id)
    .select(LIST_COLUMNS)
    .single();
  if (error) dbError(error);
  return data as ListRow;
}

export async function deleteChecklist(list: ListRow): Promise<void> {
  const { error } = await db().from("cube_checklists").delete().eq("id", list.id);
  if (error) dbError(error);
}

/** Mark many cards found at once (staff: bring over this browser's old ticks). */
export async function markFoundByName(list: ListRow, names: unknown, actor: string): Promise<number> {
  if (!Array.isArray(names)) throw new HttpError(400, "Missing card names.");
  const wanted = new Set(
    names.filter((n): n is string => typeof n === "string").slice(0, 2000).map(normalizeName),
  );
  const { data, error } = await db()
    .from("cube_checklist_cards")
    .select("id, name")
    .eq("checklist_id", list.id)
    .is("found_at", null)
    .limit(5000);
  if (error) dbError(error);
  const ids = (data ?? []).filter((r) => wanted.has(normalizeName(r.name))).map((r) => r.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { error: upErr } = await db()
      .from("cube_checklist_cards")
      .update({ found_by: actor, found_at: new Date().toISOString() })
      .eq("checklist_id", list.id)
      .is("found_at", null)
      .in("id", ids.slice(i, i + 200));
    if (upErr) dbError(upErr);
  }
  return ids.length;
}
