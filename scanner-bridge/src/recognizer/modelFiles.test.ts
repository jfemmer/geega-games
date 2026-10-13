import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureModel, FINGERPRINT_MODEL, ocrModelPaths, type ModelSpec } from "./modelFiles.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "geega-models-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const bytes = Buffer.from("pretend this is an ONNX model");
const spec: ModelSpec = {
  id: "test-model",
  url: "https://models.test/model.onnx",
  sha256: createHash("sha256").update(bytes).digest("hex"),
  fileName: "model.onnx",
  inputSize: 224,
};

function fetchReturning(body: Buffer) {
  return vi.fn(async () => new Response(body, { status: 200, headers: { "content-length": String(body.length) } }));
}

describe("ensureModel", () => {
  it("downloads once, checks the hash, and reuses the verified file", async () => {
    const fetchImpl = fetchReturning(bytes);
    const progress: number[] = [];
    const file = await ensureModel(dir, spec, { fetchImpl, onProgress: (p) => progress.push(p.receivedBytes) });
    expect(readFileSync(file)).toEqual(bytes);
    expect(progress.at(-1)).toBe(bytes.length);
    expect(await ensureModel(dir, spec, { fetchImpl })).toBe(file);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses a download that doesn't match the published hash", async () => {
    await expect(ensureModel(dir, spec, { fetchImpl: fetchReturning(Buffer.from("tampered")) })).rejects.toThrow(/integrity/);
    expect(existsSync(path.join(dir, "model.onnx"))).toBe(false);
    expect(existsSync(path.join(dir, "model.onnx.download"))).toBe(false);
  });

  it("replaces a damaged file on disk", async () => {
    writeFileSync(path.join(dir, "model.onnx"), "corrupt");
    const fetchImpl = fetchReturning(bytes);
    const file = await ensureModel(dir, spec, { fetchImpl });
    expect(readFileSync(file)).toEqual(bytes);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("pins DINOv2 to a fixed Hugging Face commit and hash", () => {
    expect(FINGERPRINT_MODEL.url).toMatch(/\/resolve\/[0-9a-f]{40}\/onnx\/model\.onnx$/);
    expect(FINGERPRINT_MODEL.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("ocrModelPaths", () => {
  it("finds the PaddleOCR recogniser and its dictionary in the npm package", () => {
    const paths = ocrModelPaths();
    expect(paths?.recognitionPath).toMatch(/ch_PP-OCRv4_rec_infer\.onnx$/);
    expect(existsSync(paths!.dictionaryPath)).toBe(true);
  });
});
