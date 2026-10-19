import type { VercelRequest } from "@vercel/node";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

/**
 * The signed-in customer behind a request, when the browser sent their
 * Supabase access token ("Authorization: Bearer …"), or null for a guest or
 * a token that isn't valid any more. Verified with Supabase Auth every time
 * (like requireStaff), never decoded locally.
 */
export async function optionalUserId(req: VercelRequest): Promise<string | null> {
  const header = String(req.headers.authorization ?? "");
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === header) return null;
  try {
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    return error || !data.user ? null : data.user.id;
  } catch {
    return null;
  }
}
