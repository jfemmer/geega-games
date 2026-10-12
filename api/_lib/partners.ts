import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";
import { HttpError } from "./http.js";
import { normalizeEmail } from "./tokens.js";
import {
  isPartnerCategory,
  isPartnerKind,
  isPartnerProfession,
  type PartnerKind,
} from "../../src/store/lib/partnerTypes.js";
import { usStateCode } from "../../src/store/lib/usAddress.js";

// Shared by the admin partner endpoints (api/admin/partners/*): checking the
// editable fields of a partner, and giving a referral partner its personal
// referral code.

type Admin = SupabaseClient<Database>;
export type PartnerUpdate = Database["public"]["Tables"]["partners"]["Update"];

function cleanString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

/** An http(s) address, or a bare domain we turn into one. Anything else is null. */
export function cleanWebsite(v: unknown): string | null {
  const raw = cleanString(v, 300);
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString().slice(0, 300);
  } catch {
    return null;
  }
}

export interface PartnerFieldsInput {
  businessName?: unknown;
  contactName?: unknown;
  email?: unknown;
  phone?: unknown;
  website?: unknown;
  city?: unknown;
  state?: unknown;
  categories?: unknown;
  coverage?: unknown;
  buysByMail?: unknown;
  profession?: unknown;
  feePercent?: unknown;
  internalNotes?: unknown;
}

/**
 * The partner columns an admin edit sets. Only keys present in `input` are
 * returned (a PATCH changes just those); required ones can't be blanked.
 */
export function partnerFieldsFromInput(input: PartnerFieldsInput, kind: PartnerKind): PartnerUpdate {
  const out: PartnerUpdate = {};
  const has = (key: keyof PartnerFieldsInput) => Object.prototype.hasOwnProperty.call(input, key);

  if (has("businessName")) {
    const v = cleanString(input.businessName, 200);
    if (!v) throw new HttpError(400, "Business name can't be empty.");
    out.business_name = v;
  }
  if (has("contactName")) {
    const v = cleanString(input.contactName, 200);
    if (!v) throw new HttpError(400, "Contact name can't be empty.");
    out.contact_name = v;
  }
  if (has("email")) {
    const v = normalizeEmail(input.email);
    if (!v) throw new HttpError(400, "Please enter a valid email.");
    out.email = v;
  }
  if (has("phone")) out.phone = cleanString(input.phone, 30);
  if (has("website")) out.website = cleanWebsite(input.website);
  if (has("city")) out.city = cleanString(input.city, 120);
  if (has("state")) {
    if (input.state === null || input.state === "") out.state = null;
    else {
      const code = usStateCode(input.state);
      if (!code) throw new HttpError(400, "Please choose a US state.");
      out.state = code;
    }
  }
  if (has("categories")) {
    if (!Array.isArray(input.categories)) throw new HttpError(400, "Invalid categories.");
    out.categories = [...new Set(input.categories.filter(isPartnerCategory))];
    if (kind === "store" && out.categories.length === 0) {
      throw new HttpError(400, "Choose at least one thing this store buys.");
    }
  }
  if (has("coverage")) out.coverage = cleanString(input.coverage, 1000);
  if (has("buysByMail")) out.buys_by_mail = input.buysByMail === true;
  if (has("profession")) {
    if (input.profession === null || input.profession === "") out.profession = null;
    else if (isPartnerProfession(input.profession)) out.profession = input.profession;
    else throw new HttpError(400, "Invalid profession.");
  }
  if (has("feePercent")) {
    const n = typeof input.feePercent === "number" ? input.feePercent : Number(input.feePercent);
    if (!Number.isFinite(n) || n < 0 || n > 50) throw new HttpError(400, "The fee must be between 0% and 50%.");
    out.fee_percent = Math.round(n * 100) / 100;
  }
  if (has("internalNotes")) out.internal_notes = cleanString(input.internalNotes, 4000);
  return out;
}

export function requireKind(value: unknown): PartnerKind {
  if (!isPartnerKind(value)) throw new HttpError(400, "Choose partner store or referral partner.");
  return value;
}

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** 8 characters with no look-alikes (no 0/o, 1/l/i), like my_referral_code(). */
export function newReferralCode(): string {
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

/** The referral partner's code, made the first time it's needed. */
export async function ensurePartnerReferralCode(admin: Admin, partnerId: string): Promise<string> {
  const { data: existing, error } = await admin
    .from("referral_codes")
    .select("code")
    .eq("partner_id", partnerId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (existing) return existing.code;

  for (let attempt = 0; attempt < 10; attempt++) {
    const code = newReferralCode();
    const { error: insertErr } = await admin.from("referral_codes").insert({ code, partner_id: partnerId });
    if (!insertErr) return code;
    if (insertErr.code !== "23505") throw new HttpError(500, insertErr.message);
    // Taken: either the code (try another) or this partner got one meanwhile.
    const { data: raced } = await admin.from("referral_codes").select("code").eq("partner_id", partnerId).maybeSingle();
    if (raced) return raced.code;
  }
  throw new HttpError(500, "Couldn't make a referral code. Please try again.");
}
