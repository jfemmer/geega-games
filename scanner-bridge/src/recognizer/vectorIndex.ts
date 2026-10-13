// Nearest-neighbour search over the fingerprint library.
//
// ~110k printings × 384 numbers is small enough to compare against every
// entry on each scan (brute force is exact — no approximate index that could
// quietly miss the right card). Vectors are stored as 8-bit integers with one
// scale per row: 4× less memory than floats and integer maths in the hot
// loop, at a precision cost far below the gap between "same art" and
// "different art".

export interface SearchHit {
  /** Row in the library. */
  row: number;
  /** Cosine similarity (vectors are unit length). */
  score: number;
}

export function l2normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

export function quantize(v: Float32Array): { q: Int8Array; scale: number } {
  let max = 0;
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i]);
    if (a > max) max = a;
  }
  const q = new Int8Array(v.length);
  if (max === 0) return { q, scale: 0 };
  const k = 127 / max;
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] * k);
  return { q, scale: max / 127 };
}

export class VectorIndex {
  readonly dims: number;
  readonly vectors: Int8Array;
  readonly scales: Float32Array;

  constructor(dims: number, vectors: Int8Array, scales: Float32Array) {
    if (vectors.length !== scales.length * dims) {
      throw new Error(`Library vectors (${vectors.length}) don't match ${scales.length} rows × ${dims} dims.`);
    }
    this.dims = dims;
    this.vectors = vectors;
    this.scales = scales;
  }

  get size(): number {
    return this.scales.length;
  }

  /** Reconstructed float vector for one row (tests and diagnostics). */
  vector(row: number): Float32Array {
    const out = new Float32Array(this.dims);
    const base = row * this.dims;
    const s = this.scales[row];
    for (let d = 0; d < this.dims; d++) out[d] = this.vectors[base + d] * s;
    return out;
  }

  /**
   * Top-k rows for each query, best first. All queries are scored in one
   * pass over the library so 4 queries (both sides × both orientations) cost
   * little more than 1.
   */
  search(queries: Float32Array[], k: number): SearchHit[][] {
    const dims = this.dims;
    const n = this.size;
    const qn = queries.length;
    if (qn === 0 || n === 0) return queries.map(() => []);
    const qs = queries.map((q) => {
      if (q.length !== dims) throw new Error(`Query has ${q.length} dims, library has ${dims}.`);
      return quantize(l2normalize(q));
    });
    const qq = qs.map((q) => q.q);
    const qscale = qs.map((q) => q.scale);
    const limit = Math.max(1, Math.min(k, n));
    const topRows = qs.map(() => new Int32Array(limit).fill(-1));
    const topScores = qs.map(() => new Float64Array(limit).fill(Number.NEGATIVE_INFINITY));
    const worst = new Float64Array(qn).fill(Number.NEGATIVE_INFINITY);
    const filled = new Int32Array(qn);
    const vec = this.vectors;
    const zero = new Int8Array(dims);

    const consider = (j: number, r: number, score: number) => {
      if (filled[j] < limit || score > worst[j]) {
        insertTop(topRows[j], topScores[j], filled[j], limit, r, score);
        if (filled[j] < limit) filled[j]++;
        worst[j] = topScores[j][filled[j] - 1];
      }
    };

    // Up to four queries per pass, each with its own local accumulator —
    // much faster in V8 than an inner loop over an array of queries.
    for (let start = 0; start < qn; start += 4) {
      const count = Math.min(4, qn - start);
      const q0 = qq[start];
      const q1 = count > 1 ? qq[start + 1] : zero;
      const q2 = count > 2 ? qq[start + 2] : zero;
      const q3 = count > 3 ? qq[start + 3] : zero;
      const s0 = qscale[start];
      const s1 = count > 1 ? qscale[start + 1] : 0;
      const s2 = count > 2 ? qscale[start + 2] : 0;
      const s3 = count > 3 ? qscale[start + 3] : 0;
      for (let r = 0; r < n; r++) {
        const base = r * dims;
        let a0 = 0;
        let a1 = 0;
        let a2 = 0;
        let a3 = 0;
        for (let d = 0; d < dims; d++) {
          const v = vec[base + d];
          a0 += v * q0[d];
          a1 += v * q1[d];
          a2 += v * q2[d];
          a3 += v * q3[d];
        }
        const rs = this.scales[r];
        consider(start, r, a0 * rs * s0);
        if (count > 1) consider(start + 1, r, a1 * rs * s1);
        if (count > 2) consider(start + 2, r, a2 * rs * s2);
        if (count > 3) consider(start + 3, r, a3 * rs * s3);
      }
    }
    return qs.map((_, j) => {
      const hits: SearchHit[] = [];
      for (let i = 0; i < filled[j]; i++) hits.push({ row: topRows[j][i], score: topScores[j][i] });
      return hits;
    });
  }
}

/** Inserts into a descending top list of `count` used slots (capacity `limit`). */
export function insertTop(
  rows: Int32Array,
  scores: Float64Array,
  count: number,
  limit: number,
  row: number,
  score: number,
): void {
  let i = Math.min(count, limit - 1);
  // Shift worse entries down.
  while (i > 0 && scores[i - 1] < score) {
    if (i < limit) {
      scores[i] = scores[i - 1];
      rows[i] = rows[i - 1];
    }
    i--;
  }
  scores[i] = score;
  rows[i] = row;
}
