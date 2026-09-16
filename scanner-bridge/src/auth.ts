import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BridgeConfig } from "./config.js";

// Authenticates as a REAL staff user, exactly like the browser does — the
// bridge never holds the Supabase service_role key. Create one dedicated
// staff account for this bridge (e.g. scanner-bridge@yourdomain.com) rather
// than a shared human login, so its API activity is attributable and its
// access can be revoked independently. Every server endpoint the bridge
// calls already requires requireStaff() to pass a valid access token —
// there is no separate/wider bridge-only API surface.

export async function createAuthedClient(
  config: BridgeConfig,
): Promise<{ supabase: SupabaseClient; getAccessToken: () => Promise<string> }> {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email: config.staffEmail,
    password: config.staffPassword,
  });
  if (error) {
    throw new Error(
      `Could not sign in as ${config.staffEmail}: ${error.message}. Confirm this account exists, has a staff role, and the password is correct.`,
    );
  }

  async function getAccessToken(): Promise<string> {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !data.session?.access_token) {
      throw new Error("Lost the Supabase session — the bridge will need to sign in again.");
    }
    return data.session.access_token;
  }

  return { supabase, getAccessToken };
}
