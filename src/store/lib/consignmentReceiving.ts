// Receiving consigned cards: the line format shared by the admin screens and
// the API, reading a CSV into lines, and normalizing finishes and
// conditions. Pure module (no React, browser, Node or Supabase imports).
//
// CSV columns (header names are matched loosely, in any order):
//   name | card | card name                  the card's name
//   set | set code | edition                 set code (CMR) — strongly recommended
//   collector number | collector # | number  collector number — with the set,
//                                            identifies the exact printing
//   finish | foil                            nonfoil / foil / etched (yes/no works too)
//   condition                                NM, LP, MP, HP, DMG (the consignor's claim)
//   quantity | qty | count                   copies
//   list price | price                       your intended list price, in dollars
//   min price | minimum price                the consignor's minimum, in dollars
//   language | lang                          en by default
//   notes                                    staff notes
// Scryfall ID is also accepted (scryfall id) and wins over everything else.

export type CardFinish = "nonfoil" | "foil" | "etched" | "glossy" | "ripple" | "surge" | "rainbow" | "galaxy" | "textured" | "mana" | "gilded" | "halo";
export type CardCondition = "NM" | "LP" | "MP" | "HP" | "DMG";

export const CARD_FINISHES: readonly CardFinish[] = ["nonfoil", "foil", "etched", "glossy", "ripple", "surge", "rainbow", "galaxy", "textured", "mana", "gilded", "halo"];
export const CARD_CONDITIONS: readonly CardCondition[] = ["NM", "LP", "MP", "HP", "DMG"];

/** One line to receive, before the server matches it to a printing. */
export interface ReceiveLineInput {
  scryfallId?: string | null;
  name?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
  language?: string | null;
  finish?: string | null;
  condition?: string | null;
  quantity: number;
  listPriceCents?: number | null;
  minPriceCents?: number | null;
  notes?: string | null;
  /** The CSV row it came from, for messages. */
  sourceRow?: number | null;
}

/** A line matched to an exact printing, as the server returns it. */
export interface ResolvedLine {
  index: number;
  sourceRow: number | null;
  ok: boolean;
  problems: string[];
  printing: {
    scryfallId: string;
    oracleId: string | null;
    cardName: string;
    setCode: string;
    setName: string | null;
    collectorNumber: string;
    rarity: string | null;
    imageUrl: string | null;
    language: string;
    finishes: string[];
  } | null;
  finish: CardFinish;
  declaredCondition: CardCondition | null;
  quantity: number;
  marketPriceCents: number | null;
  listPriceCents: number | null;
  minPriceCents: number | null;
  notes: string | null;
}

export function normalizeFinish(value: string | null | undefined): CardFinish | null {
  const v = (value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (["", "nonfoil", "normal", "regular", "no", "n", "false", "0"].includes(v)) return "nonfoil";
  if (["foil", "yes", "y", "true", "1", "traditionalfoil"].includes(v)) return "foil";
  if (["etched", "etchedfoil", "foiletched"].includes(v)) return "etched";
  return (CARD_FINISHES as readonly string[]).includes(v) ? (v as CardFinish) : null;
}

export function normalizeCondition(value: string | null | undefined): CardCondition | null | undefined {
  const v = (value ?? "").trim().toLowerCase().replace(/\s+(foil|non-?foil|holo)$/i, "").replace(/[\s_-]+/g, "");
  if (!v) return null;
  const map: Record<string, CardCondition> = {
    nm: "NM", nearmint: "NM", mint: "NM", m: "NM",
    lp: "LP", lightlyplayed: "LP", sp: "LP", slightlyplayed: "LP", ex: "LP", excellent: "LP",
    mp: "MP", moderatelyplayed: "MP", played: "MP", vg: "MP",
    hp: "HP", heavilyplayed: "HP", poor: "HP",
    dmg: "DMG", damaged: "DMG", d: "DMG",
  };
  return map[v] ?? undefined;
}

/** "12.50" / "$1,234" → cents; "" → null; not money → undefined. */
export function dollarsToCents(value: string | null | undefined): number | null | undefined {
  const t = (value ?? "").replace(/[$,\s]/g, "");
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  const [w, f = ""] = t.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}

// ---------------------------------------------------------------- CSV

/** RFC 4180-ish: quoted fields, doubled quotes, commas, tabs or semicolons. */
export function parseCsvRows(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const HEADERS: Record<string, keyof ColumnMap> = {
  name: "name", card: "name", cardname: "name", "card name": "name", product: "name", productname: "name",
  set: "set", setcode: "set", "set code": "set", edition: "set", editioncode: "set",
  collectornumber: "number", "collector number": "number", "collector #": "number", "collector#": "number", number: "number", cn: "number", "card number": "number",
  finish: "finish", foil: "finish", printing: "finish",
  condition: "condition", cond: "condition",
  quantity: "quantity", qty: "quantity", count: "quantity", "add to quantity": "quantity",
  listprice: "list", "list price": "list", price: "list", "your price": "list",
  minprice: "min", "min price": "min", "minimum price": "min", minimum: "min",
  language: "language", lang: "language",
  notes: "notes", note: "notes",
  scryfallid: "scryfall", "scryfall id": "scryfall",
};

type ColumnMap = { name?: number; set?: number; number?: number; finish?: number; condition?: number; quantity?: number; list?: number; min?: number; language?: number; notes?: number; scryfall?: number };

export interface CsvParseResult {
  lines: ReceiveLineInput[];
  /** Rows that couldn't be read at all, with why. */
  problems: { row: number; message: string }[];
  columns: (keyof ColumnMap)[];
}

export function parseReceiveCsv(text: string): CsvParseResult {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return { lines: [], problems: [{ row: 1, message: "The file is empty." }], columns: [] };
  const map: ColumnMap = {};
  rows[0].forEach((h, i) => {
    const key = HEADERS[h.trim().toLowerCase()] ?? HEADERS[h.trim().toLowerCase().replace(/[\s_-]+/g, "")];
    if (key && map[key] === undefined) map[key] = i;
  });
  const problems: { row: number; message: string }[] = [];
  if (map.name === undefined && map.scryfall === undefined && (map.set === undefined || map.number === undefined)) {
    return {
      lines: [],
      problems: [{ row: 1, message: "The first row must be headers, including Name (or Set and Collector number). See the template." }],
      columns: Object.keys(map) as (keyof ColumnMap)[],
    };
  }
  const cell = (r: string[], k: keyof ColumnMap) => (map[k] === undefined ? "" : (r[map[k]!] ?? "").trim());
  const lines: ReceiveLineInput[] = [];
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const qtyText = cell(r, "quantity");
    const quantity = qtyText === "" ? 1 : Number(qtyText);
    const list = dollarsToCents(cell(r, "list"));
    const min = dollarsToCents(cell(r, "min"));
    const finish = normalizeFinish(cell(r, "finish"));
    const condition = normalizeCondition(cell(r, "condition"));
    const bad: string[] = [];
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) bad.push(`quantity "${qtyText}"`);
    if (list === undefined) bad.push(`list price "${cell(r, "list")}"`);
    if (min === undefined) bad.push(`minimum price "${cell(r, "min")}"`);
    if (finish === null) bad.push(`finish "${cell(r, "finish")}"`);
    if (condition === undefined) bad.push(`condition "${cell(r, "condition")}"`);
    if (bad.length) {
      problems.push({ row: rowNo, message: `Couldn't read ${bad.join(", ")}.` });
      return;
    }
    lines.push({
      scryfallId: cell(r, "scryfall") || null,
      name: cell(r, "name") || null,
      setCode: cell(r, "set") || null,
      collectorNumber: cell(r, "number") || null,
      language: cell(r, "language") || null,
      finish,
      condition: condition ?? null,
      quantity,
      listPriceCents: list ?? null,
      minPriceCents: min ?? null,
      notes: cell(r, "notes") || null,
      sourceRow: rowNo,
    });
  });
  return { lines, problems, columns: Object.keys(map) as (keyof ColumnMap)[] };
}

export const RECEIVE_CSV_TEMPLATE =
  "Name,Set,Collector Number,Finish,Condition,Quantity,List Price,Min Price,Notes\n" +
  "Sol Ring,CMR,472,nonfoil,NM,2,3.50,,\n" +
  "Arcane Signet,CMR,297,foil,LP,1,4.00,3.00,Slight edge wear\n";
