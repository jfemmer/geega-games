import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ServerEnv } from "./env.js";
import type { Database } from "../../src/types/database.js";

// A privileged Supabase client for use ONLY inside server-side Vercel Functions.
// It uses the Supabase secret key (service_role), which bypasses RLS. This must
// never be imported by browser code. It is created lazily so functions that do
// not touch the database do not require the secret at cold start.
let cached: SupabaseClient<Database> | null = null;

export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (cached) return cached;
  cached = createClient<Database>(
    ServerEnv.supabaseUrl(),
    ServerEnv.supabaseSecretKey(),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "X-Client-Info": "geega-api" } },
    },
  );
  return cached;
}
