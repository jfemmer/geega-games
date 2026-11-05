import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiClient } from "./apiClient.js";
import { CARD_OUT_HEIGHT, CARD_OUT_WIDTH } from "./recognizer/cardFinder.js";
import { imageInfo } from "./recognizer/image.js";
import type { CardRecognizer } from "./recognizer/recognizer.js";

// "Re-run" in Scan Review for a card, done on this PC: the stored images are
// downloaded (staff can read the private card-scans bucket), recognized
// again with the current card library, and the answer posted to the same
// recognize endpoint a fresh scan uses. Nothing is re-uploaded.

const SCAN_BUCKET = "card-scans";
const CANONICAL_ASPECT = CARD_OUT_WIDTH / CARD_OUT_HEIGHT;

async function download(supabase: SupabaseClient, path: string | null): Promise<Buffer | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(SCAN_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Fallback for scans recognized before the server kept track: an image this
 * PC straightened is exactly the canonical card shape (744 × 1039, or that
 * shape at a 600 dpi scan's own resolution). A raw scan never is.
 */
export async function looksStraightened(image: Buffer | null): Promise<boolean> {
  if (!image) return false;
  const info = await imageInfo(image).catch(() => null);
  if (!info || info.width < CARD_OUT_WIDTH - 1 || info.height < CARD_OUT_HEIGHT - 1) return false;
  return Math.abs(info.width / info.height - CANONICAL_ASPECT) < 0.001;
}

interface StoredScan {
  id: string;
  front_image_path: string | null;
  back_image_path: string | null;
  recognition_data: { scannerPc?: { straightened?: { front?: unknown; back?: unknown } } } | null;
}

export async function rerunStoredScan(
  scanId: string,
  deps: { supabase: SupabaseClient; api: ApiClient; recognizer: CardRecognizer },
): Promise<{ ok: boolean; status: number; message: string }> {
  const { data, error } = await deps.supabase
    .from("card_scans")
    .select("id, front_image_path, back_image_path, recognition_data")
    .eq("id", scanId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, message: "Couldn't load that scan." };
  if (!data) return { ok: false, status: 404, message: "Scan not found." };
  const scan = data as unknown as StoredScan;

  const [front, back] = await Promise.all([
    download(deps.supabase, scan.front_image_path),
    download(deps.supabase, scan.back_image_path),
  ]);
  if (!front && !back) return { ok: false, status: 404, message: "This scan has no images to recognize." };

  // Don't touch the finish on a re-run — whatever the reviewer chose stays.
  const recognition = await deps.recognizer.recognizePair({ front, back, finish: null });
  const result = recognition.result;
  // Nothing is re-uploaded. When this run finds the face on the stored
  // "back" (an older bridge took the Magic card back for the face), the
  // server swaps the two stored images so the face shows as the front.
  const swapSides = result.sidesSwapped && !!front && !!back;
  if (result.sidesSwapped && !swapSides) {
    result.warnings = [...result.warnings, "The stored front image looks like the card's back — check the images."];
  }
  result.sidesSwapped = false;
  // Which stored images are this PC's straightened copies: as recorded when
  // they were first recognized, else judged from their shape. After a swap
  // each one keeps its own flag, now on the other side.
  const recorded = scan.recognition_data?.scannerPc?.straightened;
  const stored = {
    front: typeof recorded?.front === "boolean" ? recorded.front : await looksStraightened(front),
    back: typeof recorded?.back === "boolean" ? recorded.back : await looksStraightened(back),
  };
  result.straightened = swapSides ? { front: stored.back, back: stored.front } : stored;

  await deps.api.call(`/api/admin/scans/${scanId}/recognize`, {
    method: "POST",
    body: swapSides ? { local: result, swapSides: true } : { local: result },
  });
  return {
    ok: true,
    status: 200,
    message: swapSides
      ? "Re-recognized on the scanner PC. The card's face was on the back image, so the two images were swapped."
      : "Re-recognized on the scanner PC.",
  };
}
