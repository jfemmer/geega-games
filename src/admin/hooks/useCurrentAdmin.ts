import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../../supabase";

// Current signed-in staff identity, for labelling inventory movements ("actor").
//
// Reads the real Supabase session (email / user metadata) rather than a mock
// admin. The privileged API also resolves the actor from the verified bearer
// token server-side, so this is used for optimistic UI + the mock fallback; it
// never grants authority on its own.

export interface CurrentAdmin {
  /** Display name: full name if present, else email, else a neutral fallback. */
  name: string;
  email: string | null;
  userId: string | null;
}

const FALLBACK: CurrentAdmin = { name: "Staff", email: null, userId: null };

function fromSessionUser(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): CurrentAdmin {
  const meta = user.user_metadata ?? {};
  const first = (meta.first_name as string | undefined) ?? "";
  const last = (meta.last_name as string | undefined) ?? "";
  const full = `${first} ${last}`.trim();
  const displayName = (meta.name as string | undefined) ?? full;
  return {
    name: displayName || user.email || "Staff",
    email: user.email ?? null,
    userId: user.id,
  };
}

export function useCurrentAdmin(): CurrentAdmin {
  const [admin, setAdmin] = useState<CurrentAdmin>(FALLBACK);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const user = data.session?.user;
      if (user) setAdmin(fromSessionUser(user));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!active) return;
      setAdmin(s?.user ? fromSessionUser(s.user) : FALLBACK);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return admin;
}