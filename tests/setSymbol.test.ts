import { describe, expect, it } from "vitest";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import { identifySetFromSymbol, hashSetSymbolSvg } from "../api/_lib/recognition/setSymbol";
import { computeImageHash } from "../api/_lib/recognition/imageHash";
import { REGIONS } from "../api/_lib/recognition/imageRegions";

// identifySetFromSymbol is the entry point for the "set-first" pipeline: it
// must degrade to "no match" rather than throw when the admin client can't
// be reached (mirrors recognitionPipeline.test.ts's fakeAdmin — a blank scan
// with no cache access must still resolve, never crash the whole pipeline
// over a set-lookup problem), and it must actually find a real hash match
// when one exists in the cache, not just the empty-cache path.

const CARD_WIDTH = 500;
const CARD_HEIGHT = 700;

/** A "normalized card" buffer with a distinct solid-color patch positioned
 * exactly where REGIONS.setSymbol crops from — so computing that region's
 * real hash and comparing against what identifySetFromSymbol finds is a
 * genuine end-to-end check, not just a mocked-out shortcut. */
async function fakeNormalizedCard(symbolColor: { r: number; g: number; b: number }): Promise<Buffer> {
  const rect = REGIONS.setSymbol;
  const symbolLeft = Math.round(rect.x * CARD_WIDTH);
  const symbolTop = Math.round(rect.y * CARD_HEIGHT);
  const symbolWidth = Math.round(rect.width * CARD_WIDTH);
  const symbolHeight = Math.round(rect.height * CARD_HEIGHT);

  const patch = await sharp({
    create: { width: symbolWidth, height: symbolHeight, channels: 3, background: symbolColor },
  })
    .png()
    .toBuffer();

  return sharp({
    create: { width: CARD_WIDTH, height: CARD_HEIGHT, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: patch, left: symbolLeft, top: symbolTop }])
    .png()
    .toBuffer();
}

async function realSetSymbolHash(symbolColor: { r: number; g: number; b: number }): Promise<bigint> {
  const card = await fakeNormalizedCard(symbolColor);
  const rect = REGIONS.setSymbol;
  const crop = await sharp(card)
    .extract({
      left: Math.round(rect.x * CARD_WIDTH),
      top: Math.round(rect.y * CARD_HEIGHT),
      width: Math.round(rect.width * CARD_WIDTH),
      height: Math.round(rect.height * CARD_HEIGHT),
    })
    .png()
    .toBuffer();
  return computeImageHash(crop);
}

function fakeAdminReturning(rows: { set_code: string; hash: string }[] | null, throwInstead = false) {
  if (throwInstead) {
    // Mirrors recognitionPipeline.test.ts's `{} as unknown as SupabaseClient`
    // — .from() isn't even a function, so calling it throws synchronously.
    return {} as unknown as SupabaseClient<Database>;
  }
  return {
    from: () => ({
      select: async () => ({ data: rows, error: rows ? null : { message: "boom" } }),
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("identifySetFromSymbol", () => {
  it("returns no match (never throws) when the admin client is unreachable", async () => {
    const admin = fakeAdminReturning(null, true);
    const card = await fakeNormalizedCard({ r: 10, g: 20, b: 30 });
    const result = await identifySetFromSymbol(admin, card, CARD_WIDTH, CARD_HEIGHT);
    expect(result.best).toBeNull();
    expect(result.alternates).toEqual([]);
    // Still computed the crop for debug display — only the DB lookup failed.
    expect(result.cropDebugPng.length).toBeGreaterThan(0);
  });

  it("returns no match when the cache is empty", async () => {
    const admin = fakeAdminReturning([]);
    const card = await fakeNormalizedCard({ r: 10, g: 20, b: 30 });
    const result = await identifySetFromSymbol(admin, card, CARD_WIDTH, CARD_HEIGHT);
    expect(result.best).toBeNull();
  });

  it("returns no match (never throws) when the query itself errors", async () => {
    const admin = fakeAdminReturning(null);
    const card = await fakeNormalizedCard({ r: 10, g: 20, b: 30 });
    const result = await identifySetFromSymbol(admin, card, CARD_WIDTH, CARD_HEIGHT);
    expect(result.best).toBeNull();
  });

  it("finds a real cached hash within the similarity threshold", async () => {
    const targetColor = { r: 200, g: 30, b: 30 };
    const hash = await realSetSymbolHash(targetColor);
    const admin = fakeAdminReturning([
      { set_code: "mh2", hash: hash.toString() },
      { set_code: "unrelated", hash: (hash ^ 0xffffffffffffffffn).toString() }, // maximally different
    ]);

    const card = await fakeNormalizedCard(targetColor);
    const result = await identifySetFromSymbol(admin, card, CARD_WIDTH, CARD_HEIGHT);

    expect(result.best?.setCode).toBe("MH2");
    expect(result.best?.confidence).toBeGreaterThan(0.9);
  });

  it("does not match a cached hash beyond the similarity threshold", async () => {
    // dHash encodes left-right GRADIENT direction, not absolute color — two
    // flat-colored patches can legitimately hash close to each other
    // regardless of which colors are picked, so a reliable "too different"
    // fixture needs a controlled bit distance from a real hash, not a hope
    // that two hand-picked synthetic images differ enough after the
    // algorithm's 9x8 downsampling.
    const targetColor = { r: 80, g: 160, b: 40 };
    const hash = await realSetSymbolHash(targetColor);
    // Flip 20 of the 64 bits — comfortably past setSymbolMaxHashDistance
    // (12), well short of the "maximally different" 64 already covered by
    // the "finds a match" test's negative fixture.
    let farHash = hash;
    for (let bit = 0; bit < 20; bit++) farHash ^= 1n << BigInt(bit);
    const admin = fakeAdminReturning([{ set_code: "unrelated", hash: farHash.toString() }]);

    const card = await fakeNormalizedCard(targetColor);
    const result = await identifySetFromSymbol(admin, card, CARD_WIDTH, CARD_HEIGHT);
    expect(result.best).toBeNull();
  });
});

describe("hashSetSymbolSvg", () => {
  it("produces a stable hash for the same SVG rasterized twice", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="black"/></svg>',
    );
    const a = await hashSetSymbolSvg(svg);
    const b = await hashSetSymbolSvg(svg);
    expect(a).toBe(b);
  });

  it("produces different hashes for visibly different shapes", async () => {
    const circle = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="black"/></svg>',
    );
    const square = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" fill="black"/></svg>',
    );
    const a = await hashSetSymbolSvg(circle);
    const b = await hashSetSymbolSvg(square);
    expect(a).not.toBe(b);
  });
});
