import * as ort from "onnxruntime-node";
import { insertTop, l2normalize, type SearchHit, type VectorIndex } from "./vectorIndex.js";

// Library search through ONNX Runtime.
//
// Comparing a scan with every printing is one matrix multiply: the library
// (~110k fingerprints × 384 numbers) times the scan's fingerprints. In a
// JavaScript loop that's ~350 ms per card; ONNX Runtime's optimised,
// multi-threaded matrix code — already loaded for the fingerprint model —
// does it in ~15 ms. Still exact: every printing is scored, nothing is
// approximated away.
//
// The graph is a single MatMul, small enough to embed here instead of
// shipping a file (regenerate with scripts/make-search-model.py):
//   library [rows × dims] · queries [dims × count] → scores [rows × count]

const SEARCH_MODEL_BASE64 =
  "CAcSFGdlZWdhLXNjYW5uZXItYnJpZGdlOp4BCiIKB2xpYnJhcnkKB3F1ZXJpZXMSBnNjb3JlcyIGTWF0TXVsEg5saWJyYXJ5LXNlYXJjaFohCgdsaWJyYXJ5EhYKFAgBEhAKBhIEcm93cwoGEgRkaW1zWiIKB3F1ZXJpZXMSFwoVCAESEQoGEgRkaW1zCgcSBWNvdW50YiEKBnNjb3JlcxIXChUIARIRCgYSBHJvd3MKBxIFY291bnRCBAoAEA0=";

/** Finds the library rows closest to each query fingerprint, best first. */
export interface LibrarySearch {
  readonly kind: "onnx" | "js";
  search(queries: Float32Array[], k: number): Promise<SearchHit[][]>;
}

/** The plain JavaScript search (VectorIndex.search) behind the same interface — the fallback. */
export function jsLibrarySearch(index: VectorIndex): LibrarySearch {
  return { kind: "js", search: async (queries, k) => index.search(queries, k) };
}

/**
 * Builds the ONNX Runtime search for a library. Holds a float copy of the
 * fingerprints (4 bytes × rows × dims, ~170 MB for the full card list) so
 * every search is a single run with no conversion.
 */
export async function createOnnxLibrarySearch(index: VectorIndex, threads = 2): Promise<LibrarySearch> {
  const rows = index.size;
  const dims = index.dims;
  const library = new Float32Array(rows * dims);
  for (let r = 0; r < rows; r++) {
    const s = index.scales[r];
    const base = r * dims;
    for (let d = 0; d < dims; d++) library[base + d] = index.vectors[base + d] * s;
  }
  const session = await ort.InferenceSession.create(Buffer.from(SEARCH_MODEL_BASE64, "base64"), {
    executionProviders: ["cpu"],
    intraOpNumThreads: Math.max(1, threads),
    graphOptimizationLevel: "all",
  });
  const libraryTensor = rows > 0 ? new ort.Tensor("float32", library, [rows, dims]) : null;

  return {
    kind: "onnx",
    async search(queries: Float32Array[], k: number): Promise<SearchHit[][]> {
      const count = queries.length;
      if (count === 0 || !libraryTensor) return queries.map(() => []);
      // queries as a [dims × count] matrix (column j = query j, unit length).
      const matrix = new Float32Array(dims * count);
      queries.forEach((q, j) => {
        if (q.length !== dims) throw new Error(`Query has ${q.length} dims, library has ${dims}.`);
        const unit = l2normalize(q);
        for (let d = 0; d < dims; d++) matrix[d * count + j] = unit[d];
      });
      const out = await session.run({ library: libraryTensor, queries: new ort.Tensor("float32", matrix, [dims, count]) });
      const scores = out.scores.data as Float32Array;
      const limit = Math.max(1, Math.min(k, rows));
      return queries.map((_, j) => {
        const topRows = new Int32Array(limit).fill(-1);
        const topScores = new Float64Array(limit).fill(Number.NEGATIVE_INFINITY);
        let filled = 0;
        let worst = Number.NEGATIVE_INFINITY;
        for (let r = 0, i = j; r < rows; r++, i += count) {
          const score = scores[i];
          if (filled < limit || score > worst) {
            insertTop(topRows, topScores, filled, limit, r, score);
            if (filled < limit) filled++;
            worst = topScores[filled - 1];
          }
        }
        const hits: SearchHit[] = [];
        for (let i = 0; i < filled; i++) hits.push({ row: topRows[i], score: topScores[i] });
        return hits;
      });
    },
  };
}
