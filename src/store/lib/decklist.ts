import { looksLikeCardListCsv, parseCardListText } from "./sellCardListParser";

// Reads a decklist someone pasted or uploaded into card names, quantities
// and sections. Shared by the deck builder (MyDecksPage) and the yard sale
// page's "Shop your deck". Pure, so tests/parseDecklist.test.ts covers each
// app's export:
//
//   * plain lists: "4 Lightning Bolt", "4x Lightning Bolt" (Scryfall, and
//     MTGGoldfish's text download, whose sideboard follows a blank line)
//   * MTG Arena-style text from Moxfield, ManaBox and MTGGoldfish:
//     "1 Sol Ring (C21) 263", with "*F*" / "*E*" foil and etched marks, any
//     collector number after the set ("ELD-331", "123★"), and the "About" /
//     "Name ..." block and "Commander" / "Deck" / "Sideboard" / "Companion"
//     headings ("SIDEBOARD:" and "Sideboard (15)" too)
//   * Archidekt: "1x Sol Ring (c21) 263 *F* [Ramp] ^Have,#37d67a^", whose
//     [Category] can say where a card goes: [Commander{top}], [Sideboard],
//     [Maybeboard{noDeck}{noPrice}]
//   * TCGplayer Mass Entry: "1 Lightning Bolt [SLD] 84"
//   * TCGplayer and ManaBox collection CSV exports (parseCardListText reads
//     their header row)
//
// Card-name extraction itself is parseCardListText's (shared with the sell
// flow's list upload), so the two can't drift; deck-only concerns —
// sections, categories, foil marks, printings — are handled here first.

export type ParsedCard = {
  name: string;
  quantity: number;
  section: string;
};

// "companion" is read like a section but comes out as sideboard (see the end
// of parseDecklist).
type Section = "commander" | "mainboard" | "sideboard" | "maybeboard" | "companion";

// Section headings as the apps write them. "skip" sections aren't cards to
// build with or buy: Arena's "About" block (its "Name My Deck" line) and
// token lists.
const HEADINGS = new Map<string, Section | "skip">([
  ["commander", "commander"],
  ["commanders", "commander"],
  ["mainboard", "mainboard"],
  ["main deck", "mainboard"],
  ["main", "mainboard"],
  ["deck", "mainboard"],
  ["maindeck", "mainboard"],
  ["sideboard", "sideboard"],
  ["side board", "sideboard"],
  ["maybeboard", "maybeboard"],
  ["maybe board", "maybeboard"],
  ["considering", "maybeboard"],
  ["companion", "companion"],
  ["about", "skip"],
  ["tokens", "skip"],
  ["token", "skip"],
]);

/**
 * A heading line: "Sideboard", "SIDEBOARD:", "Sideboard (15)", or a
 * "Creatures (23)"-style group heading (a name with a card count and no
 * quantity in front), which keeps the current section.
 */
function headingOf(line: string): Section | "skip" | "group" | null {
  const text = line.replace(/:$/, "").trim();
  const counted = /^(\D.*?)\s*\(\d+\)$/.exec(text);
  const heading = HEADINGS.get((counted ? counted[1] : text).trim().toLowerCase());
  if (heading) return heading;
  return counted ? "group" : null;
}

/** One deck line with the parts a deck doesn't need taken off, and the section its Archidekt category names, if any. */
function cleanLine(raw: string): { line: string; section: Section | "skip" | null } {
  let line = raw.replace(/^[-*•]\s*/, "");
  let section: Section | "skip" | null = null;

  // Old "SB: 2 Negate" sideboard lines.
  const sideboard = /^SB:\s*/i.exec(line);
  if (sideboard) {
    section = "sideboard";
    line = line.slice(sideboard[0].length);
  }
  // Archidekt labels at the end: "^Have,#37d67a^".
  line = line.replace(/(?:\s*\^[^^]*\^)+\s*$/, "");
  // Archidekt categories at the end: "[Ramp]", "[Removal,Ramp]",
  // "[Commander{top}]", "[Maybeboard{noDeck}{noPrice}]". A TCGplayer set
  // code ("[SLD]") is capitals and digits only, so a category is told apart
  // by its lowercase letters, spaces, commas or braces.
  const category = /\s*\[([^\]]*)\]\s*$/.exec(line);
  if (category && /[a-z\s,{}]/.test(category[1])) {
    const first = category[1].split(",")[0].replace(/\{.*$/, "").trim().toLowerCase();
    section = HEADINGS.get(first) ?? section;
    line = line.slice(0, category.index).trimEnd();
  }
  // Foil and etched marks: "*F*", "*E*".
  line = line.replace(/\s+\*(?:f|e|foil|etched)\*(?=\s|$)/gi, "");
  // The printing after a set code — "(C21) 263", "[SLD] 84",
  // "(PLST) ELD-331", "(SLD) 123★" — since a deck needs only the name.
  const printing = /^(.*?\S)\s+[([][A-Za-z0-9]{2,6}[)\]](?=\s|$)/.exec(line);
  if (printing) line = printing[1];
  return { line, section };
}

// Kept for lists in an older shape parseCardListText doesn't cover: a
// trailing "Name, 3" / "Name;3" / "Name<tab>3" quantity (no leading digit,
// no "x").
function applyTrailingQuantityFallback(name: string, quantity: number): { name: string; quantity: number } {
  const m = name.match(/^(.+?)[,;\t]\s*([0-9]{1,2})$/);
  if (!m) return { name, quantity };
  return { name: m[1].trim(), quantity: Number(m[2]) || quantity };
}

/**
 * A card name as the shop writes it: straight apostrophes and quotes, "Ae"
 * for "Æ" (as current Oracle names have it), and " // " between the halves
 * of a split or double-faced card.
 */
export function normalizeDeckCardName(name: string): string {
  return name
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/Æ/g, "Ae")
    .replace(/æ/g, "ae")
    .replace(/\s+\/{1,2}\s+/g, " // ")
    .replace(/\s+\*F\*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseDecklist(text: string, maxCopies = 99): ParsedCard[] {
  const bySection = new Map<string, string[]>();

  if (looksLikeCardListCsv(text)) {
    // A CSV export (TCGplayer, ManaBox) has no sections; its header row
    // tells parseCardListText which column is which.
    bySection.set("mainboard", [text]);
  } else {
    let section: Section | "skip" = "mainboard";
    for (const raw of text.replace(/\r/g, "").split("\n")) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

      const heading = headingOf(trimmed);
      if (heading === "group") continue;
      if (heading) {
        section = heading;
        continue;
      }

      const { line, section: lineSection } = cleanLine(trimmed);
      const target = lineSection ?? section;
      if (target === "skip" || !line) continue;
      const list = bySection.get(target) ?? [];
      list.push(line);
      bySection.set(target, list);
    }
  }

  const out: ParsedCard[] = [];
  for (const [sectionName, sectionLines] of bySection) {
    // Grouped per section so a pasted CSV block — header row plus data
    // rows — reaches parseCardListText intact.
    for (const parsed of parseCardListText(sectionLines.join("\n"))) {
      const fallback = applyTrailingQuantityFallback(parsed.cardName, parsed.quantity);
      const name = normalizeDeckCardName(fallback.name);
      if (!name) continue;
      out.push({
        name,
        quantity: Math.max(1, Math.min(fallback.quantity || 1, maxCopies)),
        section: sectionName,
      });
    }
  }

  // Arena lists the companion under "Companion" and again in the sideboard;
  // other exports may list it only under "Companion". Either way it's one
  // sideboard card.
  const sideboardNames = new Set(out.filter((c) => c.section === "sideboard").map((c) => c.name.toLowerCase()));
  const cards = out
    .filter((c) => c.section !== "companion" || !sideboardNames.has(c.name.toLowerCase()))
    .map((c) => (c.section === "companion" ? { ...c, section: "sideboard" } : c));

  const merged = new Map<string, ParsedCard>();
  for (const card of cards) {
    const key = `${card.section}::${card.name.toLowerCase()}`;
    const existing = merged.get(key);
    if (existing) existing.quantity = Math.min(maxCopies, existing.quantity + card.quantity);
    else merged.set(key, { ...card });
  }
  return Array.from(merged.values());
}
