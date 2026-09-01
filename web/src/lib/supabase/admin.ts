/**
 * admin.ts — Supabase SERVICE ROLE client. BYPASSES RLS.
 *
 * DANGER: The service role key grants full database access. This file must be
 * imported ONLY from server-side code (route handlers, server actions, webhook
 * handlers, background jobs). It must NEVER be imported into a Client Component
 * or anything bundled for the browser.
 *
 * The `import 'server-only'` guard makes the build FAIL if this is ever pulled
 * into a client bundle.
 *
 * Use this only for privileged operations that legitimately need to bypass RLS:
 *   - verified Stripe/PayPal webhook -> mark_order_paid()
 *   - scanner ingest -> writing scanner_* rows and Storage uploads
 *   - trusted admin server routes
 * Prefer the RPCs (which self-guard on role) over ad-hoc table writes.
 */
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'createAdminClient: missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL'
    );
  }

  return createClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
