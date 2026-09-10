import { beforeEach, describe, expect, it } from "vitest";
import {
  mockScanRepository as scans,
  __resetScanState,
} from "../src/admin/repositories/scan.mock";
import {
  mockInventoryRepository as inventory,
  __resetMockState,
} from "../src/admin/repositories/mock";
import { mockScryfallRepository as scryfall } from "../src/admin/repositories/scryfall.mock";
import type { UploadedScanFile } from "../src/admin/repositories/types";
import type { CardPrinting } from "../src/admin/types";

beforeEach(() => {
  __resetMockState();
  __resetScanState();
});

function frontFiles(n: number): UploadedScanFile[] {
  return Array.from({ length: n }, (_, i) => ({
    file: new Blob([`front-${i + 1}`]),
    fileName: `card_${i + 1}_front.jpg`,
    side: "front" as const,
    sequenceHint: i + 1,
  }));
}

async function createSession() {
  return scans.createSession({
    scannerName: "Ricoh fi-8170",
    sourceType: "scanner_export",
    createdBy: "Tester",
  });
}

/** Pick a concrete printing from the mock Scryfall catalog. */
async function anyPrinting(term = "Lightning Bolt"): Promise<CardPrinting> {
  const results = await scryfall.searchPrintings(term);
  expect(results.length).toBeGreaterThan(0);
  return results[0];
}

describe("scan session lifecycle", () => {
  it("creates a session with a label and zeroed counters", async () => {
    const s = await createSession();
    expect(s.label).toMatch(/Scan Session #\d+/);
    expect(s.totalCards).toBe(0);
    expect(s.status).toBe("uploading");
  });

  it("lists sessions newest-first", async () => {
    const a = await createSession();
    const b = await createSession();
    const list = await scans.listSessions();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });
});

describe("batch ingest", () => {
  it("creates one scan per front-only file and preserves order", async () => {
    const s = await createSession();
    const { created, failed } = await scans.ingestBatch(s.id, frontFiles(5));
    expect(created).toHaveLength(5);
    expect(failed).toBe(0);
    const page = await scans.listScans(s.id, {});
    expect(page.total).toBe(5);
    expect(page.rows.map((r) => r.sequenceNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it("pairs front/back files that share a sequence hint into one card", async () => {
    const s = await createSession();
    const files: UploadedScanFile[] = [
      { file: new Blob(["f1"]), fileName: "1f.jpg", side: "front", sequenceHint: 1 },
      { file: new Blob(["b1"]), fileName: "1b.jpg", side: "back", sequenceHint: 1 },
      { file: new Blob(["f2"]), fileName: "2f.jpg", side: "front", sequenceHint: 2 },
      { file: new Blob(["b2"]), fileName: "2b.jpg", side: "back", sequenceHint: 2 },
    ];
    const { created } = await scans.ingestBatch(s.id, files);
    expect(created).toHaveLength(2);
    expect(created[0].frontImagePath).toBeTruthy();
    expect(created[0].backImagePath).toBeTruthy();
  });

  it("appends across multiple ingests, continuing the sequence", async () => {
    const s = await createSession();
    await scans.ingestBatch(s.id, frontFiles(3));
    await scans.ingestBatch(s.id, frontFiles(2));
    const page = await scans.listScans(s.id, {});
    expect(page.total).toBe(5);
    expect(page.rows.map((r) => r.sequenceNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it("tracks a missing back as a filterable state", async () => {
    const s = await createSession();
    await scans.ingestBatch(s.id, frontFiles(2));
    const page = await scans.listScans(s.id, { filter: "missing_back" });
    expect(page.total).toBe(2);
  });
});

describe("review transitions", () => {
  it("selecting a printing moves a scan to matched and constrains finish", async () => {
    const s = await createSession();
    const { created } = await scans.ingestBatch(s.id, frontFiles(1));
    const printing = await anyPrinting();
    const updated = await scans.updateScan(created[0].id, {
      selectedScryfallId: printing.scryfallId,
      selectedPrinting: printing,
    });
    expect(updated.reviewStatus).toBe("matched");
    expect(updated.selectedScryfallId).toBe(printing.scryfallId);
  });

  it("counts reflect filter buckets", async () => {
    const s = await createSession();
    const { created } = await scans.ingestBatch(s.id, frontFiles(3));
    const printing = await anyPrinting();
    await scans.updateScan(created[0].id, {
      selectedScryfallId: printing.scryfallId,
      selectedPrinting: printing,
    });
    const counts = await scans.filterCounts(s.id);
    expect(counts.all).toBe(3);
    expect(counts.matched).toBe(1);
    expect(counts.pending_match).toBe(2);
  });
});

/** Fully prepare a scan so it is ready to commit. */
async function makeReady(sessionId: string, scanId: string) {
  const printing = await anyPrinting();
  await scans.updateScan(scanId, {
    selectedScryfallId: printing.scryfallId,
    selectedPrinting: printing,
    confirmedCondition: "NM",
    selectedFinish: printing.availableFinishes[0],
    quantity: 2,
    priceCents: 500,
    reviewStatus: "ready",
  });
  return printing;
}

describe("commit to inventory", () => {
  it("creates a new inventory line and links the scan", async () => {
    const s = await createSession();
    const { created } = await scans.ingestBatch(s.id, frontFiles(1));
    await makeReady(s.id, created[0].id);

    const before = (await inventory.list({ pageSize: 500 })).total;
    const result = await scans.commitReady(s.id, "Tester");
    expect(result.addedCount).toBe(1);
    expect(result.createdCount).toBe(1);
    const after = (await inventory.list({ pageSize: 500 })).total;
    expect(after).toBe(before + 1);

    const scan = await scans.getScan(created[0].id);
    expect(scan?.reviewStatus).toBe("added");
    expect(scan?.inventoryItemId).toBeTruthy();
  });

  it("is idempotent — committing twice does not double-add", async () => {
    const s = await createSession();
    const { created } = await scans.ingestBatch(s.id, frontFiles(1));
    await makeReady(s.id, created[0].id);

    await scans.commitReady(s.id, "Tester");
    const afterFirst = (await inventory.list({ pageSize: 500 })).total;
    // Second commit finds nothing in "ready" (already "added"), so no-op.
    const second = await scans.commitReady(s.id, "Tester");
    expect(second.addedCount).toBe(0);
    const afterSecond = (await inventory.list({ pageSize: 500 })).total;
    expect(afterSecond).toBe(afterFirst);
  });

  it("increments an existing matching line instead of creating a duplicate", async () => {
    const s = await createSession();
    const { created } = await scans.ingestBatch(s.id, frontFiles(2));
    const printing = await anyPrinting();

    // Pre-create an inventory line for this exact printing/condition/finish.
    const existing = await inventory.create(
      {
        scryfallId: printing.scryfallId,
        cardName: printing.cardName,
        setName: printing.setName,
        setCode: printing.setCode,
        collectorNumber: printing.collectorNumber,
        rarity: printing.rarity,
        cardType: printing.cardType,
        imageUrl: printing.imageUrl,
        condition: "NM",
        finish: printing.availableFinishes[0],
        quantity: 1,
        priceCents: 500,
        costCents: null,
        storageLocation: null,
        sku: null,
        notes: null,
        status: "active",
        scryfallPriceCents: printing.scryfallPriceCents,
      },
      "Tester",
    );

    for (const c of created) {
      await scans.updateScan(c.id, {
        selectedScryfallId: printing.scryfallId,
        selectedPrinting: printing,
        confirmedCondition: "NM",
        selectedFinish: printing.availableFinishes[0],
        quantity: 2,
        priceCents: 500,
        reviewStatus: "ready",
      });
    }

    const totalBefore = (await inventory.list({ pageSize: 500 })).total;
    const result = await scans.commitReady(s.id, "Tester");
    expect(result.incrementedCount).toBe(2);
    expect(result.createdCount).toBe(0);
    const totalAfter = (await inventory.list({ pageSize: 500 })).total;
    expect(totalAfter).toBe(totalBefore); // no new lines

    const line = await inventory.get(existing.id);
    expect(line?.quantity).toBe(1 + 2 + 2); // original + two scans of qty 2
  });

  it("dedupes by scryfall id across differing set/collector legacy data", async () => {
    const s = await createSession();
    const { created } = await scans.ingestBatch(s.id, frontFiles(1));
    const printing = await anyPrinting();
    const match = await inventory.findMatchByScryfall(
      printing.scryfallId,
      "NM",
      printing.availableFinishes[0],
    );
    expect(match).toBeNull(); // nothing yet
    await makeReady(s.id, created[0].id);
    await scans.commitReady(s.id, "Tester");
    const nowMatch = await inventory.findMatchByScryfall(
      printing.scryfallId,
      "NM",
      printing.availableFinishes[0],
    );
    expect(nowMatch).not.toBeNull();
  });

  it("reports validation errors in preview without committing", async () => {
    const s = await createSession();
    const { created } = await scans.ingestBatch(s.id, frontFiles(1));
    // Mark ready-ish but leave condition missing.
    const printing = await anyPrinting();
    await scans.updateScan(created[0].id, {
      selectedScryfallId: printing.scryfallId,
      selectedPrinting: printing,
      selectedFinish: printing.availableFinishes[0],
      priceCents: 500,
      reviewStatus: "ready",
    });
    const preview = await scans.previewCommit(s.id);
    expect(preview.errorCount).toBe(1);
    expect(preview.errors[0].reason).toMatch(/condition/i);
  });

  it("keeps succeeded rows when some rows fail (partial failure)", async () => {
    const s = await createSession();
    const { created } = await scans.ingestBatch(s.id, frontFiles(2));
    // First is fully ready; second is ready but invalid (no price).
    await makeReady(s.id, created[0].id);
    const printing = await anyPrinting();
    await scans.updateScan(created[1].id, {
      selectedScryfallId: printing.scryfallId,
      selectedPrinting: printing,
      confirmedCondition: "NM",
      selectedFinish: printing.availableFinishes[0],
      quantity: 1,
      priceCents: null,
      reviewStatus: "ready",
    });
    const result = await scans.commitReady(s.id, "Tester");
    expect(result.addedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    const good = await scans.getScan(created[0].id);
    expect(good?.reviewStatus).toBe("added");
  });
});

describe("bulk update", () => {
  it("applies shared fields but never assigns a match", async () => {
    const s = await createSession();
    const { created } = await scans.ingestBatch(s.id, frontFiles(3));
    const ids = created.map((c) => c.id);
    const affected = await scans.bulkUpdate(
      ids,
      { storageLocation: "Box A-1", costCents: 100 },
      "Tester",
    );
    expect(affected).toHaveLength(3);
    for (const c of affected) {
      expect(c.storageLocation).toBe("Box A-1");
      expect(c.costCents).toBe(100);
      expect(c.selectedScryfallId).toBeNull(); // never auto-matched
    }
  });

  it("can reject many at once", async () => {
    const s = await createSession();
    const { created } = await scans.ingestBatch(s.id, frontFiles(2));
    await scans.bulkUpdate(
      created.map((c) => c.id),
      { reviewStatus: "rejected" },
      "Tester",
    );
    const counts = await scans.filterCounts(s.id);
    expect(counts.rejected).toBe(2);
  });
});
