import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOnnxEmbedder, type ImageEmbedder } from "../embedder.js";
import { decodeFit, decodeGray } from "../image.js";
import { LIBRARY_FORMAT, type Library } from "../indexStore.js";
import type { ReferenceProvider } from "../referenceImages.js";
import type { CatalogEntry } from "../types.js";
import { quantize, VectorIndex } from "../vectorIndex.js";
import { makeViews, VERIFY_HEIGHT, VERIFY_WIDTH } from "../verify.js";
import { renderCard, type SyntheticPrinting } from "./syntheticCards.js";

// A small in-memory card library for tests: synthetic printings rendered as
// Scryfall-style "normal" and "large" images, fingerprinted with the tiny
// stand-in model (src/recognizer/__fixtures__/tiny-fingerprint.onnx).

export const TINY_MODEL_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "tiny-fingerprint.onnx");

export function tinyEmbedder(): Promise<ImageEmbedder> {
  return createOnnxEmbedder({ modelPath: TINY_MODEL_PATH, modelId: "tiny-test", threads: 1 });
}

export function normalUrl(p: SyntheticPrinting, face = 0): string {
  return `https://cards.test/normal/front/${p.id}-${face}.jpg?1`;
}

export interface SyntheticLibrary {
  library: Library;
  references: ReferenceProvider;
  /** Every image served, by URL. */
  images: Map<string, Buffer>;
  /** How many times each URL was fetched. */
  fetches: Map<string, number>;
}

export async function buildSyntheticLibrary(
  printings: SyntheticPrinting[],
  embedder: ImageEmbedder,
  extraFaces: { of: string; face: SyntheticPrinting }[] = [],
): Promise<SyntheticLibrary> {
  const images = new Map<string, Buffer>();
  const fetches = new Map<string, number>();
  const entries: CatalogEntry[] = [];
  const add = async (owner: SyntheticPrinting, face: number, look: SyntheticPrinting) => {
    const url = normalUrl(owner, face);
    images.set(url, await renderCard(look, 488, 680));
    images.set(url.replace("/normal/", "/large/"), await renderCard(look, 672, 936));
    entries.push({
      id: owner.id,
      face,
      name: owner.name,
      set: owner.set,
      cn: owner.cn,
      lang: "en",
      ill: `ill-${look.art}`,
      img: url,
      finishes: ["nonfoil", "foil"],
      layout: extraFaces.some((f) => f.of === owner.id) ? "transform" : "normal",
    });
  };
  for (const p of printings) {
    await add(p, 0, p);
    const back = extraFaces.find((f) => f.of === p.id);
    if (back) await add(p, 1, back.face);
  }
  const vectors = await embedder.embed(await Promise.all(entries.map(async (e) => decodeFit(images.get(e.img)!, 680))));
  const dims = embedder.dims;
  const flat = new Int8Array(entries.length * dims);
  const scales = new Float32Array(entries.length);
  vectors.forEach((v, i) => {
    const { q, scale } = quantize(v);
    flat.set(q, i * dims);
    scales[i] = scale;
  });
  const library: Library = {
    manifest: {
      format: LIBRARY_FORMAT,
      model: { id: embedder.modelId, dims },
      builtAt: "2026-10-12T00:00:00.000Z",
      cardListRefreshedAt: "2026-09-16T03:22:29.000Z",
      entries: entries.length,
      printings: printings.length,
    },
    entries,
    index: new VectorIndex(dims, flat, scales),
  };
  const fetch = (url: string) => {
    fetches.set(url, (fetches.get(url) ?? 0) + 1);
    return images.get(url) ?? null;
  };
  const references: ReferenceProvider = {
    async views(url) {
      const b = fetch(url);
      return b ? makeViews(await decodeGray(b, VERIFY_WIDTH, VERIFY_HEIGHT)) : null;
    },
    async bytes(url) {
      return fetch(url);
    },
  };
  return { library, references, images, fetches };
}
