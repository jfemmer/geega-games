import { describe, expect, it } from "vitest";
import { pairScannedFiles, sortScannedFileNames } from "./pairing.js";

describe("sortScannedFileNames", () => {
  it("sorts by trailing number, not lexically (avoids the 9-before-10 bug)", () => {
    const names = ["card_9.tif", "card_10.tif", "card_2.tif", "card_1.tif"];
    expect(sortScannedFileNames(names)).toEqual([
      "card_1.tif",
      "card_2.tif",
      "card_9.tif",
      "card_10.tif",
    ]);
  });

  it("handles zero-padded sequence numbers", () => {
    const names = ["img_00003.jpg", "img_00001.jpg", "img_00002.jpg"];
    expect(sortScannedFileNames(names)).toEqual([
      "img_00001.jpg",
      "img_00002.jpg",
      "img_00003.jpg",
    ]);
  });
});

describe("pairScannedFiles", () => {
  it("pairs consecutive files as front/back when duplex", () => {
    const files = ["c1_front.tif", "c1_back.tif", "c2_front.tif", "c2_back.tif"];
    expect(pairScannedFiles(files, true)).toEqual([
      { sequenceHint: 1, front: "c1_front.tif", back: "c1_back.tif" },
      { sequenceHint: 2, front: "c2_front.tif", back: "c2_back.tif" },
    ]);
  });

  it("gives the last card a null back when the count is odd (jam / lost page)", () => {
    const files = ["c1_front.tif", "c1_back.tif", "c2_front_only.tif"];
    expect(pairScannedFiles(files, true)).toEqual([
      { sequenceHint: 1, front: "c1_front.tif", back: "c1_back.tif" },
      { sequenceHint: 2, front: "c2_front_only.tif", back: null },
    ]);
  });

  it("treats every file as its own front-only card when not duplex", () => {
    const files = ["a.tif", "b.tif", "c.tif"];
    expect(pairScannedFiles(files, false)).toEqual([
      { sequenceHint: 1, front: "a.tif", back: null },
      { sequenceHint: 2, front: "b.tif", back: null },
      { sequenceHint: 3, front: "c.tif", back: null },
    ]);
  });

  it("returns an empty array for an empty batch", () => {
    expect(pairScannedFiles([], true)).toEqual([]);
    expect(pairScannedFiles([], false)).toEqual([]);
  });
});
