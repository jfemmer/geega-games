import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff, type StaffContext } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { scryfallResolveExact } from "../../_lib/scryfall.js";
import {
  availableFinishesForCard,
  cachePrinting,
  inventoryDeleteBlockers,
  printingColumnsFromCard,
  type InventoryRow,
} from "../../_lib/inventory.js";
import type { Database } from "../../../src/types/database.js";

// PATCH  /api/admin/inventory/:id  — edit a line (fields and/or exact printing)
// DELETE /api/admin/inventory/:id  — permanently delete a mistake-entry line
//
// PATCH supports two kinds of change, safely combined in one request:
//
//   1. FIELD EDITS (price, cost, reference price, storage, SKU, notes, image,
//      listing status). Quantity is NEVER changed here — it always flows through
//      /adjust so it is recorded in the movement ledger. A status change is
//      routed through admin_set_inventory_status so it also writes a movement.
//
//   2. PRINTING / IDENTITY EDITS (a different exact Scryfall printing, and/or a
//      different condition or finish). The server RE-RESOLVES the exact printing
//      from Scryfall (id preferred, else set+collector+name) — it never trusts
//      client-supplied printing metadata — then:
//        * constrains the finish to the printing's available finishes (400 when
//          the requested finish is unavailable and can't be defaulted),
//        * refreshes ALL denormalized printing columns + image together,
//        * keeps the legacy `foil` column in sync with the finish,
//        * blocks a duplicate identity (scryfall_id + condition + finish) among
//          other active rows with a friendly 409,
//        * caches the printing in card_printings.
//
// HTTP: 400 invalid input · 404 missing item · 409 duplicate/conflict ·
//       401/403 auth · 500 only for genuine unexpected failures. Raw Postgres
//       errors are never forwarded to the UI.

interface Body {
  // Field edits
  priceCents?: number | null;
  costCents?: number | null;
  scryfallPriceCents?: number | null;
  storageLocation?: string | null;
  sku?: string | null;
  notes?: string | null;
  status?: InventoryRow["status"];
  imageUrl?: string | null;
  // Printing / identity edits
  scryfallId?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
  cardName?: string | null;
  condition?: string;
  finish?: string;
  actor?: string | null;
}

const STATUSES = new Set(["active", "reserved", "archived"]);
const CONDITIONS = new Set(["NM", "LP", "MP", "HP", "DMG"]);

type Finish = Database["public"]["Enums"]["card_finish"];
type Condition = Database["public"]["Enums"]["card_condition"];

function actorLabel(staff: StaffContext, bodyActor?: string | null): string {
  return (bodyActor && bodyActor.trim()) || staff.email || staff.userId;
}

function readId(req: VercelRequest): string {
  const id = String(req.query.id ?? "");
  if (!id) throw new HttpError(400, "Inventory id is required.");
  return id;
}

/** Fetch the current row or 404. */
async function getRowOr404(
  admin: ReturnType<typeof getSupabaseAdmin>,
  id: string,
): Promise<InventoryRow> {
  const { data, error } = await admin
    .from("inventory_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(500, "Could not load the inventory item.");
  if (!data) throw new HttpError(404, "Inventory item not found.");
  return data as InventoryRow;
}

/**
 * Whether this PATCH is changing the card identity (printing/condition/finish),
 * as opposed to a pure field edit. Any of these keys being present triggers the
 * exact-printing re-resolution + validation path.
 */
function isPrintingEdit(body: Body): boolean {
  return (
    body.scryfallId !== undefined ||
    body.setCode !== undefined ||
    body.collectorNumber !== undefined ||
    body.condition !== undefined ||
    body.finish !== undefined
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "DELETE") return await handleDelete(req, res);
    if (req.method === "PATCH") return await handlePatch(req, res);
    return methodNotAllowed(res, ["PATCH", "DELETE"]);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}

/* ------------------------------------------------------------------ *
 * PATCH
 * ------------------------------------------------------------------ */

async function handlePatch(req: VercelRequest, res: VercelResponse) {
  const staff = await requireStaff(req);
  const id = readId(req);
  const body = (await readJsonBody(req)) as Body;
  const admin = getSupabaseAdmin();

  const current = await getRowOr404(admin, id);

  // 1) Status change routed through the RPC (also writes a movement row).
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) {
      throw new HttpError(400, "Invalid status.");
    }
    const { error } = await admin.rpc("admin_set_inventory_status", {
      p_id: id,
      p_status: body.status,
      p_actor: actorLabel(staff, body.actor),
    });
    if (error) throw new HttpError(500, "Could not update the listing status.");
  }

  // 2) Printing / identity edit (re-resolve + validate + refresh metadata).
  const patch: Database["public"]["Tables"]["inventory_items"]["Update"] = {};

  if (isPrintingEdit(body)) {
    // Target condition + finish (fall back to the row's current values).
    const nextCondition = (
      body.condition !== undefined
        ? String(body.condition).toUpperCase()
        : current.condition
    ) as Condition;
    if (!CONDITIONS.has(nextCondition)) {
      throw new HttpError(400, "A valid condition is required.");
    }

    // Only re-resolve the printing when the identity is actually changing.
    const changingIdentity =
      body.scryfallId !== undefined ||
      body.setCode !== undefined ||
      body.collectorNumber !== undefined;

    let printingCols = null as ReturnType<
      typeof printingColumnsFromCard
    > | null;
    let availableFinishes: Finish[] | null = null;
    let nextScryfallId: string | null = current.scryfall_id;
    let nextSetCode = current.set_code;
    let nextCollector = current.collector_number;

    if (changingIdentity) {
      const card = await scryfallResolveExact({
        scryfallId: body.scryfallId ?? null,
        cardName: body.cardName ?? null,
        setCode: body.setCode ?? null,
        collectorNumber: body.collectorNumber ?? null,
        finish: body.finish ?? current.finish,
      });
      if (!card) {
        throw new HttpError(
          400,
          "Could not resolve that exact printing on Scryfall. Pick the printing again.",
        );
      }
      await cachePrinting(admin, card);
      printingCols = printingColumnsFromCard(card);
      availableFinishes = availableFinishesForCard(card);
      nextScryfallId = printingCols.scryfall_id;
      nextSetCode = printingCols.set_code;
      nextCollector = printingCols.collector_number;
    } else if (body.finish !== undefined && body.finish !== current.finish) {
      // Finish is changing without a printing change: validate the requested
      // finish against the row's CURRENT exact printing (best-effort resolve).
      // If Scryfall can't be reached we don't hard-fail the edit on that alone.
      try {
        const card = await scryfallResolveExact({
          scryfallId: current.scryfall_id,
          cardName: current.card_name,
          setCode: current.set_code,
          collectorNumber: current.collector_number,
          finish: body.finish,
        });
        if (card) availableFinishes = availableFinishesForCard(card);
      } catch {
        /* resolution unavailable — skip finish validation this time */
      }
    }

    // Determine the target finish and constrain it to the printing's finishes.
    let nextFinish = (
      body.finish !== undefined ? String(body.finish) : current.finish
    ) as Finish;
    if (availableFinishes && !availableFinishes.includes(nextFinish)) {
      // If the caller explicitly asked for an unavailable finish, that's a 400.
      if (body.finish !== undefined) {
        throw new HttpError(
          400,
          `This printing isn't available in ${nextFinish}. Choose one of: ${availableFinishes.join(
            ", ",
          )}.`,
        );
      }
      // Otherwise (finish untouched but the new printing dropped it), default to
      // the first available finish so the row stays internally consistent.
      nextFinish = availableFinishes[0] ?? ("nonfoil" as Finish);
    }

    // Duplicate-identity guard among OTHER active rows: scryfall_id + condition
    // + finish (or legacy set + collector + condition + finish when no id).
    const dupeQuery = admin
      .from("inventory_items")
      .select("id")
      .neq("id", id)
      .neq("status", "archived")
      .eq("condition", nextCondition)
      .eq("finish", nextFinish)
      .limit(1);
    const dupe = nextScryfallId
      ? await dupeQuery.eq("scryfall_id", nextScryfallId)
      : await dupeQuery
          .eq("set_code", nextSetCode)
          .eq("collector_number", nextCollector);
    if (dupe.error) throw new HttpError(500, "Could not check for duplicates.");
    if ((dupe.data ?? []).length > 0) {
      throw new HttpError(
        409,
        "This exact printing, condition, and finish already exists in inventory. Adjust the existing inventory line instead.",
      );
    }

    // Apply identity + finish/condition. When the printing changed, refresh ALL
    // denormalized metadata together so image/id/set/collector never diverge.
    if (printingCols) {
      patch.scryfall_id = printingCols.scryfall_id;
      patch.oracle_id = printingCols.oracle_id;
      patch.card_name = printingCols.card_name;
      patch.set_code = printingCols.set_code;
      patch.set_name = printingCols.set_name;
      patch.collector_number = printingCols.collector_number;
      patch.rarity = printingCols.rarity ?? "";
      patch.type_line = printingCols.type_line;
      patch.image_url = printingCols.image_url;
      patch.scryfall_price_cents = printingCols.scryfall_price_cents;
      patch.language = printingCols.language;
    }
    patch.condition = nextCondition;
    patch.finish = nextFinish;
    // Keep the legacy foil boolean in sync with the finish.
    patch.foil = nextFinish !== "nonfoil";
  }

  // 3) Plain field edits (never quantity). Only include provided keys.
  if (body.priceCents !== undefined)
    patch.price_cents =
      body.priceCents == null ? null : Math.max(0, Math.round(body.priceCents));
  if (body.costCents !== undefined)
    patch.cost_cents =
      body.costCents == null ? null : Math.max(0, Math.round(body.costCents));
  if (body.scryfallPriceCents !== undefined)
    patch.scryfall_price_cents =
      body.scryfallPriceCents == null
        ? null
        : Math.max(0, Math.round(body.scryfallPriceCents));
  if (body.storageLocation !== undefined)
    patch.storage_location = body.storageLocation;
  if (body.sku !== undefined) patch.sku = body.sku;
  if (body.notes !== undefined) patch.notes = body.notes;
  // An explicit imageUrl only wins when the printing itself wasn't re-resolved
  // (a printing edit already sets the correct image from the exact printing).
  if (body.imageUrl !== undefined && patch.image_url === undefined)
    patch.image_url = body.imageUrl;

  if (Object.keys(patch).length > 0) {
    const { error } = await admin
      .from("inventory_items")
      .update(patch)
      .eq("id", id);
    if (error) {
      // A unique-index violation (23505) means the identity collided despite the
      // pre-check (race). Surface the same friendly conflict.
      if ((error as { code?: string }).code === "23505") {
        throw new HttpError(
          409,
          "This exact printing, condition, and finish already exists in inventory. Adjust the existing inventory line instead.",
        );
      }
      throw new HttpError(500, "Could not save the inventory changes.");
    }
  }

  const fresh = await getRowOr404(admin, id);
  return sendJson(res, 200, fresh as unknown as Record<string, unknown>);
}

/* ------------------------------------------------------------------ *
 * DELETE
 * ------------------------------------------------------------------ */

async function handleDelete(req: VercelRequest, res: VercelResponse) {
  await requireStaff(req);
  const id = readId(req);
  const admin = getSupabaseAdmin();

  // Confirm the row exists (clean 404 rather than a silent no-op).
  await getRowOr404(admin, id);

  // Historical safety: refuse when referenced by orders/carts/scans.
  const blockers = await inventoryDeleteBlockers(admin, id).catch(() => {
    throw new HttpError(500, "Could not verify whether deletion is safe.");
  });
  if (blockers.length > 0) {
    const parts = blockers.map((b) => `${b.count} ${b.table}`).join(", ");
    throw new HttpError(
      409,
      `This card is referenced by ${parts} and can't be permanently deleted. Archive it instead to preserve history.`,
    );
  }

  // Safe to delete. inventory_movements cascades via its FK (ON DELETE CASCADE).
  const { error } = await admin.from("inventory_items").delete().eq("id", id);
  if (error) {
    // A foreign-key violation (23503) means a reference appeared between the
    // check and the delete — surface the same clean conflict.
    if ((error as { code?: string }).code === "23503") {
      throw new HttpError(
        409,
        "This card is referenced by historical records and can't be permanently deleted. Archive it instead.",
      );
    }
    throw new HttpError(500, "Could not delete the inventory item.");
  }

  res.status(204).end();
}