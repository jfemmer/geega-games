import { describe, expect, it } from "vitest";
import { createOnnxLibrarySearch, jsLibrarySearch } from "./fastSearch.js";
import { l2normalize, quantize, VectorIndex } from "./vectorIndex.js";

// The ONNX Runtime library search must find exactly what the plain
// JavaScript search finds — it's only a faster way to do the same sums.

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnit(dims: number, random: () => number): Float32Array {
  const v = new Float32Array(dims);
  for (let d = 0; d < dims; d++) v[d] = random() - 0.5;
  return l2normalize(v);
}

function buildIndex(rows: Float32Array[], dims: number): VectorIndex {
  const vectors = new Int8Array(rows.length * dims);
  const scales = new Float32Array(rows.length);
  rows.forEach((v, i) => {
    const { q, scale } = quantize(v);
    vectors.set(q, i * dims);
    scales[i] = scale;
  });
  return new VectorIndex(dims, vectors, scales);
}

describe("createOnnxLibrarySearch", () => {
  it("finds the same nearest printings as the JavaScript search, best first", async () => {
    const random = seeded(42);
    const dims = 64;
    const rows = Array.from({ length: 3000 }, () => randomUnit(dims, random));
    const index = buildIndex(rows, dims);
    // Queries: noisy copies of known rows (a scan of a known card), plus one random.
    const targets = [17, 900, 2999];
    const queries: Float32Array[] = targets.map((t) => Float32Array.from(rows[t], (v) => v + (random() - 0.5) * 0.05));
    queries.push(randomUnit(dims, random));

    const onnx = await createOnnxLibrarySearch(index, 1);
    expect(onnx.kind).toBe("onnx");
    const fast = await onnx.search(queries, 10);
    const slow = await jsLibrarySearch(index).search(queries, 10);

    targets.forEach((t, j) => expect(fast[j][0].row).toBe(t));
    for (let j = 0; j < queries.length; j++) {
      expect(fast[j]).toHaveLength(10);
      // Same rows (the JS search rounds the query to 8 bits, so near-ties may swap places).
      expect(new Set(fast[j].map((h) => h.row))).toEqual(new Set(slow[j].map((h) => h.row)));
      for (let i = 1; i < fast[j].length; i++) expect(fast[j][i - 1].score).toBeGreaterThanOrEqual(fast[j][i].score);
      fast[j].forEach((h, i) => expect(h.score).toBeCloseTo(slow[j][i].score, 1));
    }
  });

  it("handles a library smaller than k, an empty library, no queries, and refuses a wrong-sized query", async () => {
    const random = seeded(7);
    const dims = 16;
    const small = await createOnnxLibrarySearch(buildIndex([randomUnit(dims, random), randomUnit(dims, random)], dims), 1);
    const [hits] = await small.search([randomUnit(dims, random)], 40);
    expect(hits).toHaveLength(2);
    expect(await small.search([], 5)).toEqual([]);
    await expect(small.search([new Float32Array(dims + 1)], 5)).rejects.toThrow(/dims/);

    const empty = await createOnnxLibrarySearch(new VectorIndex(dims, new Int8Array(0), new Float32Array(0)), 1);
    expect(await empty.search([randomUnit(dims, random)], 5)).toEqual([[]]);
  });
});
