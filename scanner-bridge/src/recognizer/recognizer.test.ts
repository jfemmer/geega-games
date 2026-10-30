import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createPaddleTextReader, type TextReader } from "./collectorOcr.js";
import type { ImageEmbedder } from "./embedder.js";
import { ocrModelPaths } from "./modelFiles.js";
import { CardRecognizer } from "./recognizer.js";
import { fakeCardBack, fakeScan, renderCard, type SyntheticPrinting } from "./testing/syntheticCards.js";
import { buildSyntheticLibrary, normalUrl, tinyEmbedder, type SyntheticLibrary } from "./testing/syntheticLibrary.js";

// End to end on synthetic cards: scan in (front + back, any way up, either
// side first), straightened JPEGs and an answer out. The fingerprint model
// here is a tiny stand-in, so these tests lean on the pixel check and the
// collector-number reader — the parts that decide between reprints.

const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const grizzlyA: SyntheticPrinting = { id: id(1), name: "Grizzly Test", set: "AAA", cn: "1", art: 11, symbol: 0 };
const grizzlyB: SyntheticPrinting = { id: id(2), name: "Grizzly Test", set: "BBB", cn: "77", art: 11, symbol: 1 };
const grizzlyA3: SyntheticPrinting = { id: id(3), name: "Grizzly Test", set: "AAA", cn: "3", art: 11, symbol: 0 };
const bolt: SyntheticPrinting = { id: id(4), name: "Lightning Test", set: "CCC", cn: "45", art: 22, symbol: 2 };
const ocean: SyntheticPrinting = { id: id(5), name: "Ocean Test", set: "DDD", cn: "9", art: 33, symbol: 3 };
const dfcFront: SyntheticPrinting = { id: id(6), name: "Werewolf Test", set: "EEE", cn: "100", art: 44, symbol: 1 };
const dfcBack: SyntheticPrinting = { ...dfcFront, name: "Wolf Side Test", art: 55 };

let embedder: ImageEmbedder;
let lib: SyntheticLibrary;
let reader: TextReader;
let recognizer: CardRecognizer;
let back: Buffer;

beforeAll(async () => {
  embedder = await tinyEmbedder();
  lib = await buildSyntheticLibrary([grizzlyA, grizzlyB, grizzlyA3, bolt, ocean, dfcFront], embedder, [{ of: dfcFront.id, face: dfcBack }]);
  const paths = ocrModelPaths()!;
  reader = await createPaddleTextReader(paths.recognitionPath, paths.dictionaryPath, 1);
  recognizer = new CardRecognizer({ embedder, library: lib.library, references: lib.references, reader, fallbackDpi: 300 });
  back = await fakeCardBack();
}, 60_000);

describe("CardRecognizer.recognizePair", () => {
  it("is sure about a plain card, and returns it straightened as the front", async () => {
    const r = await recognizer.recognizePair({ front: await fakeScan(bolt, { angle: 2 }), back, finish: "foil" });
    expect(r.result.decision).toBe("sure");
    expect(r.result.candidates[0]).toMatchObject({ scryfallId: bolt.id, face: 0 });
    expect(r.result.candidates[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.result).toMatchObject({
      engine: "scanner_pc",
      finish: "foil",
      orientation: 0,
      sidesSwapped: false,
      straightened: { front: true, back: true },
      library: { model: "tiny-test" },
    });
    expect(r.faceSource).toBe("front");
    const meta = await sharp(r.frontJpeg!).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 744, 1039]);
    expect(r.result.timingsMs.total).toBeGreaterThan(0);
  }, 30_000);

  it("uploads a 600 dpi scan at its own resolution, and still matches it", async () => {
    const scan = await fakeScan(bolt, { angle: 1 });
    const meta = await sharp(scan).metadata();
    const at600 = await sharp(scan)
      .resize(meta.width! * 2, meta.height! * 2)
      .jpeg({ quality: 92 })
      .withMetadata({ density: 600 })
      .toBuffer();
    const r = await recognizer.recognizePair({ front: at600, back: await sharp(back).resize(2200, 2800).jpeg().withMetadata({ density: 600 }).toBuffer(), finish: null });
    expect(r.result.decision).toBe("sure");
    expect(r.result.candidates[0].scryfallId).toBe(bolt.id);
    const front = await sharp(r.frontJpeg!).metadata();
    expect(Math.abs(front.width! - 1488)).toBeLessThanOrEqual(4);
    expect(Math.abs(front.width! / front.height! - 744 / 1039)).toBeLessThan(0.002);
    const backMeta = await sharp(r.backJpeg!).metadata();
    expect(backMeta.width!).toBeGreaterThan(1400);
  }, 30_000);

  it("uses the batch's resolution for a 600 dpi scan whose file doesn't say it", async () => {
    const scan = await fakeScan(bolt, { angle: 1 });
    const meta = await sharp(scan).metadata();
    // No density in the file: without the batch's 600 dpi, the bridge's own 300 would be assumed.
    const at600 = await sharp(scan).resize(meta.width! * 2, meta.height! * 2).jpeg({ quality: 92 }).toBuffer();
    const r = await recognizer.recognizePair({ front: at600, back: null, finish: null, dpi: 600 });
    expect(r.result.decision).toBe("sure");
    expect(r.result.candidates[0].scryfallId).toBe(bolt.id);
    const front = await sharp(r.frontJpeg!).metadata();
    expect(Math.abs(front.width! - 1488)).toBeLessThanOrEqual(4);
  }, 30_000);

  it("finds the face when the card went through face-down the other way, and upside down", async () => {
    const r = await recognizer.recognizePair({ front: back, back: await fakeScan(ocean, { angle: -2, upsideDown: true }), finish: null });
    expect(r.result.decision).toBe("sure");
    expect(r.result.candidates[0].scryfallId).toBe(ocean.id);
    expect(r.result).toMatchObject({ sidesSwapped: true, orientation: 180 });
    expect(r.faceSource).toBe("back");
  }, 30_000);

  it("tells reprints of the same art apart by the set symbol", async () => {
    const r = await recognizer.recognizePair({ front: await fakeScan(grizzlyB, { angle: 1.5, blur: 0.5 }), back, finish: null });
    expect(r.result.decision).toBe("sure");
    expect(r.result.candidates[0].scryfallId).toBe(grizzlyB.id);
    expect(r.result.decisionReason).toMatch(/told apart/);
  }, 30_000);

  it("reads the collector number when two printings look identical", async () => {
    const r = await recognizer.recognizePair({ front: await fakeScan(grizzlyA3, { angle: -1 }), back, finish: null });
    expect(r.result.candidates[0].scryfallId).toBe(grizzlyA3.id);
    expect(r.result.decision).toBe("sure");
    expect(r.result.ocrText).toMatch(/0003/);
  }, 30_000);

  it("only fingerprints the upside-down way when the right-way-up one didn't match", async () => {
    let fingerprinted = 0;
    const counting: ImageEmbedder = {
      modelId: embedder.modelId,
      dims: embedder.dims,
      embed: (images) => {
        fingerprinted += images.length;
        return embedder.embed(images);
      },
    };
    const r2 = new CardRecognizer({ embedder: counting, library: lib.library, references: lib.references, reader, fallbackDpi: 300 });
    const upright = await r2.recognizePair({ front: await fakeScan(bolt, { angle: 1 }), back, finish: null });
    expect(upright.result).toMatchObject({ decision: "sure", orientation: 0 });
    expect(fingerprinted).toBe(2);
    fingerprinted = 0;
    const upsideDown = await r2.recognizePair({ front: await fakeScan(bolt, { angle: 1, upsideDown: true }), back, finish: null });
    expect(upsideDown.result).toMatchObject({ decision: "sure", orientation: 180 });
    expect(upsideDown.result.candidates[0].scryfallId).toBe(bolt.id);
    expect(fingerprinted).toBe(4);
  }, 30_000);

  it("finds a double-faced card's other face even when it came through upside down", async () => {
    const r = await recognizer.recognizePair({
      front: await fakeScan(dfcFront, { angle: 1 }),
      back: await fakeScan(dfcBack, { angle: -1, upsideDown: true }),
      finish: null,
    });
    expect(r.result.candidates[0]).toMatchObject({ scryfallId: dfcFront.id, face: 0 });
    expect(r.result.sidesSwapped).toBe(false);
    // The other face is uploaded turned the right way up.
    const backUpload = await sharp(r.backJpeg!).raw().toBuffer({ resolveWithObject: true });
    const reference = await sharp(await renderCard(dfcBack, 744, 1039)).raw().toBuffer({ resolveWithObject: true });
    let diff = 0;
    for (let i = 0; i < backUpload.data.length; i += 97) diff += Math.abs(backUpload.data[i] - reference.data[i]);
    expect(diff / (backUpload.data.length / 97)).toBeLessThan(40);
  }, 30_000);

  it("matches either face of a double-faced card, preferring its front face", async () => {
    const r = await recognizer.recognizePair({
      front: await fakeScan(dfcBack, { angle: 1 }),
      back: await fakeScan(dfcFront, { angle: -1 }),
      finish: null,
    });
    expect(r.result.candidates[0].scryfallId).toBe(dfcFront.id);
    expect(r.result.candidates[0].face).toBe(0);
    expect(r.result.sidesSwapped).toBe(true);
  }, 30_000);

  it("won't call a reprint from a set the library doesn't have yet a sure match for the old printing", async () => {
    // Same art and set symbol as BBB #77, but from a newer set "NEW" that isn't in the card list.
    const newer: SyntheticPrinting = { ...grizzlyB, id: id(99), set: "NEW", cn: "5" };
    const r = await recognizer.recognizePair({ front: await fakeScan(newer, { angle: 1 }), back, finish: null });
    expect(r.result.candidates[0].scryfallId).toBe(grizzlyB.id);
    expect(r.result.decision).toBe("check");
    expect(r.result.candidates[0].confidence).toBeLessThan(0.9);
    expect(r.result.decisionReason).toMatch(/reads "NEW"/);
    expect(r.result.warnings.join(" ")).toMatch(/refresh the list/);
    expect(r.result.ocrText).toMatch(/NEW/);
  }, 30_000);

  it("reads the corner of a sure match to double-check it, and stays sure when it agrees", async () => {
    const r = await recognizer.recognizePair({ front: await fakeScan(grizzlyB, { angle: -1.5 }), back, finish: null });
    expect(r.result.decision).toBe("sure");
    expect(r.result.ocrText).toMatch(/BBB/);
    expect(r.result.timingsMs.read).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it("never says sure without Scryfall's reference images to check against", async () => {
    const offline = new CardRecognizer({
      embedder,
      library: lib.library,
      references: { views: async () => null, bytes: async () => null },
      reader: null,
      fallbackDpi: 300,
    });
    const r = await offline.recognizePair({ front: await fakeScan(bolt, { angle: 2 }), back: null, finish: null });
    expect(r.result.decision).not.toBe("sure");
    expect(r.result.warnings.join(" ")).toMatch(/reference images/);
    expect(r.result.visualSimilarity).toBeNull();
  }, 30_000);

  it("says none for something that isn't in the library, with a hint for a single back-side scan", async () => {
    const r = await recognizer.recognizePair({ front: back, back: null, finish: null });
    expect(r.result.decision).toBe("none");
    expect(r.result.warnings.join(" ")).toMatch(/back of the card/);
  }, 30_000);

  it("never picks The List's copy over the original, even when its reference matches better", async () => {
    // The List reprints a card down to its set symbol and collector line; a
    // sharper Scryfall scan of the copy made 9 of 10 Magic Origins Lightning
    // Javelins come back as The List's.
    const original: SyntheticPrinting = { id: id(20), name: "Javelin Test", set: "ORI", cn: "153", art: 66, symbol: 2 };
    const listCopy: SyntheticPrinting = { id: id(21), name: "Javelin Test", set: "PLST", cn: "ORI-153", art: 66, symbol: 2 };
    const listLib = await buildSyntheticLibrary([original, listCopy, bolt], embedder);
    const crisp = await renderCard(original, 488, 680);
    listLib.images.set(normalUrl(listCopy), crisp);
    listLib.images.set(normalUrl(original), await sharp(crisp).blur(1.8).jpeg({ quality: 60 }).toBuffer());
    const listRecognizer = new CardRecognizer({ embedder, library: listLib.library, references: listLib.references, reader, fallbackDpi: 300 });

    const r = await listRecognizer.recognizePair({ front: await fakeScan(original, { angle: 1 }), back, finish: null });
    const [first, second] = r.result.candidates;
    expect(second.visual!).toBeGreaterThan(first.visual!); // the copy did match better…
    expect(first.scryfallId).toBe(original.id); // …but the original comes first
    expect(second.scryfallId).toBe(listCopy.id);
    expect(r.result.decision).toBe("check");
    expect(r.result.decisionReason).toMatch(/^Javelin Test: ORI #153 or The List's copy of it \(PLST #ORI-153\)/);
    expect(r.result.decisionReason).toMatch(/planeswalker symbol in the bottom-left corner/);
  }, 30_000);

  it("refuses to run with no images", async () => {
    await expect(recognizer.recognizePair({ front: null, back: null, finish: null })).rejects.toThrow(/No scan image/);
  });
});
