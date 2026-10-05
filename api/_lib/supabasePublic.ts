import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ServerEnv } from "./env.js";
import type { Database } from "../../src/types/database.js";

// A Supabase client with exactly the access a signed-out visitor's browser
// has: the publishable (anon) key, so row-level security applies.
//
// For functions that answer a public page with public data. Using this rather
// than the service-role client (supabaseAdmin.ts) means such a function can
// only ever say what the storefront itself would show that visitor — it
// reads through the same policies, so the two can't disagree.
let cached: SupabaseClient<Database> | null = null;

export function getSupabasePublic(): SupabaseClient<Database> {
  if (cached) return cached;
  // The same key the browser bundle is built with; SUPABASE_ANON_KEY is the
  // optional server-side name for it (see the other functions that use it).
  const key = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!key) {
    throw new Error("Missing required server environment variable: VITE_SUPABASE_PUBLISHABLE_KEY");
  }
  cached = createClient<Database>(ServerEnv.supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "geega-api-public" } },
  });
  return cached;
}
