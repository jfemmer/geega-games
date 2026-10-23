import { describe, expect, it } from "vitest";
import { keyedQueue, newestScan } from "../src/admin/utils/scanSaves";

// Scan Review saves each change to a card as it's made. A card's changes go
// one at a time, in order, and each builds on the newest copy of the card,
// so approving right after typing a price keeps that price.

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("keyedQueue", () => {
  it("runs one card's jobs one at a time, in the order they were queued", async () => {
    const queue = keyedQueue();
    const log: string[] = [];
    const slowSave = deferred<string>();
    const save = queue("card-1", async () => {
      log.push("save starts");
      const result = await slowSave.promise;
      log.push("save done");
      return result;
    });
    const approve = queue("card-1", async () => {
      log.push("approve starts");
      return "approved";
    });
    await settle();
    expect(log).toEqual(["save starts"]);

    slowSave.resolve("saved");
    await expect(save).resolves.toBe("saved");
    await expect(approve).resolves.toBe("approved");
    expect(log).toEqual(["save starts", "save done", "approve starts"]);
  });

  it("doesn't hold up other cards", async () => {
    const queue = keyedQueue();
    const started: string[] = [];
    const slow = deferred<void>();
    const first = queue("card-1", async () => {
      started.push("card-1");
      await slow.promise;
    });
    const second = queue("card-2", async () => {
      started.push("card-2");
    });
    await second;
    expect(started).toEqual(["card-1", "card-2"]);
    slow.resolve();
    await first;
  });

  it("carries on after a failed job, telling the ones that waited for it", async () => {
    const queue = keyedQueue();
    const told: boolean[] = [];
    const failing = queue("card-1", async () => {
      throw new Error("Failed to fetch");
    });
    const after = queue("card-1", async (earlierFailed) => {
      told.push(earlierFailed);
      return "saved";
    });
    await expect(failing).rejects.toThrow("Failed to fetch");
    await expect(after).resolves.toBe("saved");
    expect(told).toEqual([true]);

    // Once nothing is queued for the card, it starts afresh.
    await settle();
    await queue("card-1", async (earlierFailed) => {
      told.push(earlierFailed);
    });
    expect(told).toEqual([true, false]);
  });

  it("tells a job everything before it worked", async () => {
    const queue = keyedQueue();
    const told: boolean[] = [];
    const first = queue("card-1", async () => "saved");
    const second = queue("card-1", async (earlierFailed) => {
      told.push(earlierFailed);
    });
    await Promise.all([first, second]);
    expect(told).toEqual([false]);
  });
});

describe("newestScan", () => {
  const shown = { id: "s1", priceCents: null as number | null, confirmedCondition: "NM", updatedAt: "2026-10-22T20:00:00.000000+00:00" };

  it("uses what a save returned when it's newer than the card on screen", () => {
    const saved = { id: "s1", priceCents: 500, updatedAt: "2026-10-22T20:00:01.250000+00:00" };
    expect(newestScan(shown, saved)).toEqual({ ...shown, priceCents: 500, updatedAt: saved.updatedAt });
  });

  it("keeps the card on screen when a reload brought something newer", () => {
    const saved = { id: "s1", priceCents: 500, updatedAt: "2026-10-22T19:59:00.000000+00:00" };
    expect(newestScan(shown, saved)).toBe(shown);
  });

  it("treats the same stamp, or none, as the newest", () => {
    expect(newestScan(shown, { priceCents: 500, updatedAt: shown.updatedAt }).priceCents).toBe(500);
    expect(newestScan(shown, { priceCents: 700 }).priceCents).toBe(700);
    expect(newestScan(shown, undefined)).toBe(shown);
  });
});
