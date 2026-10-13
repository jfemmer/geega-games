import { describe, expect, it } from "vitest";
import { createOnnxEmbedder } from "./embedder.js";
import { TINY_MODEL_PATH, tinyEmbedder } from "./testing/syntheticLibrary.js";
import type { RgbImage } from "./types.js";

// The ONNX Runtime plumbing, against a few-KB stand-in model with the same
// inputs/outputs as DINOv2's export (pixel_values → last_hidden_state,
// pooler_output). The real model is downloaded and checked on the PC.

function solid(r: number, g: number, b: number, w = 40, h = 56): RgbImage {
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    data[i * 3] = r;
    data[i * 3 + 1] = g;
    data[i * 3 + 2] = b;
  }
  return { width: w, height: h, data };
}

const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, v, i) => s + v * b[i], 0);

describe("createOnnxEmbedder", () => {
  it("learns its output size from the model and returns unit-length fingerprints", async () => {
    const e = await tinyEmbedder();
    expect(e.dims).toBe(16);
    const [v] = await e.embed([solid(200, 40, 40)]);
    expect(v).toHaveLength(16);
    expect(dot(v, v)).toBeCloseTo(1, 5);
  });

  it("gives the same image the same fingerprint and different images different ones", async () => {
    const e = await tinyEmbedder();
    const [red, red2, green] = await e.embed([solid(200, 40, 40), solid(200, 40, 40, 80, 112), solid(40, 200, 40)]);
    expect(dot(red, red2)).toBeGreaterThan(0.999);
    expect(dot(red, green)).toBeLessThan(0.9);
  });

  it("falls back to one image per run for a model exported with a fixed batch of one", async () => {
    const fixed = await createOnnxEmbedder({
      modelPath: TINY_MODEL_PATH.replace("tiny-fingerprint.onnx", "tiny-fingerprint-batch1.onnx"),
      modelId: "tiny-batch1",
      threads: 1,
    });
    const flexible = await tinyEmbedder();
    const images = [solid(200, 40, 40), solid(40, 200, 40), solid(40, 40, 200)];
    const one = await fixed.embed(images);
    const all = await flexible.embed(images);
    expect(one).toHaveLength(3);
    one.forEach((v, i) => expect(dot(v, all[i])).toBeCloseTo(1, 5));
  });

  it("handles more images than one batch, in order", async () => {
    const e = await tinyEmbedder();
    const images = Array.from({ length: 21 }, (_, i) => solid(i * 12, 255 - i * 12, 90));
    const all = await e.embed(images);
    const last = await e.embed([images[20]]);
    expect(all).toHaveLength(21);
    expect(dot(all[20], last[0])).toBeCloseTo(1, 5);
  });
});
