import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { SELL_PHOTOS_BUCKET } from "./sell.js";

// Tidying up after a buying lead or partner lead is deleted (see
// api/admin/sell-submissions/[id].ts and api/admin/referral-leads/[id].ts).
// The lead's database row is gone by the time these run, so both are
// best-effort: a failure is logged, never reported as a failed delete.

/** Deletes the seller's photos from the private sell-photos bucket. */
export async function removeLeadPhotos(paths: string[], leadLabel: string): Promise<void> {
  const unique = [...new Set(paths.filter((p) => typeof p === "string" && p.length > 0))];
  if (unique.length === 0) return;
  try {
    const { error } = await getSupabaseAdmin().storage.from(SELL_PHOTOS_BUCKET).remove(unique);
    if (error) console.error(`[leadCleanup] photos for ${leadLabel} not removed:`, error.message);
  } catch (err) {
    console.error(`[leadCleanup] photos for ${leadLabel} not removed:`, err);
  }
}

/**
 * Drops read/dismissed state for the lead's bell notifications
 * (keys like "buying_lead:new:<id>" or "partner_lead:new:<id>").
 */
export async function forgetLeadNotifications(kind: "buying_lead" | "partner_lead", id: string): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin()
      .from("admin_notification_state")
      .delete()
      .like("notification_key", `${kind}:%:${id}`);
    if (error) console.error(`[leadCleanup] notification state for ${kind} ${id} not removed:`, error.message);
  } catch (err) {
    console.error(`[leadCleanup] notification state for ${kind} ${id} not removed:`, err);
  }
}
