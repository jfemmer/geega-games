// Mock ScanRepository — an in-memory implementation of the high-volume batch
// scanning pipeline. It models everything the real (Supabase + Vercel) impl
// will do, so the entire Card Scanning UX runs offline:
//
//   - persistent scan sessions (survive navigation within a session)
//   - batch ingestion with front/back pairing + preserved scanner order
//   - concurrent-ish progress reporting
//   - filtered, counted review queue
//   - per-scan + safe bulk review edits
//   - idempotent, partial-failure-tolerant commit to inventory
//
// Committing reuses mockInventoryRepository so scan-created inventory flows
// through the SAME movement ledger as manual adds (reason: scan_add /
// batch_scan_add), keeping one audit trail.

import type {
  BatchCommitPreview,
  BatchCommitResult,
  CardScan,
  Page,
  ScanReviewPatch,
  ScanSession,
} from "../types";
import { delay, mockId } from "../utils/format";
import { mockInventoryRepository } from "./mock";
import type {
  ScanIngestProgress,
  ScanRepository,
  UploadedScanFile,
} from "./types";

/* In-memory state, cloned so tests can reset it. */
let sessions: ScanSession[] = [];
let scans: CardScan[] = [];
let sessionSeq = 1041; // next label number → "#1042"

function nowIso(): string {
  return new Date().toISOString();
}

/** Recompute a session's rollup counters from its scans. */
function recomputeSession(sessionId: string): void {
  const s = sessions.find((x) => x.id === sessionId);
  if (!s) return;
  const rows = scans.filter((c) => c.scanSessionId === sessionId);
  s.totalCards = rows.length;
  s.reviewedCards = rows.filter((r) =>
    ["matched", "ready", "added", "rejected"].includes(r.reviewStatus),
  ).length;
  s.matchedCards = rows.filter((r) => r.selectedScryfallId != null).length;
  s.readyCards = rows.filter((r) => r.reviewStatus === "ready").length;
  s.addedCards = rows.filter((r) => r.reviewStatus === "added").length;
  s.rejectedCards = rows.filter((r) => r.reviewStatus === "rejected").length;
  s.failedCards = rows.filter((r) => r.reviewStatus === "error").length;
  s.updatedAt = nowIso();
  // Auto-advance lifecycle: once every card is added/rejected, mark completed.
  const terminal = s.addedCards + s.rejectedCards;
  if (rows.length > 0 && terminal === rows.length) {
    s.status = "completed";
    s.completedAt = s.completedAt ?? nowIso();
  } else if (s.status === "completed") {
    s.status = "reviewing";
    s.completedAt = null;
  }
}

/**
 * Pair uploaded files into logical card scans. Files are grouped by their
 * sequenceHint (the scanner emits front then back for the same card with the
 * same hint); within a hint, the "front" side and "back" side merge into ONE
 * CardScan. Front-only batches remain valid (back stays null). Sequence order
 * is preserved by sorting on the hint. This mirrors how fi-8170 duplex output
 * will be paired later.
 */
function pairFiles(
  files: UploadedScanFile[],
): { front: UploadedScanFile | null; back: UploadedScanFile | null }[] {
  const byHint = new Map<
    number,
    { front: UploadedScanFile | null; back: UploadedScanFile | null }
  >();
  for (const f of files) {
    const entry = byHint.get(f.sequenceHint) ?? { front: null, back: null };
    if (f.side === "back") entry.back = f;
    else entry.front = f;
    byHint.set(f.sequenceHint, entry);
  }
  return Array.from(byHint.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

/**
 * Produce a stable, displayable object URL for an uploaded file. In the browser
 * this uses URL.createObjectURL; in Node/test environments it degrades to a
 * data-uri placeholder so nothing throws.
 */
function toDisplayUrl(file: UploadedScanFile | null): string | null {
  if (!file) return null;
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try {
      return URL.createObjectURL(file.file);
    } catch {
      /* fall through */
    }
  }
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="336"><rect width="240" height="336" rx="10" fill="#2a1b45"/><text x="120" y="175" fill="#e0b341" font-family="Georgia" font-size="16" text-anchor="middle">${file.side} scan</text></svg>`,
    )
  );
}

export const mockScanRepository: ScanRepository = {
  async listSessions(): Promise<ScanSession[]> {
    return delay(
      [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      200,
    );
  },

  async getSession(id): Promise<ScanSession | null> {
    return delay(sessions.find((s) => s.id === id) ?? null, 150);
  },

  async createSession(input): Promise<ScanSession> {
    sessionSeq += 1;
    const session: ScanSession = {
      id: mockId("ses"),
      label: `Scan Session #${sessionSeq}`,
      createdBy: input.createdBy,
      scannerName: input.scannerName,
      sourceType: input.sourceType,
      status: "uploading",
      totalFiles: 0,
      totalCards: 0,
      reviewedCards: 0,
      matchedCards: 0,
      readyCards: 0,
      addedCards: 0,
      rejectedCards: 0,
      failedCards: 0,
      note: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: null,
    };
    sessions = [session, ...sessions];
    return delay(session, 200);
  },

  async updateSessionStatus(id, status): Promise<ScanSession> {
    const s = sessions.find((x) => x.id === id);
    if (!s) throw new Error("Scan session not found");
    s.status = status;
    s.updatedAt = nowIso();
    return delay(s, 150);
  },

  async setSessionNote(id, note): Promise<ScanSession> {
    const s = sessions.find((x) => x.id === id);
    if (!s) throw new Error("Scan session not found");
    s.note = note;
    s.updatedAt = nowIso();
    return delay(s, 120);
  },

  async ingestBatch(
    sessionId: string,
    files: UploadedScanFile[],
    onProgress?: (p: ScanIngestProgress) => void,
  ): Promise<{ created: CardScan[]; failed: number }> {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error("Scan session not found");
    session.status = "processing";
    session.totalFiles += files.length;

    const pairs = pairFiles(files);
    const created: CardScan[] = [];
    let failed = 0;
    let processed = 0;

    // Determine starting sequence number to APPEND to any existing scans,
    // preserving global batch order across multiple ingests into one session.
    const existing = scans.filter((c) => c.scanSessionId === sessionId);
    let nextSeq =
      existing.reduce((m, c) => Math.max(m, c.sequenceNumber), 0) + 1;

    for (const pair of pairs) {
      // Simulate a per-card processing tick (real impl uploads to Storage).
      // A single bad file marks that card failed without aborting the batch.
      const anyFile = pair.front ?? pair.back;
      if (!anyFile) {
        failed += 1;
        processed += 1;
        onProgress?.({ total: pairs.length, processed, failed });
        continue;
      }
      const scan: CardScan = {
        id: mockId("scan"),
        scanSessionId: sessionId,
        sequenceNumber: nextSeq++,
        frontImagePath: pair.front ? `scans/${sessionId}/${pair.front.fileName}` : null,
        backImagePath: pair.back ? `scans/${sessionId}/${pair.back.fileName}` : null,
        frontImageUrl: toDisplayUrl(pair.front),
        backImageUrl: toDisplayUrl(pair.back),
        selectedScryfallId: null,
        selectedPrinting: null,
        recognitionStatus: "none",
        recognitionConfidence: null,
        recognitionData: null,
        suggestedCondition: null,
        suggestedConditionConfidence: null,
        confirmedCondition: null,
        selectedFinish: null,
        quantity: 1,
        priceCents: null,
        costCents: null,
        storageLocation: null,
        notes: null,
        reviewStatus: "unreviewed",
        reviewedBy: null,
        reviewedAt: null,
        inventoryItemId: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      scans.push(scan);
      created.push(scan);
      processed += 1;
      onProgress?.({ total: pairs.length, processed, failed });
    }

    session.status = failed > 0 ? "partially_failed" : "pending_review";
    recomputeSession(sessionId);
    // recomputeSession only flips to "completed" when every card is terminal,
    // which cannot happen immediately after ingest, so the status set above
    // stands.
    return delay({ created, failed }, 250);
  },

  async listScans(sessionId, query): Promise<Page<CardScan>> {
    const { filter = "all", search = "", page = 1, pageSize = 50 } = query;
    let rows = scans.filter((c) => c.scanSessionId === sessionId);

    rows = rows.filter((c) => {
      switch (filter) {
        case "unreviewed":
          return c.reviewStatus === "unreviewed";
        case "pending_match":
          return c.selectedScryfallId == null && c.reviewStatus !== "rejected";
        case "matched":
          return c.selectedScryfallId != null && c.reviewStatus === "matched";
        case "needs_manual_match":
          return c.reviewStatus === "needs_manual_match";
        case "ready":
          return c.reviewStatus === "ready";
        case "added":
          return c.reviewStatus === "added";
        case "rejected":
          return c.reviewStatus === "rejected";
        case "missing_back":
          return c.backImagePath == null;
        case "error":
          return c.reviewStatus === "error";
        default:
          return true;
      }
    });

    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (c) =>
          c.selectedPrinting?.cardName.toLowerCase().includes(q) ||
          c.selectedPrinting?.setCode.toLowerCase().includes(q) ||
          c.selectedPrinting?.collectorNumber.toLowerCase().includes(q) ||
          String(c.sequenceNumber).includes(q),
      );
    }

    rows.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    const total = rows.length;
    const start = (page - 1) * pageSize;
    return delay({ rows: rows.slice(start, start + pageSize), total }, 180);
  },

  async getScan(scanId): Promise<CardScan | null> {
    return delay(scans.find((c) => c.id === scanId) ?? null, 120);
  },

  async filterCounts(sessionId): Promise<Record<string, number>> {
    const rows = scans.filter((c) => c.scanSessionId === sessionId);
    const count = (pred: (c: CardScan) => boolean) => rows.filter(pred).length;
    return delay(
      {
        all: rows.length,
        unreviewed: count((c) => c.reviewStatus === "unreviewed"),
        pending_match: count(
          (c) => c.selectedScryfallId == null && c.reviewStatus !== "rejected",
        ),
        matched: count(
          (c) => c.selectedScryfallId != null && c.reviewStatus === "matched",
        ),
        needs_manual_match: count((c) => c.reviewStatus === "needs_manual_match"),
        ready: count((c) => c.reviewStatus === "ready"),
        added: count((c) => c.reviewStatus === "added"),
        rejected: count((c) => c.reviewStatus === "rejected"),
        missing_back: count((c) => c.backImagePath == null),
        error: count((c) => c.reviewStatus === "error"),
      },
      120,
    );
  },

  async updateScan(scanId, patch): Promise<CardScan> {
    const scan = scans.find((c) => c.id === scanId);
    if (!scan) throw new Error("Scan not found");
    applyPatch(scan, patch);
    scan.updatedAt = nowIso();
    recomputeSession(scan.scanSessionId);
    return delay(scan, 120);
  },

  async bulkUpdate(scanIds, patch, reviewer): Promise<CardScan[]> {
    const affected: CardScan[] = [];
    const ids = new Set(scanIds);
    for (const scan of scans) {
      if (!ids.has(scan.id)) continue;
      applyPatch(scan, patch);
      scan.reviewedBy = reviewer;
      scan.reviewedAt = nowIso();
      scan.updatedAt = nowIso();
      affected.push(scan);
    }
    if (affected.length > 0) recomputeSession(affected[0].scanSessionId);
    return delay(affected, 200);
  },

  async previewCommit(sessionId): Promise<BatchCommitPreview> {
    const ready = scans.filter(
      (c) => c.scanSessionId === sessionId && c.reviewStatus === "ready",
    );
    let willCreate = 0;
    let willIncrement = 0;
    const errors: BatchCommitPreview["errors"] = [];

    for (const scan of ready) {
      const problem = validateForCommit(scan);
      if (problem) {
        errors.push({
          scanId: scan.id,
          sequenceNumber: scan.sequenceNumber,
          reason: problem,
        });
        continue;
      }
      const match = await mockInventoryRepository.findMatchByScryfall(
        scan.selectedScryfallId!,
        scan.confirmedCondition!,
        scan.selectedFinish!,
      );
      if (match) willIncrement += 1;
      else willCreate += 1;
    }

    return delay(
      {
        readyCount: ready.length,
        willCreateCount: willCreate,
        willIncrementCount: willIncrement,
        errorCount: errors.length,
        errors,
      },
      200,
    );
  },

  async commitReady(sessionId, reviewer): Promise<BatchCommitResult> {
    const ready = scans.filter(
      (c) => c.scanSessionId === sessionId && c.reviewStatus === "ready",
    );
    let created = 0;
    let incremented = 0;
    const failures: BatchCommitResult["failures"] = [];

    for (const scan of ready) {
      try {
        const outcome = await commitOne(scan, reviewer, "batch_scan_add");
        if (outcome === "created") created += 1;
        else incremented += 1;
      } catch (err) {
        // Partial failure: do NOT roll back succeeded rows.
        failures.push({
          scanId: scan.id,
          sequenceNumber: scan.sequenceNumber,
          reason: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
    recomputeSession(sessionId);
    return delay(
      {
        addedCount: created + incremented,
        createdCount: created,
        incrementedCount: incremented,
        failedCount: failures.length,
        failures,
      },
      300,
    );
  },

  async commitScan(scanId, reviewer): Promise<CardScan> {
    const scan = scans.find((c) => c.id === scanId);
    if (!scan) throw new Error("Scan not found");
    await commitOne(scan, reviewer, "scan_add");
    recomputeSession(scan.scanSessionId);
    return delay(scan, 200);
  },
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function applyPatch(scan: CardScan, patch: ScanReviewPatch): void {
  if (patch.selectedScryfallId !== undefined)
    scan.selectedScryfallId = patch.selectedScryfallId;
  if (patch.selectedPrinting !== undefined) {
    scan.selectedPrinting = patch.selectedPrinting;
    // Selecting a printing constrains finish to the printing's finishes.
    if (
      patch.selectedPrinting &&
      scan.selectedFinish &&
      !patch.selectedPrinting.availableFinishes.includes(scan.selectedFinish)
    ) {
      scan.selectedFinish = patch.selectedPrinting.availableFinishes[0] ?? null;
    }
    // Auto-move from pending/unreviewed to matched when a match is chosen.
    if (patch.selectedPrinting && scan.reviewStatus !== "added") {
      scan.reviewStatus = "matched";
    }
  }
  if (patch.confirmedCondition !== undefined)
    scan.confirmedCondition = patch.confirmedCondition;
  if (patch.selectedFinish !== undefined)
    scan.selectedFinish = patch.selectedFinish;
  if (patch.quantity !== undefined) scan.quantity = patch.quantity;
  if (patch.priceCents !== undefined) scan.priceCents = patch.priceCents;
  if (patch.costCents !== undefined) scan.costCents = patch.costCents;
  if (patch.storageLocation !== undefined)
    scan.storageLocation = patch.storageLocation;
  if (patch.notes !== undefined) scan.notes = patch.notes;
  if (patch.reviewStatus !== undefined) scan.reviewStatus = patch.reviewStatus;
}

/** Returns a human reason string if a scan is NOT ready to commit, else null. */
function validateForCommit(scan: CardScan): string | null {
  if (scan.inventoryItemId) return null; // already added → treated as no-op
  if (!scan.selectedScryfallId || !scan.selectedPrinting)
    return "No exact printing selected.";
  if (!scan.confirmedCondition) return "No condition selected.";
  if (!scan.selectedFinish) return "No finish selected.";
  if (
    scan.selectedPrinting &&
    !scan.selectedPrinting.availableFinishes.includes(scan.selectedFinish)
  )
    return "Selected finish is not available for this printing.";
  if (!Number.isFinite(scan.quantity) || scan.quantity < 1)
    return "Quantity must be at least 1.";
  if (scan.priceCents == null || scan.priceCents <= 0)
    return "Selling price is required.";
  return null;
}

type CommitOutcome = "created" | "incremented";

/**
 * Commit one scan to inventory. Idempotent: a scan already carrying
 * inventoryItemId is skipped (returns without double-adding). Validates the
 * scan, then either increments an existing matching line (through the ledger)
 * or creates a new line. Marks the scan added and links it to inventory.
 */
async function commitOne(
  scan: CardScan,
  reviewer: string,
  reason: "scan_add" | "batch_scan_add",
): Promise<CommitOutcome> {
  if (scan.inventoryItemId) return "incremented"; // idempotent no-op

  const problem = validateForCommit(scan);
  if (problem) throw new Error(problem);

  const printing = scan.selectedPrinting!;
  const condition = scan.confirmedCondition!;
  const finish = scan.selectedFinish!;

  const existing = await mockInventoryRepository.findMatchByScryfall(
    scan.selectedScryfallId!,
    condition,
    finish,
  );

  let outcome: CommitOutcome;
  let inventoryItemId: string;

  if (existing) {
    const updated = await mockInventoryRepository.adjustQuantity(
      existing.id,
      scan.quantity,
      reason,
      reviewer,
    );
    inventoryItemId = updated.id;
    outcome = "incremented";
  } else {
    const created = await mockInventoryRepository.create(
      {
        scryfallId: printing.scryfallId,
        cardName: printing.cardName,
        setName: printing.setName,
        setCode: printing.setCode,
        collectorNumber: printing.collectorNumber,
        rarity: printing.rarity,
        cardType: printing.cardType,
        imageUrl: printing.imageUrl,
        condition,
        finish,
        quantity: scan.quantity,
        priceCents: scan.priceCents!,
        costCents: scan.costCents,
        storageLocation: scan.storageLocation,
        sku: null,
        notes: scan.notes,
        status: "active",
        scryfallPriceCents: printing.scryfallPriceCents,
      },
      reviewer,
    );
    inventoryItemId = created.id;
    outcome = "created";
  }

  scan.inventoryItemId = inventoryItemId;
  scan.reviewStatus = "added";
  scan.reviewedBy = reviewer;
  scan.reviewedAt = nowIso();
  scan.updatedAt = nowIso();
  return outcome;
}

/** Test/support helper: reset all scan state. */
export function __resetScanState(): void {
  sessions = [];
  scans = [];
  sessionSeq = 1041;
}

/**
 * Seed one demo session with a handful of scans so the Card Scanning section is
 * populated on first load in dev. Idempotent — only seeds when empty.
 */
export async function ensureScanSeed(createdBy: string): Promise<void> {
  if (sessions.length > 0) return;
  const session = await mockScanRepository.createSession({
    scannerName: "Ricoh fi-8170",
    sourceType: "scanner_export",
    createdBy,
  });
  const files: UploadedScanFile[] = [];
  for (let i = 1; i <= 8; i++) {
    files.push({
      file: new Blob([`front-${i}`]),
      fileName: `card_${i}_front.jpg`,
      side: "front",
      sequenceHint: i,
    });
    if (i % 2 === 0) {
      files.push({
        file: new Blob([`back-${i}`]),
        fileName: `card_${i}_back.jpg`,
        side: "back",
        sequenceHint: i,
      });
    }
  }
  await mockScanRepository.ingestBatch(session.id, files);
  await mockScanRepository.updateSessionStatus(session.id, "reviewing");
}
