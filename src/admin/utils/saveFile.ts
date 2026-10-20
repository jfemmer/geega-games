// Saving a file made in the admin (the yard sale sign's PDF, QR codes): on a
// phone or tablet, the share sheet (Save to Files, Print, AirDrop, Mail…),
// since a plain download there is easy to lose; anywhere else, a download.

/** Clicks a temporary link to download `href` as `filename`. */
export function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  // Long enough for the browser to start the download (a phone may open it first).
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function touchDevice(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Shares or downloads the file. Call it straight from a tap: phones only
 * open the share sheet right after one. If sharing isn't possible (or not
 * allowed just then), it downloads instead.
 */
export async function saveFile(blob: Blob, filename: string, title: string): Promise<"shared" | "downloaded" | "cancelled"> {
  if (touchDevice() && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return "shared";
      } catch (err) {
        // Closing the share sheet without picking anything isn't an error.
        if ((err as { name?: unknown } | null)?.name === "AbortError") return "cancelled";
      }
    }
  }
  downloadBlob(blob, filename);
  return "downloaded";
}
