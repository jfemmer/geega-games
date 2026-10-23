// Saving review changes to scanned cards, in order.
//
// Scan Review saves each change to a card as it's made: a price when the
// field is left, a condition key, a picked printing, approving. Each is its
// own request, and requests can finish in any order. So a card's changes go
// one at a time, in the order they were made (keyedQueue), and each builds
// on the newest copy of the card (newestScan) rather than the one on screen
// when it was asked for. That way approving a card a moment after typing its
// price keeps that price, instead of filling in today's Scryfall price over
// it, and pressing a condition key then Enter approves the card as that
// condition, not the default one.
//
// Plain TypeScript: no React, no I/O.

/** Runs a job after the earlier jobs for the same key; see keyedQueue. */
export type KeyedQueue = <T>(key: string, job: (earlierFailed: boolean) => Promise<T>) => Promise<T>;

/**
 * Runs jobs one at a time per key, in the order they were queued. A job
 * starts once the key's earlier jobs have finished, whether or not they
 * worked, and is told whether any of them failed since the key last had
 * nothing queued. Its result, or its error, comes back to the caller.
 */
export function keyedQueue(): KeyedQueue {
  const lines = new Map<string, { last: Promise<void>; failed: boolean }>();
  return <T>(key: string, job: (earlierFailed: boolean) => Promise<T>): Promise<T> => {
    let line = lines.get(key);
    if (!line) {
      line = { last: Promise.resolve(), failed: false };
      lines.set(key, line);
    }
    const queue = line;
    const result = queue.last.then(() => job(queue.failed));
    const done = result.then(
      () => undefined,
      () => {
        queue.failed = true;
      },
    );
    queue.last = done;
    void done.then(() => {
      // Nothing was queued after this job, so the key starts afresh.
      if (queue.last === done) lines.delete(key);
    });
    return result;
  };
}

/**
 * The newest copy of a card: the one on screen, or what its latest save
 * returned when that's at least as new (a save the screen hasn't caught up
 * with yet). The database stamps every change to a card (updated_at), so a
 * reload that brought something newer wins; a copy without a stamp counts as
 * new.
 */
export function newestScan<T extends { updatedAt?: string | null }>(shown: T, saved: Partial<T> | undefined): T {
  if (!saved) return shown;
  const savedAt = Date.parse(saved.updatedAt ?? "");
  const shownAt = Date.parse(shown.updatedAt ?? "");
  return savedAt < shownAt ? shown : { ...shown, ...saved };
}
