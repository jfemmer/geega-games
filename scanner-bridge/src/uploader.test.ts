import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiClient } from "./apiClient.js";
import type { PairedCard } from "./pairing.js";
import type { CardRecognizer, PairRecognition } from "./recognizer/recognizer.js";
import type { LocalRecognitionResult } from "./recognizer/types.js";
import { uploadBatch } from "./uploader.js";

// The bridge's upload step with the on-PC recognizer in the loop: cards it
// identifies go up as straightened JPEGs with this PC's answer attached;
// anything it can't handle falls back to raw files + cloud recognition,
// card by card.

let dir: string;
let uploads: { path: string; contentType: string; size: number }[];
let recognizeBodies: { scanId: string; body: unknown }[];
let failUploadFor: (fileName: string) => boolean;

function file(name: string, content = "raw-scan-bytes"): string {
  const p = path.join(dir, name);
  writeFileSync(p, content);
  return p;
}

function fakeApi(): ApiClient {
  let scanCounter = 0;
  return {
    call: vi.fn(async (url: string, init: { method: string; body?: unknown }) => {
      const body = init.body as Record<string, unknown> | undefined;
      if (url.endsWith("/uploads")) {
        const files = (body!.files as { fileName: string; side: string; sequenceHint: number }[]);
        return { uploads: files.map((f) => ({ ...f, path: `S/${f.sequenceHint}-${f.side}-${f.fileName}`, token: "t" })) };
      }
      if (url.endsWith("/ingest")) {
        const ups = body!.uploads as { side: string; sequenceHint: number; path: string }[];
        const byHint = new Map<number, { front_image_path: string | null; back_image_path: string | null }>();
        for (const u of ups) {
          const row = byHint.get(u.sequenceHint) ?? { front_image_path: null, back_image_path: null };
          if (u.side === "front") row.front_image_path = u.path;
          else row.back_image_path = u.path;
          byHint.set(u.sequenceHint, row);
        }
        return { created: [...byHint.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => ({ id: `scan-${++scanCounter}`, ...r })), failed: 0 };
      }
      const m = url.match(/\/api\/admin\/scans\/(.+)\/recognize$/);
      if (m) {
        recognizeBodies.push({ scanId: m[1], body: init.body });
        return {};
      }
      throw new Error(`unexpected ${url}`);
    }),
  } as unknown as ApiClient;
}

function fakeSupabase(): SupabaseClient {
  return {
    storage: {
      from: () => ({
        uploadToSignedUrl: async (p: string, _token: string, bytes: Buffer, opts: { contentType: string }) => {
          if (failUploadFor(p)) return { error: { message: "nope" } };
          uploads.push({ path: p, contentType: opts.contentType, size: bytes.length });
          return { error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;
}

function localResult(overrides: Partial<LocalRecognitionResult> = {}): LocalRecognitionResult {
  return {
    engine: "scanner_pc",
    engineVersion: "1.0.0",
    decision: "sure",
    candidates: [{ scryfallId: "11111111-1111-4111-8111-111111111111", confidence: 0.95, reason: "Picture match 95%", visual: 0.95, similarity: 0.9, face: 0 }],
    decisionReason: "Matched.",
    warnings: [],
    visualSimilarity: 0.95,
    finish: null,
    orientation: 0,
    sidesSwapped: false,
    straightened: { front: true, back: true },
    ocrText: null,
    timingsMs: { total: 400 },
    library: { builtAt: null, entries: 1, model: "m" },
    ...overrides,
  };
}

function recognizer(fn: (input: { front: unknown; back: unknown; finish: unknown }) => Promise<PairRecognition>): CardRecognizer {
  return { recognizePair: vi.fn(fn) } as unknown as CardRecognizer;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "geega-upload-"));
  uploads = [];
  recognizeBodies = [];
  failUploadFor = () => false;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("uploadBatch with the on-PC recognizer", () => {
  it("uploads straightened JPEGs and sends this PC's answer with the recognize call", async () => {
    const pairs: PairedCard[] = [{ sequenceHint: 1, front: file("scan_1.tiff"), back: file("scan_2.tiff") }];
    const rec = recognizer(async () => ({
      result: localResult({ finish: "foil" }),
      frontJpeg: Buffer.from("front-jpeg"),
      backJpeg: Buffer.from("back-jpeg!!"),
      faceSource: "front",
    }));
    const result = await uploadBatch(fakeApi(), fakeSupabase(), "S", pairs, { recognizer: rec, finishFor: () => "foil" });

    expect(rec.recognizePair).toHaveBeenCalledWith({ front: pairs[0].front, back: pairs[0].back, finish: "foil" });
    expect(uploads.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "S/1-back-scan_2.jpg", contentType: "image/jpeg", size: 11 },
      { path: "S/1-front-scan_1.jpg", contentType: "image/jpeg", size: 10 },
    ]);
    expect(recognizeBodies).toHaveLength(1);
    expect(recognizeBodies[0].body).toMatchObject({ local: { decision: "sure", finish: "foil", straightened: { front: true, back: true } } });
    expect(result).toMatchObject({ cardsCreated: 1, cardsRecognized: 1, cardsRecognizedOnPc: 1, cardsFailedRecognition: 0 });
    expect(result.fileOutcomes.every((o) => o.ok)).toBe(true);
    expect(result.fileOutcomes.map((o) => path.basename(o.localPath)).sort()).toEqual(["scan_1.tiff", "scan_2.tiff"]);
  });

  it("tells the recognizer a condition batch's resolution", async () => {
    const pairs: PairedCard[] = [{ sequenceHint: 1, front: file("geega-condition_1_0001.jpg"), back: file("geega-condition_1_0002.jpg") }];
    const rec = recognizer(async () => ({
      result: localResult(),
      frontJpeg: Buffer.from("front-jpeg"),
      backJpeg: Buffer.from("back-jpeg"),
      faceSource: "front",
    }));
    await uploadBatch(fakeApi(), fakeSupabase(), "S", pairs, { recognizer: rec, scanDpi: 600 });
    expect(rec.recognizePair).toHaveBeenCalledWith({ front: pairs[0].front, back: pairs[0].back, finish: null, dpi: 600 });
  });

  it("puts the face up as the front when the card went through the other way round", async () => {
    const pairs: PairedCard[] = [{ sequenceHint: 1, front: file("scan_1.tiff"), back: file("scan_2.tiff") }];
    const rec = recognizer(async () => ({
      result: localResult({ sidesSwapped: true }),
      frontJpeg: Buffer.from("face"),
      backJpeg: Buffer.from("card-back"),
      faceSource: "back",
    }));
    await uploadBatch(fakeApi(), fakeSupabase(), "S", pairs, { recognizer: rec });
    expect(uploads.map((u) => u.path).sort()).toEqual(["S/1-back-scan_1.jpg", "S/1-front-scan_2.jpg"]);
  });

  it("falls back to raw files and cloud recognition for a card it can't handle, without holding up the rest", async () => {
    const pairs: PairedCard[] = [
      { sequenceHint: 1, front: file("a1.tif"), back: file("a2.tif") },
      { sequenceHint: 2, front: file("b1.tif"), back: file("b2.tif") },
    ];
    const log = vi.fn();
    const rec = recognizer(async (input) => {
      if (String(input.front).endsWith("a1.tif")) throw new Error("model crashed");
      return { result: localResult(), frontJpeg: Buffer.from("f"), backJpeg: Buffer.from("b"), faceSource: "front" };
    });
    const result = await uploadBatch(fakeApi(), fakeSupabase(), "S", pairs, { recognizer: rec, log });
    expect(uploads.find((u) => u.path === "S/1-front-a1.tif")?.contentType).toBe("image/tiff");
    expect(uploads.find((u) => u.path === "S/2-front-b1.jpg")?.contentType).toBe("image/jpeg");
    const byScan = new Map(recognizeBodies.map((r) => [r.scanId, r.body]));
    expect(byScan.get("scan-1")).toBeUndefined();
    expect(byScan.get("scan-2")).toMatchObject({ local: { engine: "scanner_pc" } });
    expect(result).toMatchObject({ cardsRecognized: 2, cardsRecognizedOnPc: 1 });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/cloud recognition/));
  });

  it("uploads the original file for a side it couldn't straighten, and says so", async () => {
    const pairs: PairedCard[] = [{ sequenceHint: 1, front: file("s1.tiff"), back: file("s2.tiff") }];
    const rec = recognizer(async () => ({
      result: localResult({ straightened: { front: true, back: false } }),
      frontJpeg: Buffer.from("face"),
      backJpeg: null,
      faceSource: "front",
    }));
    await uploadBatch(fakeApi(), fakeSupabase(), "S", pairs, { recognizer: rec });
    expect(uploads.map((u) => [u.path, u.contentType]).sort()).toEqual([
      ["S/1-back-s2.tiff", "image/tiff"],
      ["S/1-front-s1.jpg", "image/jpeg"],
    ]);
    expect(recognizeBodies[0].body).toMatchObject({ local: { straightened: { front: true, back: false } } });
  });

  it("works exactly as before without a recognizer", async () => {
    const pairs: PairedCard[] = [{ sequenceHint: 1, front: file("x.tiff"), back: null }];
    const result = await uploadBatch(fakeApi(), fakeSupabase(), "S", pairs);
    expect(uploads).toEqual([{ path: "S/1-front-x.tiff", contentType: "image/tiff", size: 14 }]);
    expect(recognizeBodies).toEqual([{ scanId: "scan-1", body: undefined }]);
    expect(result.cardsRecognizedOnPc).toBe(0);
  });

  it("reports a failed upload against the raw file it stood for", async () => {
    failUploadFor = (p) => p.includes("front");
    const pairs: PairedCard[] = [{ sequenceHint: 1, front: file("f.tiff"), back: file("b.tiff") }];
    const rec = recognizer(async () => ({ result: localResult(), frontJpeg: Buffer.from("f"), backJpeg: Buffer.from("b"), faceSource: "front" }));
    const result = await uploadBatch(fakeApi(), fakeSupabase(), "S", pairs, { recognizer: rec });
    expect(result.fileOutcomes.find((o) => o.localPath.endsWith("f.tiff"))).toMatchObject({ ok: false });
    expect(result.fileOutcomes.find((o) => o.localPath.endsWith("b.tiff"))).toMatchObject({ ok: true });
    // Only the back reached Storage, so only the back is "straightened".
    expect(recognizeBodies[0].body).toMatchObject({ local: { straightened: { front: false, back: true } } });
  });

  it("after a connection drop mid-batch, retries only the cards that never reached the server", async () => {
    const pairs: PairedCard[] = Array.from({ length: 30 }, (_, i) => ({ sequenceHint: i + 1, front: file(`c${i}.tif`), back: null }));
    const api = fakeApi();
    const call = api.call as unknown as ReturnType<typeof vi.fn>;
    const real = call.getMockImplementation() as (url: string, init: { method: string; body?: unknown }) => Promise<unknown>;
    let ingests = 0;
    call.mockImplementation(async (url: string, init: { method: string; body?: unknown }) => {
      if (url.endsWith("/ingest") && ++ingests === 2) throw new Error("fetch failed");
      return real(url, init);
    });
    const result = await uploadBatch(api, fakeSupabase(), "S", pairs);
    // First chunk of 12 made it; the second failed at ingest; the third never started.
    expect(result.cardsCreated).toBe(12);
    expect(result.fileOutcomes).toHaveLength(12);
    expect(result.retryLater.map((f) => path.basename(f))).toEqual(Array.from({ length: 18 }, (_, i) => `c${i + 12}.tif`));
    expect(result.retryReason).toMatch(/fetch failed/);
  });
});
