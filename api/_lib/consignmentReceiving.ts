import type { StaffContext } from "./adminAuth.js";
import { logAdminAction } from "./auditLog.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { HttpError } from "./http.js";
import {
  CARD_CONDITIONS,
  normalizeCondition,
  normalizeFinish,
  type CardCondition,
  type ReceiveLineInput,
  type ResolvedLine,
} from "../../src/store/lib/consignmentReceiving.js";

// Receiving consigned cards: matching each line to one exact printing in the
// local Scryfall data (scryfall_bulk_cards), checking it comes in the finish
// given, and recording the batch (consignment_receive) and each inspection
// step (consignment_inspect_lot). Nothing the browser sends about a card's
// name, set, rarity or image is trusted: it all comes from the printing.

type Admin = ReturnType<typeof getSupabaseAdmin>;

const MAX_LINES = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BulkRow {
  scryfall_id: string;
  oracle_id: string | null;
  card_name: string;
  set_code: string;
  set_name: string | null;
  collector_number: string;
  lang: string;
  rarity: string | null;
  finishes: string[] | null;
  image_uris: { normal?: string; small?: string } | null;
  card_faces: { image_uris?: { normal?: string } }[] | null;
  prices: { usd?: string | null; usd_foil?: string | null; usd_etched?: string | null } | null;
}

const BULK_SELECT =
  "scryfall_id, oracle_id, card_name, set_code, set_name, collector_number, lang, rarity, finishes, image_uris:raw->image_uris, card_faces:raw->card_faces, prices:raw->prices";

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const cents = (v: unknown): number | null | undefined =>
  v === null || v === undefined || v === "" ? null : typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100_000_000 ? v : undefined;

function priceFor(row: BulkRow, finish: string): number | null {
  const raw = finish === "foil" ? row.prices?.usd_foil : finish === "etched" ? row.prices?.usd_etched : row.prices?.usd;
  if (!raw) return null;
  const n = Math.round(Number(raw) * 100);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const label = (r: BulkRow) => `${r.card_name} (${r.set_code.toUpperCase()} ${r.collector_number})`;

/** Read the browser's lines, refusing anything malformed. */
export function readLines(value: unknown): ReceiveLineInput[] {
  if (!Array.isArray(value) || value.length === 0) throw new HttpError(400, "Add at least one card.");
  if (value.length > MAX_LINES) throw new HttpError(400, `Receive up to ${MAX_LINES} lines at a time.`);
  return value.map((v, i) => {
    if (typeof v !== "object" || v === null) throw new HttpError(400, `Line ${i + 1} isn't valid.`);
    const r = v as Record<string, unknown>;
    return {
      scryfallId: str(r.scryfallId, 40),
      name: str(r.name, 200),
      setCode: str(r.setCode, 12),
      collectorNumber: str(r.collectorNumber, 20),
      language: str(r.language, 5),
      finish: str(r.finish, 20),
      condition: str(r.condition, 30),
      quantity: typeof r.quantity === "number" ? r.quantity : Number(r.quantity),
      listPriceCents: r.listPriceCents as number | null,
      minPriceCents: r.minPriceCents as number | null,
      notes: str(r.notes, 500),
      sourceRow: typeof r.sourceRow === "number" ? r.sourceRow : null,
    };
  });
}

/** Match each line to one printing and check it. Lines keep their order. */
export async function resolveLines(admin: Admin, lines: ReceiveLineInput[]): Promise<ResolvedLine[]> {
  const byId = new Map<string, BulkRow>();
  const bySetNumber = new Map<string, BulkRow[]>();
  const byName = new Map<string, BulkRow[]>();

  const ids = [...new Set(lines.map((l) => l.scryfallId).filter((v): v is string => !!v && UUID.test(v)))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from("scryfall_bulk_cards").select(BULK_SELECT).in("scryfall_id", ids.slice(i, i + 200));
    if (error) throw new HttpError(500, "Could not look up the cards.");
    for (const r of (data ?? []) as unknown as BulkRow[]) byId.set(r.scryfall_id, r);
  }

  const bySet = new Map<string, Set<string>>();
  for (const l of lines) {
    if (l.scryfallId || !l.setCode || !l.collectorNumber) continue;
    const set = l.setCode.toLowerCase();
    if (!bySet.has(set)) bySet.set(set, new Set());
    bySet.get(set)!.add(l.collectorNumber);
  }
  for (const [set, numbers] of bySet) {
    const { data, error } = await admin.from("scryfall_bulk_cards").select(BULK_SELECT).eq("set_code", set).in("collector_number", [...numbers]);
    if (error) throw new HttpError(500, "Could not look up the cards.");
    for (const r of (data ?? []) as unknown as BulkRow[]) {
      const k = `${r.set_code}|${r.collector_number}`;
      bySetNumber.set(k, [...(bySetNumber.get(k) ?? []), r]);
    }
  }

  // Name-only lines (optionally with a set): every English printing with that
  // exact name, in that set when one is given.
  const nameKey = (l: ReceiveLineInput) => `${l.name!.toLowerCase()}|${l.setCode?.toLowerCase() ?? ""}`;
  const nameLines = lines.filter((l) => !l.scryfallId && !(l.setCode && l.collectorNumber) && l.name);
  for (const key of new Set(nameLines.map(nameKey))) {
    const [name, set] = key.split("|");
    let q = admin
      .from("scryfall_bulk_cards")
      .select(BULK_SELECT)
      .ilike("card_name", name.replace(/[%_\\]/g, (m) => `\\${m}`))
      .eq("lang", "en");
    if (set) q = q.eq("set_code", set);
    const { data, error } = await q.limit(200);
    if (error) throw new HttpError(500, "Could not look up the cards.");
    byName.set(key, (data ?? []) as unknown as BulkRow[]);
  }

  return lines.map((l, index) => {
    const problems: string[] = [];
    const lang = (l.language ?? "en").toLowerCase();
    let row: BulkRow | null = null;
    if (l.scryfallId) {
      row = UUID.test(l.scryfallId) ? (byId.get(l.scryfallId) ?? null) : null;
      if (!row) problems.push("That Scryfall ID isn't a known printing.");
    } else if (l.setCode && l.collectorNumber) {
      const found = bySetNumber.get(`${l.setCode.toLowerCase()}|${l.collectorNumber}`) ?? [];
      row = found.find((r) => r.lang === lang) ?? null;
      if (!row) problems.push(`No printing ${l.setCode.toUpperCase()} #${l.collectorNumber}${lang !== "en" ? ` in ${lang}` : ""}. Check the set code and collector number.`);
      else if (l.name && row.card_name.toLowerCase() !== l.name.toLowerCase() && !row.card_name.toLowerCase().startsWith(`${l.name.toLowerCase()} //`)) {
        problems.push(`${l.setCode.toUpperCase()} #${l.collectorNumber} is ${row.card_name}, not ${l.name}.`);
      }
    } else if (l.name) {
      const found = byName.get(nameKey(l)) ?? [];
      if (found.length === 1) row = found[0];
      else if (found.length === 0) problems.push(`No card named "${l.name}"${l.setCode ? ` in ${l.setCode.toUpperCase()}` : ""}.`);
      else problems.push(`"${l.name}" has ${found.length} printings${l.setCode ? ` in ${l.setCode.toUpperCase()}` : ""}. Add the set and collector number, or pick it with the card search.`);
    } else {
      problems.push("Give the card's name, or its set and collector number.");
    }

    const finish = normalizeFinish(l.finish ?? "nonfoil");
    if (!finish) problems.push(`Unknown finish "${l.finish}".`);
    else if (row && row.finishes && row.finishes.length > 0 && !row.finishes.includes(finish)) {
      problems.push(`${label(row)} doesn't come in ${finish === "nonfoil" ? "non-foil" : finish}. It comes in: ${row.finishes.join(", ")}.`);
    }
    const condition = l.condition ? normalizeCondition(l.condition) : null;
    if (condition === undefined) problems.push(`Unknown condition "${l.condition}". Use ${CARD_CONDITIONS.join(", ")}.`);
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 9999) problems.push("Quantity must be a whole number from 1 to 9,999.");
    const list = cents(l.listPriceCents);
    const min = cents(l.minPriceCents);
    if (list === undefined) problems.push("The list price isn't valid.");
    if (min === undefined) problems.push("The minimum price isn't valid.");
    if (typeof list === "number" && typeof min === "number" && min > list) problems.push("The minimum price is above the list price.");
    if (list === 0) problems.push("The list price must be above $0.");

    const image = row ? (row.image_uris?.normal ?? row.card_faces?.[0]?.image_uris?.normal ?? null) : null;
    return {
      index,
      sourceRow: l.sourceRow ?? null,
      ok: problems.length === 0,
      problems,
      printing: row
        ? {
            scryfallId: row.scryfall_id,
            oracleId: row.oracle_id,
            cardName: row.card_name,
            setCode: row.set_code,
            setName: row.set_name,
            collectorNumber: row.collector_number,
            rarity: row.rarity,
            imageUrl: image,
            language: row.lang,
            finishes: row.finishes ?? [],
          }
        : null,
      finish: finish ?? "nonfoil",
      declaredCondition: (condition ?? null) as CardCondition | null,
      quantity: l.quantity,
      marketPriceCents: row && finish ? priceFor(row, finish) : null,
      listPriceCents: typeof list === "number" ? list : null,
      minPriceCents: typeof min === "number" ? min : null,
      notes: l.notes ?? null,
    };
  });
}

function dbError(error: { code?: string; message?: string } | null, fallback: string): HttpError {
  const code = error?.code ?? "";
  if (/^GC04[0-9]$/.test(code)) return new HttpError(code === "GC041" ? 404 : code === "GC042" || code === "GC044" || code === "GC047" ? 409 : 400, error!.message!);
  return new HttpError(500, fallback);
}

export async function previewReceive(admin: Admin, body: Record<string, unknown>) {
  const lines = readLines(body.lines);
  const resolved = await resolveLines(admin, lines);
  return { lines: resolved, ok: resolved.every((l) => l.ok), copies: resolved.reduce((n, l) => n + (Number.isInteger(l.quantity) ? l.quantity : 0), 0) };
}

export async function receiveCards(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const consignmentId = typeof body.consignmentId === "string" && UUID.test(body.consignmentId) ? body.consignmentId : null;
  if (!consignmentId) throw new HttpError(400, "Choose a consignment.");
  const resolved = await resolveLines(admin, readLines(body.lines));
  const bad = resolved.filter((l) => !l.ok);
  if (bad.length) {
    const where = (l: ResolvedLine) => (l.sourceRow ? `row ${l.sourceRow}` : `line ${l.index + 1}`);
    throw new HttpError(400, `Fix ${bad.length} line${bad.length === 1 ? "" : "s"} first: ${bad.slice(0, 3).map((l) => `${where(l)}: ${l.problems[0]}`).join(" ")}`);
  }
  const method = body.method === "in_person" ? "in_person" : "mail";
  const payload = resolved.map((l) => ({
    scryfallId: l.printing!.scryfallId,
    oracleId: l.printing!.oracleId,
    cardName: l.printing!.cardName,
    setCode: l.printing!.setCode,
    setName: l.printing!.setName,
    collectorNumber: l.printing!.collectorNumber,
    rarity: l.printing!.rarity,
    imageUrl: l.printing!.imageUrl,
    language: l.printing!.language,
    finish: l.finish,
    declaredCondition: l.declaredCondition,
    quantity: l.quantity,
    marketPriceCents: l.marketPriceCents,
    listPriceCents: l.listPriceCents,
    minPriceCents: l.minPriceCents,
    notes: l.notes,
  }));
  const { data: batchId, error } = await admin.rpc("consignment_receive", {
    p_consignment_id: consignmentId,
    p_lines: payload,
    p_method: method,
    p_carrier: str(body.carrier, 60) ?? "",
    p_tracking: str(body.trackingNumber, 60) ?? "",
    p_notes: str(body.notes, 2000) ?? "",
    p_actor: staff.email ?? "staff",
  });
  if (error || !batchId) throw dbError(error, "Could not record the cards.");
  await logAdminAction(admin, staff, {
    action: "consignment.receive",
    resourceType: "consignment",
    resourceId: consignmentId,
    after: { batchId, lines: payload.length, copies: payload.reduce((n, l) => n + l.quantity, 0), method },
  });
  return { batchId: batchId as string, lines: payload.length };
}

const INSPECT_ACTIONS = ["start", "accept", "reject", "reopen"] as const;

export async function inspectLot(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const lotId = typeof body.lotId === "string" && UUID.test(body.lotId) ? body.lotId : null;
  if (!lotId) throw new HttpError(400, "Choose a card line.");
  // `action` is the router's own field ("inspectLot"); the inspection step is `step`.
  const action = INSPECT_ACTIONS.find((a) => a === body.step);
  if (!action) throw new HttpError(400, "Choose an inspection step.");
  const condition = body.condition == null || body.condition === "" ? null : normalizeCondition(String(body.condition));
  if (condition === undefined) throw new HttpError(400, "Choose a condition.");
  const finish = body.finish == null || body.finish === "" ? null : normalizeFinish(String(body.finish));
  if (body.finish != null && body.finish !== "" && !finish) throw new HttpError(400, "Choose a finish.");
  const int = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isInteger(v) ? (v as number) : NaN);
  const qty = int(body.quantityAccepted);
  const list = int(body.listPriceCents);
  const min = int(body.minPriceCents);
  if ([qty, list, min].some((n) => Number.isNaN(n))) throw new HttpError(400, "Quantities and prices must be whole numbers.");
  const { data: status, error } = await admin.rpc("consignment_inspect_lot", {
    p_lot_id: lotId,
    p_action: action,
    p_quantity_accepted: qty as number,
    p_condition: condition as CardCondition,
    p_finish: finish as never,
    p_list_price_cents: list as number,
    p_min_price_cents: min as number,
    p_reason: str(body.reason, 500) ?? "",
    p_allow_below_minimum: body.allowBelowMinimum === true,
    p_actor: staff.email ?? "staff",
  });
  if (error || !status) throw dbError(error, "Could not update that card line.");
  await logAdminAction(admin, staff, {
    action: `consignment.lot.${action}`,
    resourceType: "consignment_lot",
    resourceId: lotId,
    after: { status, quantityAccepted: qty, condition, finish, listPriceCents: list, minPriceCents: min, reason: str(body.reason, 500) },
  });
  return { status: status as string };
}
