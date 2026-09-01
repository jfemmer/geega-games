/**
 * client.ts — Supabase client for the browser (Client Components).
 * Uses the anon key only. Safe to ship to the browser. RLS enforces access.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
