import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;

if (!url || !key) {
  console.error(
    "Missing Supabase env vars. Add VITE_SUPABASE_URL and VITE_SUPABASE_KEY " +
      "to your .env (local) and to Vercel → Settings → Environment Variables."
  );
}

export const supabase = createClient(url ?? "", key ?? "");