import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BridgeConfig } from "./config.js";

// Authenticates as a REAL staff user, exactly like the browser does — the
// bridge never holds the Supabase service_role key. Create one dedicated
// staff account for this bridge (e.g. scanner-bridge@yourdomain.com) rather
// than a shared human login, so its API activity is attributable and its
// access can be revoked independently. Every server endpoint the bridge
// calls already requires requireStaff() to pass a valid access token —
// there is no separate/wider bridge-only API surface.

/** A failed sign-in. `network` when Supabase couldn't be reached (worth retrying soon). */
export class SignInError extends Error {
  readonly network: boolean;
  constructor(message: string, network: boolean) {
    super(message);
    this.name = "SignInError";
    this.network = network;
  }
}

export interface AuthedClient {
  supabase: SupabaseClient;
  getAccessToken: () => Promise<string>;
}

export async function createAuthedClient(config: BridgeConfig): Promise<AuthedClient> {
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
    // Supabase reports "couldn't reach the server" (no connection, DNS, an
    // outage) as a retryable fetch error with status 0 or 5xx.
    const network =
      error.name === "AuthRetryableFetchError" ||
      error.status === 0 ||
      (typeof error.status === "number" && error.status >= 500);
    throw new SignInError(
      network
        ? `Couldn't reach Supabase to sign in as ${config.staffEmail} (${error.message}). Check this PC's internet connection.`
        : `Could not sign in as ${config.staffEmail}: ${error.message}. Confirm this account exists, has a staff role, and the password in .env is correct, then restart the bridge.`,
      network,
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
