import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { l2normalize } from "./vectorIndex.js";
import type { RgbImage } from "./types.js";

// The visual fingerprint: DINOv2 (Meta, Apache-2.0), a vision model trained
// to recognise the same object across photos — exactly the "is this the
// same card art?" question. The ONNX export runs on the CPU through ONNX
// Runtime; no GPU, no cloud, no per-scan cost.
//
// The whole card is squashed to the model's square input, the same way for
// Scryfall reference images (when the library is built) and for scans, so
// the two always line up. The fingerprint combines the model's summary
// token with the average of its patch tokens: the summary captures the
// overall look, the patch average the layout.

export interface ImageEmbedder {
  readonly modelId: string;
  readonly dims: number;
  embed(images: RgbImage[]): Promise<Float32Array[]>;
}

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];
const MAX_BATCH = 16;

export interface OnnxEmbedderOptions {
  modelPath: string;
  modelId: string;
  inputSize?: number;
  threads?: number;
}

async function toInput(img: RgbImage, size: number, target: Float32Array, offset: number): Promise<void> {
  const { data } = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 3 },
  })
    .resize(size, size, { fit: "fill", kernel: "cubic" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const plane = size * size;
  for (let i = 0; i < plane; i++) {
    target[offset + i] = (data[i * 3] / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    target[offset + plane + i] = (data[i * 3 + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    target[offset + 2 * plane + i] = (data[i * 3 + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }
}

export async function createOnnxEmbedder(options: OnnxEmbedderOptions): Promise<ImageEmbedder> {
  const size = options.inputSize ?? 224;
  const session = await ort.InferenceSession.create(options.modelPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
    ...(options.threads ? { intraOpNumThreads: options.threads } : {}),
  });
  const inputName = session.inputNames[0];
  const pooledName = session.outputNames.find((n) => /pooler/i.test(n)) ?? null;
  const tokensName = session.outputNames.find((n) => /last_hidden_state/i.test(n)) ?? session.outputNames[0];
  let queue: Promise<unknown> = Promise.resolve();

  async function runBatch(images: RgbImage[]): Promise<Float32Array[]> {
    const plane = 3 * size * size;
    const input = new Float32Array(images.length * plane);
    await Promise.all(images.map((img, i) => toInput(img, size, input, i * plane)));
    const out = await session.run({ [inputName]: new ort.Tensor("float32", input, [images.length, 3, size, size]) });
    const tokens = out[tokensName];
    const tdims = tokens.dims as number[];
    const results: Float32Array[] = [];
    if (tdims.length === 3) {
      const [n, t, d] = tdims;
      const td = tokens.data as Float32Array;
      const pooled = pooledName ? (out[pooledName].data as Float32Array) : null;
      for (let b = 0; b < n; b++) {
        const cls = new Float32Array(d);
        const mean = new Float32Array(d);
        const base = b * t * d;
        for (let k = 0; k < d; k++) cls[k] = pooled ? pooled[b * d + k] : td[base + k];
        for (let s = 1; s < t; s++) {
          const row = base + s * d;
          for (let k = 0; k < d; k++) mean[k] += td[row + k];
        }
        const c = l2normalize(cls);
        const m = l2normalize(mean);
        const v = new Float32Array(d);
        for (let k = 0; k < d; k++) v[k] = c[k] + m[k];
        results.push(l2normalize(v));
      }
    } else if (tdims.length === 2) {
      const [n, d] = tdims;
      const td = tokens.data as Float32Array;
      for (let b = 0; b < n; b++) results.push(l2normalize(td.slice(b * d, (b + 1) * d)));
    } else {
      throw new Error(`Unexpected fingerprint model output shape [${tdims.join(", ")}].`);
    }
    return results;
  }

  // Some model exports only accept one image per run; that's discovered on
  // the first batch that fails and remembered.
  let maxBatch = MAX_BATCH;

  async function embedAll(images: RgbImage[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (let i = 0; i < images.length; ) {
      const batch = images.slice(i, i + maxBatch);
      try {
        results.push(...(await runBatch(batch)));
        i += batch.length;
      } catch (err) {
        if (batch.length === 1) throw err;
        maxBatch = 1;
      }
    }
    return results;
  }

  // Probe once so dims are known and a broken model fails loudly at startup.
  const probe = await embedAll([{ width: 8, height: 8, data: new Uint8Array(8 * 8 * 3).fill(128) }]);
  const dims = probe[0].length;
  if (!dims || probe[0].some((v) => !Number.isFinite(v))) {
    throw new Error("The fingerprint model produced invalid output on a test image.");
  }

  return {
    modelId: options.modelId,
    dims,
    embed(images: RgbImage[]): Promise<Float32Array[]> {
      // One run at a time: ONNX Runtime already uses every core per run.
      const run = queue.then(() => embedAll(images));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
