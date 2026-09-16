// Pure pairing logic — mirrors the server's pairUploads() (api/_lib/scan.ts)
// convention: front and back of one physical card share a sequenceHint. Kept
// pure and dependency-free so it's trivial to unit test without touching the
// filesystem, chokidar, or a real scan session.
//
// Convention documented in README.md's PaperStream IP profile setup: the
// fi-8170's duplex ADF feeds one physical stack, and PaperStream writes one
// file per PAGE in strict feed order — front of card 1, back of card 1,
// front of card 2, back of card 2, ... With DUPLEX=true (the default), this
// pairing treats the files (already sorted by filename/sequence number) as
// alternating front/back pairs. With DUPLEX=false, every file is its own
// front-only card — for a single-sided batch, or a scanner/profile that
// can't guarantee strict alternation.

export interface PairedCard {
  sequenceHint: number;
  front: string | null;
  back: string | null;
}

export function pairScannedFiles(sortedFilePaths: string[], duplex: boolean): PairedCard[] {
  if (!duplex) {
    return sortedFilePaths.map((front, i) => ({ sequenceHint: i + 1, front, back: null }));
  }
  const pairs: PairedCard[] = [];
  for (let i = 0; i < sortedFilePaths.length; i += 2) {
    pairs.push({
      sequenceHint: pairs.length + 1,
      front: sortedFilePaths[i] ?? null,
      back: sortedFilePaths[i + 1] ?? null,
    });
  }
  return pairs;
}

/**
 * Sort filenames the way PaperStream actually names sequential pages:
 * a fixed prefix followed by a zero-padded number (e.g. "img_00042.tif").
 * Plain lexical sort breaks once the counter crosses a digit-width boundary
 * (img_9.tif vs img_10.tif) — extract the trailing number and sort on that.
 */
export function sortScannedFileNames(fileNames: string[]): string[] {
  function trailingNumber(name: string): number {
    const match = name.match(/(\d+)(?=\.[^.]+$)/);
    return match ? Number.parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
  }
  return [...fileNames].sort((a, b) => {
    const na = trailingNumber(a);
    const nb = trailingNumber(b);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });
}
