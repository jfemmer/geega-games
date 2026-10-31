import type { VercelRequest } from "@vercel/node";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

/**
 * The signed-in customer behind a request, when the browser sent their
 * Supabase access token ("Authorization: Bearer …"), or null for a guest or
 * a token that isn't valid any more. Verified with Supabase Auth every time
 * (like requireStaff), never decoded locally.
 */
export async function optionalUserId(req: VercelRequest): Promise<string | null> {
  return (await optionalUser(req))?.id ?? null;
}

/** The same, with the account's email (null for an anonymous account). */
export async function optionalUser(req: VercelRequest): Promise<{ id: string; email: string | null } | null> {
  const header = String(req.headers.authorization ?? "");
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === header) return null;
  try {
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email || null };
  } catch {
    return null;
  }
}
