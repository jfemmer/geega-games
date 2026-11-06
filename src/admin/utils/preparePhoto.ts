// Downsizes a phone photo to a JPEG at most MAX_PHOTO_EDGE pixels on its
// long edge before it's uploaded (smaller uploads, quicker emails and pages).
// Falls back to the original file when the browser can't decode it (HEIC on
// some browsers) or has no canvas.

const MAX_PHOTO_EDGE = 2000;
const JPEG_QUALITY = 0.86;

export async function preparePhoto(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    return blob ?? file;
  } catch {
    return file;
  }
}
