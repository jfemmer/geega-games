import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../../../_lib/http.js";
import { requireStaff, type StaffContext } from "../../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../../_lib/supabaseAdmin.js";
import { cachePrinting } from "../../../_lib/inventory.js";
import { scryfallCollection } from "../../../_lib/scryfall.js";
import { commitScanToInventory, getSessionOr404, recomputeSession } from "../../../_lib/scan.js";
import { normalizeScryfallCard } from "../../../../src/admin/services/scryfall.js";
import { approvalPatch, carriedPrice, QUICK_APPROVE_BATCH } from "../../../../src/admin/utils/scanApproval.js";
import type { CardCondition, CardFinish, FloorableRarity, InventoryPriceFloor } from "../../../../src/admin/types/index.js";
import type { Database } from "../../../../src/types/database.js";

// POST /api/admin/scan-sessions/:id/approve — Quick approve.
//
// Confirms the printing staff picked for each card, fills in finish, price,
// condition and location the way approving one card in review does
// (src/admin/utils/scanApproval.ts), and with addToInventory adds them to
// inventory straight away. The browser sends QUICK_APPROVE_BATCH cards per
// call, so each call stays short however big the session.
//
// Body: {
//   items: [{ scanId, scryfallId, priceCents? }],
//   condition: "NM" | "LP" | "MP" | "HP" | "DMG",   // for cards nobody graded yet
//   storageLocation?: string | null,                  // for cards without one yet
//   addToInventory: boolean
// }
//
// Never trusted beyond ids, same as a review PATCH: each printing is re-read
// from Scryfall here (one POST /cards/collection per 75 printings, today's
// prices), and each scan must belong to this session and not be added or
// rejected. A card that can't be approved (no price for its finish, a
// printing Scryfall doesn't know) is reported and left exactly as it was.
//
// Adding commits each card on its own through admin_upsert_inventory, the
// same path as "Add ready to inventory": one failure never undoes the
// others, and a card already added is never added twice.

export const config = { maxDuration: 60 };

type CardScanRow = Database["public"]["Tables"]["card_scans"]["Row"];
type CardScanUpdate = Database["public"]["Tables"]["card_scans"]["Update"];

const CONDITIONS = new Set<CardCondition>(["NM", "LP", "MP", "HP", "DMG"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LOCATION_LENGTH = 120;
/** Generous: QUICK_APPROVE_BATCH items of ~120 bytes each. */
const MAX_BODY_BYTES = 32 * 1024;

interface Item {
  scanId: string;
  scryfallId: string;
  priceCents: number | null;
}

interface Failure {
  scanId: string;
  sequenceNumber: number;
  reason: string;
}

function parseBody(body: Record<string, unknown>): {
  items: Item[];
  condition: CardCondition;
  storageLocation: string | null;
  addToInventory: boolean;
} {
  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, "No cards to approve.");
  if (body.items.length > QUICK_APPROVE_BATCH) {
    throw new HttpError(400, `Send at most ${QUICK_APPROVE_BATCH} cards at a time.`);
  }
  const seen = new Set<string>();
  const items: Item[] = body.items.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const scanId = typeof item.scanId === "string" ? item.scanId : "";
    const scryfallId = typeof item.scryfallId === "string" ? item.scryfallId : "";
    if (!UUID.test(scanId) || !UUID.test(scryfallId)) throw new HttpError(400, "Each card needs a scan id and a printing id.");
    if (seen.has(scanId)) throw new HttpError(400, "A card is in the batch twice.");
    seen.add(scanId);
    let priceCents: number | null = null;
    if (item.priceCents != null) {
      const cents = Number(item.priceCents);
      if (!Number.isInteger(cents) || cents <= 0) throw new HttpError(400, "Prices must be a positive number of cents.");
      priceCents = cents;
    }
    return { scanId, scryfallId, priceCents };
  });
  const condition = body.condition as CardCondition;
  if (!CONDITIONS.has(condition)) throw new HttpError(400, "Choose a condition for cards not graded yet.");
  let storageLocation: string | null = null;
  if (body.storageLocation != null) {
    if (typeof body.storageLocation !== "string") throw new HttpError(400, "Storage location must be text.");
    const trimmed = body.storageLocation.trim();
    if (trimmed.length > MAX_LOCATION_LENGTH) throw new HttpError(400, "Storage location is too long.");
    storageLocation = trimmed || null;
  }
  return { items, condition, storageLocation, addToInventory: body.addToInventory === true };
}

async function priceFloors(admin: ReturnType<typeof getSupabaseAdmin>): Promise<InventoryPriceFloor[]> {
  const { data, error } = await admin.from("inventory_price_floors").select("rarity, min_price_cents, updated_at, updated_by");
  if (error) throw new HttpError(500, "Could not load the price floors.");
  return (data ?? []).map((r) => ({
    rarity: r.rarity as FloorableRarity,
    minPriceCents: r.min_price_cents,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }));
}

function actorLabel(staff: StaffContext): string {
  return staff.email || staff.userId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const staff = await requireStaff(req);
    const sessionId = String(req.query.id ?? "");
    if (!UUID.test(sessionId)) throw new HttpError(400, "Session id is required.");
    const { items, condition, storageLocation, addToInventory } = parseBody(await readJsonBody(req, MAX_BODY_BYTES));

    const admin = getSupabaseAdmin();
    await getSessionOr404(admin, sessionId);

    const { data: rows, error: rowsErr } = await admin
      .from("card_scans")
      .select("*")
      .eq("scan_session_id", sessionId)
      .in(
        "id",
        items.map((i) => i.scanId),
      );
    if (rowsErr) throw new HttpError(500, "Could not load the scans.");
    const scans = new Map((rows ?? []).map((r) => [r.id, r as CardScanRow]));

    const [cards, floors] = await Promise.all([scryfallCollection(items.map((i) => i.scryfallId)), priceFloors(admin)]);

    const actor = actorLabel(staff);
    const now = new Date().toISOString();
    const cached = new Set<string>();
    const failures: Failure[] = [];
    let approved = 0;
    let created = 0;
    let incremented = 0;

    for (const item of items) {
      const scan = scans.get(item.scanId);
      const fail = (reason: string) => failures.push({ scanId: item.scanId, sequenceNumber: scan?.sequence_number ?? 0, reason });
      if (!scan) {
        fail("This card isn't in this session any more.");
        continue;
      }
      if (scan.inventory_item_id || scan.review_status === "added") continue; // already in inventory
      if (scan.review_status === "rejected") {
        fail("This card was rejected — open it in review to change that.");
        continue;
      }
      const card = cards.get(item.scryfallId);
      if (!card) {
        fail("Couldn't load that printing from Scryfall — try again in a moment.");
        continue;
      }
      const printing = normalizeScryfallCard(card);
      // A price typed in Quick approve, else the card's own price unless that
      // was for a different printing (see carriedPrice).
      const startPrice =
        item.priceCents ?? carriedPrice({ selectedScryfallId: scan.selected_scryfall_id, priceCents: scan.price_cents }, printing.scryfallId);
      const approval = approvalPatch(
        {
          selectedFinish: scan.selected_finish,
          priceCents: startPrice,
          confirmedCondition: scan.confirmed_condition,
          recognitionData: { finishGuess: (scan.recognition_data as { finishGuess?: CardFinish | null } | null)?.finishGuess ?? null },
        },
        printing,
        floors,
        condition,
      );
      if (!approval.ok) {
        fail(approval.reason);
        continue;
      }

      try {
        if (!cached.has(card.id)) {
          await cachePrinting(admin, card);
          cached.add(card.id);
        }
        const patch: CardScanUpdate = {
          selected_scryfall_id: printing.scryfallId,
          selected_finish: approval.patch.selectedFinish ?? scan.selected_finish,
          price_cents: approval.patch.priceCents ?? startPrice,
          confirmed_condition: approval.patch.confirmedCondition ?? scan.confirmed_condition,
          storage_location: scan.storage_location ?? storageLocation,
          review_status: "ready",
          reviewed_by: actor,
          reviewed_at: now,
        };
        const { data: updated, error: updateErr } = await admin
          .from("card_scans")
          .update(patch)
          .eq("id", scan.id)
          .neq("review_status", "added")
          .select("*")
          .maybeSingle();
        if (updateErr) throw new HttpError(500, "Could not save the approval.");
        if (!updated) continue; // added meanwhile by someone else
        approved++;

        if (addToInventory) {
          const outcome = await commitScanToInventory(admin, updated as CardScanRow, actor, "batch_scan_add", card);
          if (outcome.outcome === "created") created++;
          else incremented++;
        }
      } catch (err) {
        fail(err instanceof HttpError ? err.message : "Couldn't save this card — try again.");
      }
    }

    await recomputeSession(admin, sessionId);

    return sendJson(res, 200, {
      approvedCount: approved,
      addedCount: created + incremented,
      createdCount: created,
      incrementedCount: incremented,
      failures,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
