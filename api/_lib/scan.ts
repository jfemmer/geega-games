import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";
import { HttpError } from "./http.js";
import { scryfallResolveExact } from "./scryfall.js";
import { cachePrinting } from "./inventory.js";

// Server-side helpers shared by /api/admin/scan-sessions/* — the real,
// Supabase-backed replacement for mockScanRepository's in-memory logic. Kept
// close in shape to that mock (see src/admin/repositories/scan.mock.ts) so
// the two stay easy to compare, but every write here is a real, staff-gated,
// transactional database change.

type Admin = SupabaseClient<Database>;
type ScanSessionRow = Database["public"]["Tables"]["scan_sessions"]["Row"];
type CardScanRow = Database["public"]["Tables"]["card_scans"]["Row"];

export const SCAN_BUCKET = "card-scans";

/** Fetch a scan session or throw a clean 404. */
export async function getSessionOr404(
  admin: Admin,
  id: string,
): Promise<ScanSessionRow> {
  const { data, error } = await admin
    .from("scan_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(500, "Could not load the scan session.");
  if (!data) throw new HttpError(404, "Scan session not found.");
  return data;
}

/** Fetch a card scan (scoped to a session) or throw a clean 404. */
export async function getScanOr404(
  admin: Admin,
  sessionId: string,
  scanId: string,
): Promise<CardScanRow> {
  const { data, error } = await admin
    .from("card_scans")
    .select("*")
    .eq("id", scanId)
    .eq("scan_session_id", sessionId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Could not load the scan.");
  if (!data) throw new HttpError(404, "Scan not found in this session.");
  return data;
}

/**
 * Recompute a session's rollup counters + lifecycle status from its scans.
 * Call after any mutation to card_scans (ingest, review patch, bulk update,
 * commit) — mirrors the mock's recomputeSession, but as one transactional
 * DB round trip (public.recompute_scan_session).
 */
export async function recomputeSession(
  admin: Admin,
  sessionId: string,
): Promise<ScanSessionRow> {
  const { data, error } = await admin.rpc("recompute_scan_session", {
    p_session_id: sessionId,
  });
  if (error) throw new HttpError(500, "Could not update session progress.");
  return data as ScanSessionRow;
}

/** A file identified by the client for pairing/storage purposes. */
export interface ScanFileRef {
  fileName: string;
  side: "front" | "back";
  sequenceHint: number;
}

/** Build a collision-resistant, readable storage path for one uploaded file. */
export function buildStoragePath(
  sessionId: string,
  file: ScanFileRef,
): string {
  const safeName = file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const unique =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${sessionId}/${file.sequenceHint}-${file.side}-${unique}-${safeName}`;
}

/**
 * Idempotency guard for ingest: given the Storage paths already attached to
 * some scan in this session, drop any upload referencing one of them. A
 * retried ingest call (uploads already succeeded, but the client never saw
 * the first call's response) resubmits the SAME paths — those must be
 * skipped rather than re-inserted, or a retry would double a physical scan.
 * Pure so it's trivial to test without a real database.
 */
export function filterUnseenUploads<T extends { path: string }>(
  existingPaths: ReadonlySet<string>,
  uploads: T[],
): T[] {
  return uploads.filter((u) => !existingPaths.has(u.path));
}

/**
 * Pair uploaded files into logical card scans by sequenceHint (front/back of
 * the same physical card share a hint). Mirrors the mock's pairFiles exactly.
 */
export function pairUploads<T extends ScanFileRef & { path: string }>(
  files: T[],
): { front: T | null; back: T | null }[] {
  const byHint = new Map<number, { front: T | null; back: T | null }>();
  for (const f of files) {
    const entry = byHint.get(f.sequenceHint) ?? { front: null, back: null };
    if (f.side === "back") entry.back = f;
    else entry.front = f;
    byHint.set(f.sequenceHint, entry);
  }
  return Array.from(byHint.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

/** Returns a human reason string if a scan is NOT ready to commit, else null. */
export function validateScanForCommit(scan: CardScanRow): string | null {
  if (scan.inventory_item_id) return null; // already added → idempotent no-op
  if (!scan.selected_scryfall_id) return "No exact printing selected.";
  if (!scan.confirmed_condition) return "No condition selected.";
  if (!scan.selected_finish) return "No finish selected.";
  if (!Number.isFinite(scan.quantity) || scan.quantity < 1)
    return "Quantity must be at least 1.";
  if (scan.price_cents == null || scan.price_cents <= 0)
    return "Selling price is required.";
  return null;
}

export interface CommitOutcome {
  outcome: "created" | "incremented";
  inventoryItemId: string;
}

/**
 * Commit one scan to inventory. Idempotent: a scan already carrying
 * inventory_item_id is a no-op (returns its existing link). Re-resolves the
 * exact printing from Scryfall server-side (never trusts a client-supplied
 * printing) before writing, same as the inventory PATCH/POST endpoints.
 * admin_upsert_inventory does the atomic create-or-increment + movement
 * write in one transaction; p_reason records this came from the scanner.
 */
export async function commitScanToInventory(
  admin: Admin,
  scan: CardScanRow,
  actor: string,
  reason: "scan_add" | "batch_scan_add",
): Promise<CommitOutcome> {
  if (scan.inventory_item_id) {
    return { outcome: "incremented", inventoryItemId: scan.inventory_item_id };
  }
  const problem = validateScanForCommit(scan);
  if (problem) throw new HttpError(400, problem);

  const card = await scryfallResolveExact({
    scryfallId: scan.selected_scryfall_id,
    finish: scan.selected_finish,
  });
  if (!card) {
    throw new HttpError(
      400,
      "Could not re-resolve this card's exact Scryfall printing. Find the match again.",
    );
  }
  await cachePrinting(admin, card);

  // Informational only (reporting created-vs-incremented in the result) —
  // admin_upsert_inventory re-checks this itself, atomically, under a row
  // lock, so a race here can't cause a duplicate or lost update.
  const { data: existing } = await admin
    .from("inventory_items")
    .select("id")
    .eq("status", "active")
    .eq("scryfall_id", card.id)
    .eq("condition", scan.confirmed_condition!)
    .eq("finish", scan.selected_finish!)
    .limit(1)
    .maybeSingle();

  // The generated RPC arg types mark params without a SQL default as
  // non-null, but the SQL columns accept null (oracle_id, type_line). Build
  // the real args (nulls included) and cast, same as /api/admin/inventory —
  // see that file's comment for the full explanation.
  const upsertArgs = {
    p_scryfall_id: card.id,
    p_oracle_id: card.oracle_id ?? null,
    p_card_name: card.name,
    p_set_code: card.set.toUpperCase(),
    p_set_name: card.set_name,
    p_collector_number: card.collector_number,
    p_rarity: card.rarity,
    p_type_line: card.type_line ?? null,
    p_image_url:
      card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? "",
    p_condition: scan.confirmed_condition!,
    p_finish: scan.selected_finish!,
    p_quantity: scan.quantity,
    p_price_cents: scan.price_cents!,
    p_cost_cents: scan.cost_cents ?? undefined,
    p_storage_location: scan.storage_location ?? undefined,
    p_notes: scan.notes ?? undefined,
    p_actor: actor,
    p_reason: reason,
  } as Database["public"]["Functions"]["admin_upsert_inventory"]["Args"];

  const { data: row, error } = await admin.rpc("admin_upsert_inventory", upsertArgs);
  if (error) throw new HttpError(500, error.message);
  const inventoryItemId = (row as { id: string }).id;

  const { error: updateErr } = await admin
    .from("card_scans")
    .update({
      inventory_item_id: inventoryItemId,
      review_status: "added",
      reviewed_by: actor,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", scan.id);
  if (updateErr) throw new HttpError(500, "Could not link the committed scan.");

  return {
    outcome: existing ? "incremented" : "created",
    inventoryItemId,
  };
}
