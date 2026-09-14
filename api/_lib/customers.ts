import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";

// Server-side customer identity helpers.
//
// The canonical customer table (public.customers) is the identity referenced by
// reservations, manual admin entries, newsletter leads, and (later) Auth users.
// Every write here happens with the service_role client inside a Vercel Function
// (never from the browser). Email matching is case-insensitive (citext column),
// so a newsletter lead and a later Auth account collapse onto ONE customer row.
//
// IMPORTANT: syncing a customer here must NEVER create a Supabase Auth account
// and must NEVER subscribe anyone to marketing. It only records identity.

type Admin = SupabaseClient<Database>;

export type CustomerSource =
  Database["public"]["Enums"]["customer_source"];

/**
 * Upsert a customer by email, without duplicating. Uses the admin_upsert_customer
 * RPC (SECURITY DEFINER, gated to service_role/staff) so the case-insensitive
 * conflict + name-preserving merge live in ONE place in the database. Failures
 * are swallowed to a logged warning: a customer-sync hiccup must never break the
 * primary flow (newsletter confirmation, order creation, etc.).
 */
export async function syncCustomer(
  admin: Admin,
  input: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    source?: CustomerSource;
    authUserId?: string | null;
  },
): Promise<void> {
  try {
    const { error } = await admin.rpc("admin_upsert_customer", {
      p_email: input.email,
      p_first_name: input.firstName ?? undefined,
      p_last_name: input.lastName ?? undefined,
      p_source: input.source ?? "newsletter",
      p_auth_user_id: input.authUserId ?? undefined,
    });
    if (error) {
      console.warn("[customers.syncCustomer] upsert failed:", error.message);
    }
  } catch (err) {
    console.warn("[customers.syncCustomer] unexpected error:", err);
  }
}