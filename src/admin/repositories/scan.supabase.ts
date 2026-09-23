// LIVE ScanRepository — backed by the real Supabase database + Storage.
//
// SECURITY MODEL (same established pattern as inventory.supabase.ts):
//   * READS use the browser client with the publishable key, gated by RLS
//     (scan_sessions_staff_select / card_scans_staff_select) and by the
//     staff-guarded SECURITY DEFINER RPC scan_filter_counts().
//   * WRITES never touch privileged SQL from the browser. They call
//     staff-guarded Vercel Functions under /api/admin/scan-sessions/* and
//     /api/admin/scans/* via adminFetch, which use the service-role key
//     server-side after verifying the caller's bearer token.
//   * Uploading physical scan bytes is the one exception to "reads only" for
//     the browser client: it uses a per-file SIGNED UPLOAD URL (minted
//     server-side, itself a privileged call) to PUT directly to the private
//     card-scans bucket — bytes never round-trip through a Vercel Function,
//     which would hit body-size/duration limits for hundreds of multi-MB
//     600 DPI scans. Viewing already-uploaded scans uses signed READ URLs,
//     which the browser CAN mint itself (gated by the same staff RLS read
//     policy on storage.objects), no server round trip needed.
//
// Commit reuses the SAME admin_upsert_inventory RPC (server-side, via
// api/_lib/scan.ts's commitScanToInventory) as manual inventory adds, just
// with reason='scan_add' / 'batch_scan_add', so scan-created inventory
// shares one movement ledger and one create-or-increment code path with
// every other write — never a second, divergent implementation.

import { supabase } from "../../supabase";
import { adminFetch } from "./apiClient";
import {
  mapCardScanRow,
  mapScanSessionRow,
  type CardScanRowLike,
  type ScanSessionRowLike,
} from "./scan.mapper";
import type {
  BatchCommitPreview,
  BatchCommitResult,
  CardScan,
  Page,
  ScanReviewPatch,
  ScanSession,
} from "../types";
import type {
  ScanIngestProgress,
  ScanRepository,
  UploadedScanFile,
} from "./types";

const SCAN_BUCKET = "card-scans";
const SIGNED_URL_TTL_SECONDS = 3600;
const UPLOAD_CONCURRENCY = 4;
const UPLOAD_URL_CHUNK = 40;
const INGEST_CHUNK = 200;
// Recognition concurrency is lower than upload's: each call does OCR +
// Scryfall candidate lookups + visual verification server-side, meaningfully
// heavier per-unit work than a Storage PUT (Part 15's "sensible concurrency
// limits" — this is what protects the OCR provider and Scryfall from a
// burst of hundreds of simultaneous calls).
const RECOGNITION_CONCURRENCY = 3;
const RECOGNITION_MAX_RETRIES = 2;
const RECOGNITION_RETRY_BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Recognize one scan, retrying with exponential backoff. One card's
 * exhausted retries never fail the batch — the caller just counts it. */
async function recognizeWithRetry(scanId: string): Promise<boolean> {
  for (let attempt = 0; attempt <= RECOGNITION_MAX_RETRIES; attempt++) {
    try {
      await adminFetch(`/api/admin/scans/${scanId}/recognize`, { method: "POST" });
      return true;
    } catch {
      if (attempt < RECOGNITION_MAX_RETRIES) {
        await sleep(RECOGNITION_RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }
  return false;
}

const SCAN_SELECT = "*, card_printings!selected_scryfall_id(*)";

/** Batch-resolve signed read URLs for a page of scans' front/back paths. */
async function resolveImageUrls(
  rows: CardScanRowLike[],
): Promise<Map<string, string>> {
  const paths = Array.from(
    new Set(
      rows
        .flatMap((r) => [
          r.front_image_path,
          r.back_image_path,
          r.front_preview_path,
          r.back_preview_path,
        ])
        .filter((p): p is string => !!p),
    ),
  );
  if (paths.length === 0) return new Map();
  const { data, error } = await supabase.storage
    .from(SCAN_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  const map = new Map<string, string>();
  if (error || !data) return map;
  for (const entry of data) {
    if (entry.signedUrl && !entry.error) map.set(entry.path ?? "", entry.signedUrl);
  }
  return map;
}

async function mapScansWithImages(rows: CardScanRowLike[]): Promise<CardScan[]> {
  const urlByPath = await resolveImageUrls(rows);
  return rows.map((row) =>
    mapCardScanRow(row, {
      frontImageUrl: row.front_image_path
        ? (urlByPath.get(row.front_image_path) ?? null)
        : null,
      backImageUrl: row.back_image_path
        ? (urlByPath.get(row.back_image_path) ?? null)
        : null,
      frontPreviewUrl: row.front_preview_path
        ? (urlByPath.get(row.front_preview_path) ?? null)
        : null,
      backPreviewUrl: row.back_preview_path
        ? (urlByPath.get(row.back_preview_path) ?? null)
        : null,
    }),
  );
}

/** Tiny concurrency-limited map — avoids overwhelming the browser/Storage
 * with hundreds of simultaneous uploads while still running several at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface UploadTarget {
  fileName: string;
  side: "front" | "back";
  sequenceHint: number;
  path?: string;
  token?: string;
  signedUrl?: string;
  error?: string;
}

export const supabaseScanRepository: ScanRepository = {
  async listSessions(): Promise<ScanSession[]> {
    const { data, error } = await supabase
      .from("scan_sessions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data as ScanSessionRowLike[]).map(mapScanSessionRow);
  },

  async getSession(id): Promise<ScanSession | null> {
    const { data, error } = await supabase
      .from("scan_sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapScanSessionRow(data as ScanSessionRowLike) : null;
  },

  async createSession(input): Promise<ScanSession> {
    // createdBy is NOT sent — the server derives it from the verified staff
    // session, never a client-supplied name (same posture as every other
    // privileged write in this app).
    const row = await adminFetch<ScanSessionRowLike>("/api/admin/scan-sessions", {
      method: "POST",
      body: { scannerName: input.scannerName, sourceType: input.sourceType, scanMode: input.scanMode },
    });
    return mapScanSessionRow(row);
  },

  async updateSessionStatus(id, status): Promise<ScanSession> {
    const row = await adminFetch<ScanSessionRowLike>(
      `/api/admin/scan-sessions/${id}`,
      { method: "PATCH", body: { status } },
    );
    return mapScanSessionRow(row);
  },

  async setSessionNote(id, note): Promise<ScanSession> {
    const row = await adminFetch<ScanSessionRowLike>(
      `/api/admin/scan-sessions/${id}`,
      { method: "PATCH", body: { note } },
    );
    return mapScanSessionRow(row);
  },

  async deleteSession(id): Promise<void> {
    await adminFetch(`/api/admin/scan-sessions/${id}`, { method: "DELETE" });
  },

  async ingestBatch(
    sessionId: string,
    files: UploadedScanFile[],
    onProgress?: (p: ScanIngestProgress) => void,
  ): Promise<{ created: CardScan[]; failed: number }> {
    let total = files.length;
    let processed = 0;
    let failed = 0;
    const report = () => onProgress?.({ total, processed, failed });

    // 1) Mint signed upload targets in chunks (keeps each request small).
    const targets: UploadTarget[] = [];
    for (const group of chunk(files, UPLOAD_URL_CHUNK)) {
      const res = await adminFetch<{ uploads: UploadTarget[] }>(
        `/api/admin/scan-sessions/${sessionId}/uploads`,
        {
          method: "POST",
          body: {
            files: group.map((f) => ({
              fileName: f.fileName,
              side: f.side,
              sequenceHint: f.sequenceHint,
            })),
          },
        },
      );
      targets.push(...res.uploads);
    }

    const byKey = new Map(
      files.map((f) => [`${f.sequenceHint}:${f.side}:${f.fileName}`, f]),
    );

    // 2) Upload each file's bytes directly to Storage, concurrency-limited.
    const uploaded: { fileName: string; side: "front" | "back"; sequenceHint: number; path: string }[] = [];
    await mapWithConcurrency(targets, UPLOAD_CONCURRENCY, async (target) => {
      const key = `${target.sequenceHint}:${target.side}:${target.fileName}`;
      const source = byKey.get(key);
      if (!source || target.error || !target.path || !target.token) {
        failed += 1;
        processed += 1;
        report();
        return;
      }
      const { error } = await supabase.storage
        .from(SCAN_BUCKET)
        .uploadToSignedUrl(target.path, target.token, source.file);
      if (error) {
        failed += 1;
      } else {
        uploaded.push({
          fileName: target.fileName,
          side: target.side,
          sequenceHint: target.sequenceHint,
          path: target.path,
        });
      }
      processed += 1;
      report();
    });

    // 3) Finalize successfully-uploaded files into card_scans rows.
    const created: CardScanRowLike[] = [];
    for (const group of chunk(uploaded, INGEST_CHUNK)) {
      if (group.length === 0) continue;
      const res = await adminFetch<{ created: CardScanRowLike[]; failed: number }>(
        `/api/admin/scan-sessions/${sessionId}/ingest`,
        { method: "POST", body: { uploads: group } },
      );
      created.push(...res.created);
      failed += res.failed;
    }

    // 4) Recognition happens automatically — no manual "recognize" click
    // per card (Part 15). Concurrency-limited with retries; one card's
    // exhausted retries is counted as failed but never blocks the rest of
    // the batch or fails ingestBatch itself (a scan that never got
    // recognized is still a real, persisted scan the operator can retry or
    // match manually).
    total += created.length;
    await mapWithConcurrency(created, RECOGNITION_CONCURRENCY, async (scan) => {
      const ok = await recognizeWithRetry(scan.id);
      if (!ok) failed += 1;
      processed += 1;
      report();
    });

    // Re-fetch so the returned scans reflect recognition results, not the
    // pre-recognition rows from step 3.
    const createdIds = created.map((c) => c.id);
    const fresh =
      createdIds.length > 0
        ? await supabase
            .from("card_scans")
            .select(SCAN_SELECT)
            .in("id", createdIds)
            .then((r) => (r.data ?? []) as CardScanRowLike[])
        : [];

    return { created: await mapScansWithImages(fresh), failed };
  },

  async listScans(sessionId, query): Promise<Page<CardScan>> {
    const { filter = "all", search = "", page = 1, pageSize = 50 } = query;

    let q = supabase
      .from("card_scans")
      .select(SCAN_SELECT, { count: "exact" })
      .eq("scan_session_id", sessionId);

    switch (filter) {
      case "unreviewed":
        q = q.eq("review_status", "unreviewed");
        break;
      case "pending_match":
        q = q.is("selected_scryfall_id", null).neq("review_status", "rejected");
        break;
      case "matched":
        q = q.not("selected_scryfall_id", "is", null).eq("review_status", "matched");
        break;
      case "needs_manual_match":
        q = q.eq("review_status", "needs_manual_match");
        break;
      case "ready":
        q = q.eq("review_status", "ready");
        break;
      case "added":
        q = q.eq("review_status", "added");
        break;
      case "rejected":
        q = q.eq("review_status", "rejected");
        break;
      case "missing_back":
        q = q.is("back_image_path", null);
        break;
      case "error":
        q = q.eq("review_status", "error");
        break;
      default:
        break;
    }

    // Search is applied client-side over the status-filtered set (not yet
    // exposed in the review UI, and card name/set/collector live on the
    // JOINED card_printings row, which PostgREST's OR-across-embedded-
    // resources filtering makes fragile to hand-build reliably). Fine at the
    // "hundreds of cards per session" scale this pipeline targets; revisit
    // with a dedicated RPC (like admin_search_inventory) if that changes.
    const trimmedSearch = search.trim().toLowerCase();
    q = q.order("sequence_number", { ascending: true });
    if (!trimmedSearch) {
      const start = (page - 1) * pageSize;
      q = q.range(start, start + pageSize - 1);
    }

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    let rows = (data ?? []) as CardScanRowLike[];

    if (trimmedSearch) {
      rows = rows.filter((r) => {
        const printing = Array.isArray(r.card_printings)
          ? r.card_printings[0]
          : r.card_printings;
        return (
          printing?.card_name.toLowerCase().includes(trimmedSearch) ||
          printing?.set_code.toLowerCase().includes(trimmedSearch) ||
          printing?.collector_number.toLowerCase().includes(trimmedSearch) ||
          String(r.sequence_number).includes(trimmedSearch)
        );
      });
      const total = rows.length;
      const start = (page - 1) * pageSize;
      rows = rows.slice(start, start + pageSize);
      return { rows: await mapScansWithImages(rows), total };
    }

    return { rows: await mapScansWithImages(rows), total: count ?? 0 };
  },

  async getScan(scanId): Promise<CardScan | null> {
    const { data, error } = await supabase
      .from("card_scans")
      .select(SCAN_SELECT)
      .eq("id", scanId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const [mapped] = await mapScansWithImages([data as CardScanRowLike]);
    return mapped;
  },

  async filterCounts(sessionId): Promise<Record<string, number>> {
    const { data, error } = await supabase.rpc("scan_filter_counts", {
      p_session_id: sessionId,
    });
    if (error) throw new Error(error.message);
    const row = (data as unknown as {
      all_count: number;
      unreviewed: number;
      pending_match: number;
      matched: number;
      needs_manual_match: number;
      ready: number;
      added: number;
      rejected: number;
      missing_back: number;
      error: number;
    }[])[0];
    if (!row) return {};
    return {
      all: row.all_count,
      unreviewed: row.unreviewed,
      pending_match: row.pending_match,
      matched: row.matched,
      needs_manual_match: row.needs_manual_match,
      ready: row.ready,
      added: row.added,
      rejected: row.rejected,
      missing_back: row.missing_back,
      error: row.error,
    };
  },

  async updateScan(scanId, patch: ScanReviewPatch): Promise<CardScan> {
    const row = await adminFetch<CardScanRowLike>(`/api/admin/scans/${scanId}`, {
      method: "PATCH",
      body: {
        selectedScryfallId: patch.selectedScryfallId,
        confirmedCondition: patch.confirmedCondition,
        selectedFinish: patch.selectedFinish,
        quantity: patch.quantity,
        priceCents: patch.priceCents,
        costCents: patch.costCents,
        storageLocation: patch.storageLocation,
        notes: patch.notes,
        reviewStatus: patch.reviewStatus,
      },
    });
    const [mapped] = await mapScansWithImages([row]);
    return mapped;
  },

  async deleteScan(scanId): Promise<void> {
    await adminFetch(`/api/admin/scans/${scanId}`, { method: "DELETE" });
  },

  async bulkUpdate(scanIds, patch, reviewer): Promise<CardScan[]> {
    const res = await adminFetch<{ scans: CardScanRowLike[] }>(
      "/api/admin/scans/bulk",
      {
        method: "PATCH",
        body: { scanIds, actor: reviewer, ...patch },
      },
    );
    return mapScansWithImages(res.scans);
  },

  async previewCommit(sessionId): Promise<BatchCommitPreview> {
    return adminFetch<BatchCommitPreview>(
      `/api/admin/scan-sessions/${sessionId}/commit`,
      { method: "GET" },
    );
  },

  async commitReady(sessionId, _reviewer): Promise<BatchCommitResult> {
    // reviewer is derived server-side from the verified staff session, not
    // trusted from the client — the parameter is kept for interface parity
    // with the mock.
    return adminFetch<BatchCommitResult>(
      `/api/admin/scan-sessions/${sessionId}/commit`,
      { method: "POST" },
    );
  },

  async commitScan(scanId, _reviewer): Promise<CardScan> {
    const row = await adminFetch<CardScanRowLike>(
      `/api/admin/scans/${scanId}/commit`,
      { method: "POST" },
    );
    const [mapped] = await mapScansWithImages([row]);
    return mapped;
  },
};
