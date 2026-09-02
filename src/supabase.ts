import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Public browser client. ONLY the Supabase publishable key belongs here — it is
// safe to expose and is protected by Row Level Security. Never put a secret key,
// service-role key, or any other secret in a VITE_ variable.
//
// Preferred variable name: VITE_SUPABASE_PUBLISHABLE_KEY.
// We also accept the legacy VITE_SUPABASE_KEY so existing deployments keep
// working until the variable is renamed in Vercel.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_KEY as string | undefined);

// Track configuration so the UI can fail gracefully instead of constructing a
// broken client from empty strings and then erroring mysteriously on first use.
export const isSupabaseConfigured = Boolean(url && key);

if (!isSupabaseConfigured) {
  console.error(
    "Missing Supabase env vars. Add VITE_SUPABASE_URL and " +
      "VITE_SUPABASE_PUBLISHABLE_KEY to your .env (local) and to " +
      "Vercel → Settings → Environment Variables.",
  );
}

// When unconfigured we still export a client-shaped object, but callers should
// check isSupabaseConfigured first (fetchCards does). Using clearly-invalid
// placeholders makes accidental network calls fail fast and obviously.
export const supabase: SupabaseClient = createClient(
  url ?? "https://unconfigured.invalid",
  key ?? "unconfigured",
);
