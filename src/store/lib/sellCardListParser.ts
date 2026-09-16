// Pure, network-free parser for a pasted/uploaded card list. Never requires a
// perfect format — it extracts whatever signal it confidently can (quantity,
// set code, collector number, condition, finish) and always preserves the
// original line text, so a line that can't be confidently parsed is still
// carried through rather than dropped. Turning a parsed line into a
// confirmed exact printing is a SEPARATE, async step (see BulkListInput),
// since that needs a network call and this module must stay pure/testable.

export interface ParsedCardLine {
  /** The original, untouched line — always preserved. */
  rawInput: string;
  /** Best-guess card name once quantity/set/condition/finish tokens are stripped. */
  cardName: string;
  quantity: number;
  setCode: string | null;
  collectorNumber: string | null;
  condition: "NM" | "LP" | "MP" | "HP" | "DMG" | null;
  finish: string | null;
}

const CONDITION_WORDS: Record<string, ParsedCardLine["condition"]> = {
  nm: "NM",
  "near mint": "NM",
  lp: "LP",
  "lightly played": "LP",
  mp: "MP",
  "moderately played": "MP",
  hp: "HP",
  "heavily played": "HP",
  dmg: "DMG",
  damaged: "DMG",
};

const FINISH_WORDS = new Set(["foil", "etched"]);

/** Split raw pasted/uploaded text into non-empty, trimmed lines. */
function splitLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * If the line looks like a CSV row with a recognizable header (Card, Set,
 * Collector #, Condition, Finish, Quantity — matching the admin CSV
 * export/import format), split on commas respecting simple quoting. Returns
 * null when the line doesn't look like CSV, so the caller falls back to the
 * free-text heuristics below.
 */
function splitCsvFields(line: string): string[] | null {
  if (!line.includes(",")) return null;
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

const CSV_HEADER_WORDS = new Set([
  "card",
  "name",
  "set",
  "collector",
  "collector #",
  "condition",
  "finish",
  "quantity",
  "qty",
  "price",
  "status",
]);

function looksLikeCsvHeader(fields: string[]): boolean {
  const normalized = fields.map((f) => f.toLowerCase().replace(/#/g, "").trim());
  const matches = normalized.filter((f) => CSV_HEADER_WORDS.has(f) || CSV_HEADER_WORDS.has(`${f} #`));
  return matches.length >= 2;
}

function parseCsvRow(fields: string[], header: string[]): ParsedCardLine {
  const idx = (names: string[]) =>
    header.findIndex((h) => names.includes(h.toLowerCase().trim()));
  const cardIdx = idx(["card", "name"]);
  const setIdx = idx(["set", "set code"]);
  const collectorIdx = idx(["collector #", "collector", "collector number"]);
  const conditionIdx = idx(["condition"]);
  const finishIdx = idx(["finish"]);
  const qtyIdx = idx(["quantity", "qty"]);

  const cardName = (cardIdx >= 0 ? fields[cardIdx] : "") || "";
  const setCode = setIdx >= 0 ? (fields[setIdx] || null) : null;
  const collectorNumber = collectorIdx >= 0 ? (fields[collectorIdx] || null) : null;
  const conditionRaw = conditionIdx >= 0 ? (fields[conditionIdx] || "").toLowerCase() : "";
  const finishRaw = finishIdx >= 0 ? (fields[finishIdx] || "").toLowerCase() : "";
  const qtyRaw = qtyIdx >= 0 ? Number.parseInt(fields[qtyIdx], 10) : NaN;

  return {
    rawInput: fields.join(", "),
    cardName: cardName.trim(),
    quantity: Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1,
    setCode: setCode ? setCode.trim().toUpperCase().slice(0, 10) : null,
    collectorNumber: collectorNumber ? collectorNumber.trim().slice(0, 20) : null,
    condition: CONDITION_WORDS[conditionRaw] ?? null,
    finish: FINISH_WORDS.has(finishRaw) ? finishRaw : null,
  };
}

/** Parse one free-text line like "4 Lightning Bolt [MH2] foil NM". */
function parseFreeTextLine(line: string): ParsedCardLine {
  let remaining = line;
  let quantity = 1;
  let setCode: string | null = null;
  let collectorNumber: string | null = null;
  let condition: ParsedCardLine["condition"] = null;
  let finish: string | null = null;

  // Leading "4x " / "4 " quantity, or trailing " x4" / " *4".
  const leadingQty = remaining.match(/^(\d{1,4})\s*x?\s+/i);
  if (leadingQty) {
    quantity = Number.parseInt(leadingQty[1], 10);
    remaining = remaining.slice(leadingQty[0].length);
  } else {
    const trailingQty = remaining.match(/[\s([]x\s*(\d{1,4})\)?\s*$/i);
    if (trailingQty) {
      quantity = Number.parseInt(trailingQty[1], 10);
      remaining = remaining.slice(0, trailingQty.index).trim();
    }
  }

  // Set code in brackets/parens: [MH2] or (MH2).
  const setMatch = remaining.match(/[[(]([A-Za-z0-9]{2,6})[\])]/);
  if (setMatch) {
    setCode = setMatch[1].toUpperCase();
    remaining = (remaining.slice(0, setMatch.index) + remaining.slice(setMatch.index! + setMatch[0].length)).trim();
  }

  // Collector number: "#138" anywhere, or a bare trailing number only when a
  // set code was already found (e.g. "Lightning Bolt (MH2) 138").
  const hashMatch = remaining.match(/#(\w+)\b/);
  if (hashMatch) {
    collectorNumber = hashMatch[1];
    remaining = (remaining.slice(0, hashMatch.index) + remaining.slice(hashMatch.index! + hashMatch[0].length)).trim();
  } else if (setCode) {
    const trailingNum = remaining.match(/\s(\d{1,4}[a-z★]?)\s*$/i);
    if (trailingNum) {
      collectorNumber = trailingNum[1];
      remaining = remaining.slice(0, trailingNum.index).trim();
    }
  }

  // Condition / finish keywords (word-boundary, case-insensitive), longest
  // phrases first so "near mint" matches before a stray "m".
  const words = Object.keys(CONDITION_WORDS).sort((a, b) => b.length - a.length);
  for (const word of words) {
    const re = new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`, "i");
    const m = remaining.match(re);
    if (m) {
      condition = CONDITION_WORDS[word];
      remaining = (remaining.slice(0, m.index) + remaining.slice(m.index! + m[0].length)).trim();
      break;
    }
  }
  for (const word of FINISH_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    const m = remaining.match(re);
    if (m) {
      finish = word;
      remaining = (remaining.slice(0, m.index) + remaining.slice(m.index! + m[0].length)).trim();
      break;
    }
  }

  // Clean up leftover punctuation from stripped tokens (dangling commas,
  // empty parens, double spaces).
  const cardName = remaining
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,\-–—]+|[\s,\-–—]+$/g, "")
    .trim();

  return {
    rawInput: line,
    cardName,
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, 100_000) : 1,
    setCode,
    collectorNumber,
    condition,
    finish,
  };
}

/**
 * Parse a whole pasted/uploaded card list. Handles a CSV-with-header block
 * (matching the admin export/import format) OR free-text lines — detected
 * per-file by checking whether the FIRST non-empty line looks like a CSV
 * header. Never throws; a line that yields no usable name still comes back
 * with its rawInput intact so nothing the seller pasted is silently dropped.
 */
export function parseCardListText(text: string): ParsedCardLine[] {
  const lines = splitLines(text);
  if (lines.length === 0) return [];

  const firstFields = splitCsvFields(lines[0]);
  if (firstFields && looksLikeCsvHeader(firstFields)) {
    const header = firstFields.map((f) => f.toLowerCase().trim());
    return lines.slice(1).map((line) => {
      const fields = splitCsvFields(line) ?? [line];
      return parseCsvRow(fields, header);
    });
  }

  return lines.map(parseFreeTextLine);
}
