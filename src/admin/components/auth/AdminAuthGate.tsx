import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "../../../supabase";

// Access gate for the admin dashboard.
//
// Until now /admin was reachable by URL alone. This wraps the dashboard so that:
//   1. an unauthenticated visitor sees a sign-in form (email + password),
//   2. an authenticated NON-admin sees an "access denied" screen (+ sign out),
//   3. only a signed-in admin/staff user sees the dashboard.
//
// The role lives in the Supabase JWT's app_metadata.role — the same source of
// truth the database uses (current_app_role / is_admin / is_staff). It can only
// be set with the service_role key, so it can't be forged from the browser.
// Server endpoints re-check the same role via requireStaff(), so this gate is
// UX + defense-in-depth, not the only line of defense.

const ALLOWED_ROLES = new Set(["staff", "admin"]);

/** Read the app role from a Supabase session, defaulting to 'customer'. */
function roleFromSession(session: Session | null): string {
  const meta = session?.user?.app_metadata as
    | Record<string, unknown>
    | undefined;
  const raw = (meta?.role as string | undefined) ?? "customer";
  return typeof raw === "string" ? raw : "customer";
}

export function AdminAuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <AdminAuthShell>
        <p className="gg-authcard__error">
          Supabase isn’t configured. Set VITE_SUPABASE_URL and
          VITE_SUPABASE_PUBLISHABLE_KEY, then redeploy.
        </p>
      </AdminAuthShell>
    );
  }

  if (loading) {
    return (
      <AdminAuthShell>
        <p className="gg-authcard__muted">Loading…</p>
      </AdminAuthShell>
    );
  }

  if (!session) {
    return <AdminLogin />;
  }

  const role = roleFromSession(session);
  if (!ALLOWED_ROLES.has(role)) {
    return <AdminDenied email={session.user.email ?? null} />;
  }

  return <>{children}</>;
}

/* ------------------------------------------------------------------ *
 * Login form
 * ------------------------------------------------------------------ */

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setError(error.message || "Sign in failed.");
      setBusy(false);
    }
    // On success, onAuthStateChange updates the session and the gate re-renders.
  }

  return (
    <AdminAuthShell>
      <h1 className="gg-authcard__title">Geega Admin</h1>
      <p className="gg-authcard__muted">Sign in to continue.</p>
      <form className="gg-authform" onSubmit={handleSubmit}>
        <label className="gg-authform__field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="gg-authform__field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="gg-authcard__error">{error}</p>}
        <button type="submit" className="gg-authform__submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AdminAuthShell>
  );
}

/* ------------------------------------------------------------------ *
 * Access denied (authenticated but not admin/staff)
 * ------------------------------------------------------------------ */

function AdminDenied({ email }: { email: string | null }) {
  return (
    <AdminAuthShell>
      <h1 className="gg-authcard__title">No admin access</h1>
      <p className="gg-authcard__muted">
        {email ? <>You’re signed in as {email}, but this</> : <>This</>} account
        isn’t authorized for the admin dashboard.
      </p>
      <button
        type="button"
        className="gg-authform__submit"
        onClick={() => supabase.auth.signOut()}
      >
        Sign out
      </button>
    </AdminAuthShell>
  );
}

/* ------------------------------------------------------------------ *
 * Shared centered shell
 * ------------------------------------------------------------------ */

function AdminAuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="gg-authwrap">
      <div className="gg-authcard">{children}</div>
    </div>
  );
}