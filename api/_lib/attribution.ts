import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";
import { sanitizeAttribution, type AttributionColumns } from "../../src/store/lib/attribution.js";

// Server side of lead attribution (src/store/lib/attribution.ts): cleans what
// a form sent and keeps a ?ref= code only if it belongs to someone who can
// earn from it — a customer account, or an ACTIVE referral partner — and isn't
// the seller themselves. A bad or self-made code is dropped silently: the
// submission still goes through, it just isn't credited to anyone.

type Admin = SupabaseClient<Database>;

export interface SellerIdentity {
  email: string;
  /** Set when the seller is signed in. */
  userId?: string | null;
}

export async function leadAttribution(
  admin: Admin,
  raw: unknown,
  seller: SellerIdentity,
): Promise<AttributionColumns> {
  const columns = sanitizeAttribution(raw);
  if (columns.ref_code) {
    columns.ref_code = await creditableRefCode(admin, columns.ref_code, seller).catch((err) => {
      console.error("[attribution] referral code check failed:", err);
      return null;
    });
  }
  return columns;
}

async function creditableRefCode(admin: Admin, code: string, seller: SellerIdentity): Promise<string | null> {
  const { data: owner, error } = await admin
    .from("referral_codes")
    .select("code, user_id, partner_id")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!owner) return null;
  const sellerEmail = seller.email.trim().toLowerCase();

  if (owner.user_id) {
    if (seller.userId && seller.userId === owner.user_id) return null;
    const { data: user, error: userErr } = await admin.auth.admin.getUserById(owner.user_id);
    if (userErr) throw new Error(userErr.message);
    const ownerEmail = user?.user?.email?.trim().toLowerCase();
    if (ownerEmail && ownerEmail === sellerEmail) return null;
    return owner.code;
  }

  if (owner.partner_id) {
    const { data: partner, error: partnerErr } = await admin
      .from("partners")
      .select("kind, status, email")
      .eq("id", owner.partner_id)
      .maybeSingle();
    if (partnerErr) throw new Error(partnerErr.message);
    if (!partner || partner.kind !== "referrer" || partner.status !== "active") return null;
    if (partner.email.trim().toLowerCase() === sellerEmail) return null;
    return owner.code;
  }

  return null;
}
