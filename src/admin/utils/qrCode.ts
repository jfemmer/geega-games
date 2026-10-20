import qrcode from "qrcode-generator";
import { triggerDownload } from "./saveFile";

// QR codes for the Marketing page and referral partners' links, drawn from
// qrcode-generator's module grid as one SVG path: crisp at any print size, and
// no HTML injected. Error correction "M" (about 15% recoverable) survives a
// slightly smudged print or a phone camera at an angle. The <QrCode>
// component (components/partners/QrCode.tsx) draws the same path.

/** The dark modules as an SVG path, plus the grid size (including the quiet zone). */
export function qrPath(value: string, margin = 4): { path: string; size: number } {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) path += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  return { path, size: count + margin * 2 };
}

/** A standalone SVG document, for downloading. */
export function qrSvgDocument(value: string, pixels = 1024): string {
  const { path, size } = qrPath(value);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

export function downloadQrSvg(value: string, filename: string) {
  const blob = new Blob([qrSvgDocument(value)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename.endsWith(".svg") ? filename : `${filename}.svg`);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Rasterizes the QR code to a PNG (for apps that don't take SVG, like most phone photo tools). */
export async function downloadQrPng(value: string, filename: string, pixels = 1024): Promise<void> {
  const svgUrl = URL.createObjectURL(new Blob([qrSvgDocument(value, pixels)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Couldn't draw the QR code."));
      img.src = svgUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = pixels;
    canvas.height = pixels;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't draw the QR code.");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, pixels, pixels);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Couldn't save the QR code.");
    const pngUrl = URL.createObjectURL(blob);
    triggerDownload(pngUrl, filename.endsWith(".png") ? filename : `${filename}.png`);
    window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
