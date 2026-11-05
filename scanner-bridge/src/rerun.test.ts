import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiClient } from "./apiClient.js";
import type { CardRecognizer } from "./recognizer/recognizer.js";
import type { LocalRecognitionResult } from "./recognizer/types.js";
import { renderCard } from "./recognizer/testing/syntheticCards.js";
import { looksStraightened, rerunStoredScan } from "./rerun.js";

// "Re-run" from Scan Review, done on the scanner PC: download the stored
// images, recognize again, post the answer — never re-upload.

const scanId = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

function result(overrides: Partial<LocalRecognitionResult> = {}): LocalRecognitionResult {
  return {
    engine: "scanner_pc",
    engineVersion: "1.0.0",
    decision: "sure",
    candidates: [],
    decisionReason: "Matched.",
    warnings: [],
    visualSimilarity: 0.9,
    finish: null,
    orientation: 0,
    sidesSwapped: false,
    straightened: { front: true, back: true },
    ocrText: null,
    timingsMs: {},
    library: { builtAt: null, entries: 1, model: "m" },
    ...overrides,
  };
}

type StoredPaths = { front_image_path: string | null; back_image_path: string | null; recognition_data?: unknown };

async function setup(paths: StoredPaths | null, images: Record<string, Buffer>) {
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: paths ? { id: scanId, ...paths } : null, error: null }) }),
      }),
    }),
    storage: {
      from: () => ({
        download: async (p: string) => (images[p] ? { data: new Blob([images[p]]), error: null } : { data: null, error: { message: "missing" } }),
      }),
    },
  } as unknown as SupabaseClient;
  const calls: { path: string; body: unknown }[] = [];
  const api = { call: vi.fn(async (path: string, init: { body?: unknown }) => (calls.push({ path, body: init.body }), {})) } as unknown as ApiClient;
  return { supabase, api, calls };
}

describe("rerunStoredScan", () => {
  it("recognizes the stored images again, and has the server swap them when the face is on the stored back", async () => {
    const straightened = await renderCard({ id: "x", name: "X", set: "AAA", cn: "1", art: 1, symbol: 0 }, 744, 1039);
    const raw = await renderCard({ id: "x", name: "X", set: "AAA", cn: "1", art: 1, symbol: 0 }, 900, 1200);
    const { supabase, api, calls } = await setup({ front_image_path: "S/front.jpg", back_image_path: "S/back.tiff" }, {
      "S/front.jpg": straightened,
      "S/back.tiff": raw,
    });
    const recognizePair = vi.fn(async () => ({
      result: result({ sidesSwapped: true }),
      frontJpeg: null,
      backJpeg: null,
      faceSource: "back" as const,
    }));
    const outcome = await rerunStoredScan(scanId, { supabase, api, recognizer: { recognizePair } as unknown as CardRecognizer });
    expect(outcome).toEqual({
      ok: true,
      status: 200,
      message: "Re-recognized on the scanner PC. The card's face was on the back image, so the two images were swapped.",
    });
    expect(recognizePair).toHaveBeenCalledWith({ front: straightened, back: raw, finish: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe(`/api/admin/scans/${scanId}/recognize`);
    const body = calls[0].body as { local: LocalRecognitionResult; swapSides?: boolean };
    expect(body.swapSides).toBe(true);
    expect(body.local.sidesSwapped).toBe(false);
    // Each image keeps its own straightened flag, now on the other side.
    expect(body.local.straightened).toEqual({ front: false, back: true });
    expect(body.local.warnings.join(" ")).not.toMatch(/looks like the card's back/);
  });

  it("leaves the stored images alone when the face is already the front", async () => {
    const card = await renderCard({ id: "x", name: "X", set: "AAA", cn: "1", art: 1, symbol: 0 }, 744, 1039);
    const { supabase, api, calls } = await setup({ front_image_path: "S/front.jpg", back_image_path: "S/back.jpg" }, { "S/front.jpg": card, "S/back.jpg": card });
    const recognizePair = vi.fn(async () => ({ result: result(), frontJpeg: null, backJpeg: null, faceSource: "front" as const }));
    const outcome = await rerunStoredScan(scanId, { supabase, api, recognizer: { recognizePair } as unknown as CardRecognizer });
    expect(outcome.message).toBe("Re-recognized on the scanner PC.");
    expect((calls[0].body as { swapSides?: boolean }).swapSides).toBeUndefined();
  });

  it("only warns when there's no second image to swap with", async () => {
    const card = await renderCard({ id: "x", name: "X", set: "AAA", cn: "1", art: 1, symbol: 0 }, 744, 1039);
    const { supabase, api, calls } = await setup({ front_image_path: "S/front.jpg", back_image_path: null }, { "S/front.jpg": card });
    const recognizePair = vi.fn(async () => ({ result: result({ sidesSwapped: true }), frontJpeg: null, backJpeg: null, faceSource: "back" as const }));
    await rerunStoredScan(scanId, { supabase, api, recognizer: { recognizePair } as unknown as CardRecognizer });
    const body = calls[0].body as { local: LocalRecognitionResult; swapSides?: boolean };
    expect(body.swapSides).toBeUndefined();
    expect(body.local.warnings.join(" ")).toMatch(/looks like the card's back/);
  });

  it("uses which images were straightened as recorded at first recognition", async () => {
    const card = await renderCard({ id: "x", name: "X", set: "AAA", cn: "1", art: 1, symbol: 0 }, 744, 1039);
    const { supabase, api, calls } = await setup(
      {
        front_image_path: "S/front.jpg",
        back_image_path: "S/back.jpg",
        recognition_data: { engine: "scanner_pc", scannerPc: { straightened: { front: false, back: true } } },
      },
      { "S/front.jpg": card, "S/back.jpg": card },
    );
    const recognizePair = vi.fn(async () => ({ result: result(), frontJpeg: null, backJpeg: null, faceSource: "front" as const }));
    await rerunStoredScan(scanId, { supabase, api, recognizer: { recognizePair } as unknown as CardRecognizer });
    expect((calls[0].body as { local: LocalRecognitionResult }).local.straightened).toEqual({ front: false, back: true });
  });

  it("says so when the scan or its images are gone", async () => {
    const missing = await setup(null, {});
    expect(await rerunStoredScan(scanId, { ...missing, recognizer: {} as CardRecognizer })).toMatchObject({ ok: false, status: 404 });
    const noImages = await setup({ front_image_path: "S/x.jpg", back_image_path: null }, {});
    expect(await rerunStoredScan(scanId, { ...noImages, recognizer: {} as CardRecognizer })).toMatchObject({ ok: false, status: 404 });
  });
});

describe("looksStraightened", () => {
  it("recognizes this PC's straightened copies by their exact card shape, at 300 or 600 dpi", async () => {
    const p = { id: "x", name: "X", set: "AAA", cn: "1", art: 1, symbol: 0 };
    expect(await looksStraightened(await renderCard(p, 744, 1039))).toBe(true);
    expect(await looksStraightened(await renderCard(p, 1488, 2078))).toBe(true);
    // A raw scan, a card-shaped thumbnail smaller than a straightened copy, nothing.
    expect(await looksStraightened(await renderCard(p, 900, 1200))).toBe(false);
    expect(await looksStraightened(await renderCard(p, 372, 519))).toBe(false);
    expect(await looksStraightened(null)).toBe(false);
  });
});
