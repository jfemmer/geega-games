import { describe, expect, it } from "vitest";
import {
  buildStoragePath,
  filterUnseenUploads,
  pairUploads,
  validateScanForCommit,
} from "../api/_lib/scan";
import type { Database } from "../src/types/database";

type CardScanRow = Database["public"]["Tables"]["card_scans"]["Row"];

describe("filterUnseenUploads (ingest idempotency)", () => {
  it("passes through uploads when nothing has been ingested yet", () => {
    const uploads = [{ path: "a" }, { path: "b" }];
    expect(filterUnseenUploads(new Set(), uploads)).toEqual(uploads);
  });

  it("drops uploads whose path is already attached to a scan (a retried ingest call)", () => {
    const uploads = [{ path: "a" }, { path: "b" }, { path: "c" }];
    const result = filterUnseenUploads(new Set(["b"]), uploads);
    expect(result).toEqual([{ path: "a" }, { path: "c" }]);
  });

  it("drops every upload on a full retry (all paths already exist)", () => {
    const uploads = [{ path: "a" }, { path: "b" }];
    expect(filterUnseenUploads(new Set(["a", "b"]), uploads)).toEqual([]);
  });
});

// These are the pure-logic pieces the real (Supabase-backed) scan pipeline
// depends on for correctness: pairing front/back uploads in scanner order,
// deciding whether a reviewed scan is actually safe to commit, and building
// collision-resistant Storage paths. No network/DB — that's what makes them
// fast and reliable to test directly.

describe("pairUploads", () => {
  it("pairs front-only uploads (1 file = 1 card), preserving hint order", () => {
    const files = [
      { fileName: "c.jpg", side: "front" as const, sequenceHint: 3, path: "p3" },
      { fileName: "a.jpg", side: "front" as const, sequenceHint: 1, path: "p1" },
      { fileName: "b.jpg", side: "front" as const, sequenceHint: 2, path: "p2" },
    ];
    const pairs = pairUploads(files);
    expect(pairs.map((p) => p.front?.path)).toEqual(["p1", "p2", "p3"]);
    expect(pairs.every((p) => p.back === null)).toBe(true);
  });

  it("merges front+back sharing a sequenceHint into one pair", () => {
    const files = [
      { fileName: "1f.jpg", side: "front" as const, sequenceHint: 1, path: "pf1" },
      { fileName: "1b.jpg", side: "back" as const, sequenceHint: 1, path: "pb1" },
      { fileName: "2f.jpg", side: "front" as const, sequenceHint: 2, path: "pf2" },
      { fileName: "2b.jpg", side: "back" as const, sequenceHint: 2, path: "pb2" },
    ];
    const pairs = pairUploads(files);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({
      front: files[0],
      back: files[1],
    });
    expect(pairs[1]).toEqual({
      front: files[2],
      back: files[3],
    });
  });

  it("keeps a back-only pair valid (front missing) without dropping it", () => {
    const files = [
      { fileName: "1b.jpg", side: "back" as const, sequenceHint: 1, path: "pb1" },
    ];
    const pairs = pairUploads(files);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].front).toBeNull();
    expect(pairs[0].back?.path).toBe("pb1");
  });

  it("handles an empty batch", () => {
    expect(pairUploads([])).toEqual([]);
  });
});

describe("buildStoragePath", () => {
  it("sanitizes unsafe filename characters", () => {
    const path = buildStoragePath("session-1", {
      fileName: "card #1 (front).jpg",
      side: "front",
      sequenceHint: 1,
    });
    expect(path).not.toMatch(/[#() ]/);
    expect(path.startsWith("session-1/1-front-")).toBe(true);
  });

  it("produces a distinct path for two uploads with the identical fileName", () => {
    const file = { fileName: "card_1_front.jpg", side: "front" as const, sequenceHint: 1 };
    const a = buildStoragePath("session-1", file);
    const b = buildStoragePath("session-1", file);
    expect(a).not.toBe(b);
  });
});

describe("validateScanForCommit", () => {
  function baseScan(overrides: Partial<CardScanRow> = {}): CardScanRow {
    return {
      id: "scan-1",
      scan_session_id: "session-1",
      sequence_number: 1,
      front_image_path: "p/front.jpg",
      back_image_path: null,
      selected_scryfall_id: "22222222-2222-2222-2222-222222222222",
      recognition_status: "none",
      recognition_confidence: null,
      recognition_data: null,
      suggested_condition: null,
      suggested_condition_confidence: null,
      confirmed_condition: "NM",
      selected_finish: "nonfoil",
      quantity: 1,
      price_cents: 500,
      cost_cents: null,
      storage_location: null,
      notes: null,
      review_status: "ready",
      reviewed_by: null,
      reviewed_at: null,
      inventory_item_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("passes a fully-populated ready scan", () => {
    expect(validateScanForCommit(baseScan())).toBeNull();
  });

  it("is an idempotent no-op for a scan already committed", () => {
    // Even with fields that would otherwise fail validation — an already-
    // committed scan must never be treated as blocked.
    expect(
      validateScanForCommit(
        baseScan({ inventory_item_id: "inv-1", selected_scryfall_id: null }),
      ),
    ).toBeNull();
  });

  it("requires an exact printing", () => {
    expect(validateScanForCommit(baseScan({ selected_scryfall_id: null }))).toMatch(
      /printing/i,
    );
  });

  it("requires a confirmed condition", () => {
    expect(validateScanForCommit(baseScan({ confirmed_condition: null }))).toMatch(
      /condition/i,
    );
  });

  it("requires a selected finish", () => {
    expect(validateScanForCommit(baseScan({ selected_finish: null }))).toMatch(
      /finish/i,
    );
  });

  it("requires quantity >= 1", () => {
    expect(validateScanForCommit(baseScan({ quantity: 0 }))).toMatch(/quantity/i);
  });

  it("requires a positive selling price", () => {
    expect(validateScanForCommit(baseScan({ price_cents: null }))).toMatch(/price/i);
    expect(validateScanForCommit(baseScan({ price_cents: 0 }))).toMatch(/price/i);
  });
});
