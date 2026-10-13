import { describe, expect, it } from "vitest";
import { l2normalize, quantize, VectorIndex } from "./vectorIndex.js";

function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296 - 0.5;
  };
}

function library(n: number, dims: number, seed = 1) {
  const r = seeded(seed);
  const vectors = new Int8Array(n * dims);
  const scales = new Float32Array(n);
  const floats: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const v = l2normalize(Float32Array.from({ length: dims }, () => r()));
    floats.push(v);
    const { q, scale } = quantize(v);
    vectors.set(q, i * dims);
    scales[i] = scale;
  }
  return { index: new VectorIndex(dims, vectors, scales), floats };
}

describe("quantize", () => {
  it("keeps a unit vector to within a fraction of a percent", () => {
    const v = l2normalize(Float32Array.from({ length: 384 }, (_, i) => Math.sin(i)));
    const { q, scale } = quantize(v);
    const back = Float32Array.from(q, (x) => x * scale);
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += v[i] * back[i];
    expect(dot).toBeGreaterThan(0.999);
  });
});

describe("VectorIndex.search", () => {
  it("finds the exact entry first, with cosine ≈ 1", () => {
    const { index, floats } = library(500, 64);
    const [hits] = index.search([floats[123]], 5);
    expect(hits[0].row).toBe(123);
    expect(hits[0].score).toBeGreaterThan(0.99);
    expect(hits[1].score).toBeLessThan(0.6);
    // Best first.
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
  });

  it("scores several queries in one pass exactly as it scores them one at a time", () => {
    const { index, floats } = library(300, 32, 7);
    const queries = [floats[3], floats[40], floats[77], floats[250], floats[9]];
    const together = index.search(queries, 4);
    queries.forEach((q, i) => {
      const [alone] = index.search([q], 4);
      expect(together[i].map((h) => h.row)).toEqual(alone.map((h) => h.row));
    });
  });

  it("returns at most the library size and rejects a query of the wrong length", () => {
    const { index, floats } = library(3, 16);
    expect(index.search([floats[0]], 10)[0]).toHaveLength(3);
    expect(() => index.search([new Float32Array(8)], 1)).toThrow(/dims/);
  });
});
