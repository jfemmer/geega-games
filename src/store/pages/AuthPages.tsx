import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../lib/AuthContext";
import { Link, useRouter } from "../lib/router";
import { rememberSignupNext, safeNextPath, takeSignupNext } from "../lib/authRedirect";
import { AccountPerksList } from "../components/AccountPerks";
import { parseClaimParam } from "../lib/guestClaims";

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="gg-page">
      <h1 style={{ textAlign: "center", color: "var(--gg-ink)" }}>{title}</h1>
      {subtitle && <p className="gg-auth-subtitle">{subtitle}</p>}
      {children}
    </div>
  );
}

/** `?next=` to hand on to the sibling auth page, if there is one. */
function withNext(base: string, next: string | null): string {
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

export function LoginPage() {
  const { signIn, user } = useAuth();
  const { navigate, query } = useRouter();
  const rawNext = query.get("next");

  // Once signed in — by this form, or by the email-confirmation link, which
  // lands here and signs the visitor in from the URL — move on. An explicit
  // ?next= wins; otherwise pick up where they were when they signed up.
  useEffect(() => {
    if (!user) return;
    const remembered = takeSignupNext();
    navigate(safeNextPath(rawNext ?? remembered), { replace: true });
  }, [user, rawNext, navigate]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await signIn(email, password); // the effect above navigates
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in">
      <form className="gg-form" onSubmit={submit} noValidate>
        {err && (
          <div className="gg-alert gg-alert-error" role="alert" aria-live="assertive">
            {err}
          </div>
        )}
        <div className="gg-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="gg-btn" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div style={{ textAlign: "center", fontSize: "0.9rem" }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <div className="gg-auth-alt">
          New to Geega Games?{" "}
          <Link to={withNext("/signup", rawNext)}>Create a free account</Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const { signUp } = useAuth();
  const { navigate, query } = useRouter();
  // Arriving from a guest order / sell submission email: ?claim=… (already
  // remembered by AuthContext, and linked on sign-in) and ?email=….
  const claimKind = parseClaimParam(query.get("claim"))?.kind ?? null;
  const rawNext =
    query.get("next") ??
    (claimKind === "order" ? "/account/orders" : claimKind === "sell" ? "/account/sell-submissions" : null);
  const next = safeNextPath(rawNext);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState(() => query.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (password.length < 6) {
      setErr("Please choose a password with at least 6 characters.");
      return;
    }
    setBusy(true);
    if (rawNext) rememberSignupNext(next);
    try {
      const { needsEmailConfirmation } = await signUp({
        email,
        password,
        firstName,
        lastName,
      });
      if (needsEmailConfirmation) {
        setMsg(
          "Check your email to confirm your account, then sign in. You can close this tab.",
        );
      } else {
        takeSignupNext(); // signed straight in — nothing to pick up later
        navigate(next);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign up failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your free account"
      subtitle={
        claimKind === "order"
          ? "Create your account and we'll save your order to it."
          : claimKind === "sell"
            ? "Create your account and we'll add your sell submission to it."
            : rawNext === "/checkout"
              ? "Saves your address for next time — we'll bring you right back to your cart."
              : "Takes about a minute. Here's what you get:"
      }
    >
      <div className="gg-signup-layout">
      <aside className="gg-signup-perks" aria-label="Account benefits">
        <AccountPerksList />
      </aside>
      <form className="gg-form" onSubmit={submit} noValidate>
        {err && (
          <div className="gg-alert gg-alert-error" role="alert" aria-live="assertive">
            {err}
          </div>
        )}
        {msg && (
          <div className="gg-alert gg-alert-ok" role="status" aria-live="polite">
            {msg}
          </div>
        )}
        <div className="gg-field">
          <label htmlFor="fn">First name</label>
          <input
            id="fn"
            autoComplete="given-name"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="ln">Last name</label>
          <input
            id="ln"
            autoComplete="family-name"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="su-email">Email</label>
          <input
            id="su-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="su-pw">Password</label>
          <input
            id="su-pw"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="gg-btn" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>
        <p className="gg-card-meta" style={{ textAlign: "center" }}>
          We&rsquo;ll email you shipping and tracking updates for your orders and
          any cards you sell us — change that any time under Account &rsaquo;
          Notifications. No marketing email unless you subscribe separately.
          Your shipping address is asked for at checkout.
        </p>
        <div style={{ textAlign: "center", fontSize: "0.9rem" }}>
          Already have an account? <Link to={withNext("/login", rawNext)}>Sign in</Link>
        </div>
      </form>
      </div>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setMsg(
        "If an account exists for that email, a password reset link is on its way.",
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send reset email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Reset your password">
      <form className="gg-form" onSubmit={submit} noValidate>
        {err && (
          <div className="gg-alert gg-alert-error" role="alert">
            {err}
          </div>
        )}
        {msg && (
          <div className="gg-alert gg-alert-ok" role="status">
            {msg}
          </div>
        )}
        <div className="gg-field">
          <label htmlFor="fp-email">Email</label>
          <input
            id="fp-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button className="gg-btn" type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
        <div style={{ textAlign: "center", fontSize: "0.9rem" }}>
          <Link to="/login">Back to sign in</Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const { navigate } = useRouter();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (password.length < 6) {
      setErr("Please choose a password with at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setMsg("Password updated. Redirecting…");
      window.setTimeout(() => navigate("/account"), 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Choose a new password">
      <form className="gg-form" onSubmit={submit} noValidate>
        {err && (
          <div className="gg-alert gg-alert-error" role="alert">
            {err}
          </div>
        )}
        {msg && (
          <div className="gg-alert gg-alert-ok" role="status">
            {msg}
          </div>
        )}
        <div className="gg-field">
          <label htmlFor="rp-pw">New password</label>
          <input
            id="rp-pw"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="gg-btn" type="submit" disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>
    </AuthShell>
  );
}
