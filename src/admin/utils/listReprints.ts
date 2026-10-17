// "The List" reprints (Scryfall's set PLST) look exactly like the printing
// they copy: same art, same frame, the original's own set symbol and
// collector line. All that tells them apart is a small planeswalker symbol in
// the card's bottom-left corner. Scryfall numbers them after the original
// ("ORI-153" is The List's copy of Magic Origins #153).
//
// So in a scan neither picture matching nor reading the collector number can
// tell the two apart, and when the List copy happens to match a little
// better (a newer, sharper Scryfall scan), it can look like a sure match. The
// shop's first big batch had 10 Magic Origins Lightning Javelins, 9 of them
// picked as The List's copy. The original is far more common, so it's listed
// first and neither is matched automatically.
//
// Shared by the server's auto-match decision (api/_lib/recognition) and the
// review screens. Pure: no React, no I/O.

export interface PrintingRef {
  setCode: string;
  collectorNumber: string;
}

/** "ORI-153" → Magic Origins #153. */
const COPIED_NUMBER = /^([A-Za-z0-9]{2,6})-([A-Za-z0-9★†]+)$/;

/** The printing a List-style reprint copies, read from its collector number (null when it isn't one). */
export function listReprintOriginal(printing: PrintingRef): PrintingRef | null {
  const match = COPIED_NUMBER.exec(printing.collectorNumber.trim());
  if (!match) return null;
  return { setCode: match[1].toUpperCase(), collectorNumber: match[2] };
}

/** True when `reprint` is a List-style copy of `original`. */
export function isListReprintOf(reprint: PrintingRef, original: PrintingRef): boolean {
  const copied = listReprintOriginal(reprint);
  return (
    copied !== null &&
    copied.setCode === original.setCode.trim().toUpperCase() &&
    copied.collectorNumber.toLowerCase() === original.collectorNumber.trim().toLowerCase()
  );
}

export interface ListTie<T> {
  original: T;
  reprint: T;
}

/**
 * Candidates (best first) with every List-style reprint that ranks above its
 * own original placed just behind it, the two at the same confidence (the
 * higher of theirs), so neither clears an auto-match margin over the other.
 * Returns the new order and the pairs that were moved. A reprint already
 * ranked below its original is left alone.
 */
export function preferOriginals<T extends { confidence: number }>(
  ranked: T[],
  ref: (candidate: T) => PrintingRef,
): { ranked: T[]; ties: ListTie<T>[] } {
  const out = ranked.slice();
  const ties: ListTie<T>[] = [];
  for (let i = 0; i < out.length; i++) {
    const reprint = out[i];
    const j = out.findIndex((c, k) => k > i && isListReprintOf(ref(reprint), ref(c)));
    if (j < 0) continue;
    const confidence = Math.max(reprint.confidence, out[j].confidence);
    const original = { ...out[j], confidence };
    const movedReprint = { ...reprint, confidence };
    out.splice(j, 1);
    out.splice(i, 1, original, movedReprint);
    ties.push({ original, reprint: movedReprint });
    i++; // past the reprint, now at i + 1
  }
  return { ranked: out, ties };
}

/** "ORI #153" */
export function printingLabel(p: PrintingRef): string {
  return `${p.setCode.toUpperCase()} #${p.collectorNumber}`;
}

/** What staff should look for, naming both printings. */
export function listTieAdvice(original: PrintingRef, reprint: PrintingRef): string {
  return (
    `${printingLabel(original)} or The List's copy of it (${printingLabel(reprint)}): they look the same in a scan. ` +
    `The List copy has a small planeswalker symbol in the bottom-left corner; without one, it's ${printingLabel(original)}.`
  );
}
