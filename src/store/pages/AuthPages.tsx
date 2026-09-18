import { useCallback, useState, type FormEvent } from "react";
import { useAuth } from "../lib/AuthContext";
import { Link, useRouter } from "../lib/router";
import GoogleAddressAutocomplete, {
  type ShippingAddressFields,
} from "../components/GoogleAddressAutocomplete";

function AuthShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="gg-page">
      <h1 style={{ textAlign: "center", color: "var(--gg-ink)" }}>{title}</h1>
      {children}
    </div>
  );
}

export function LoginPage() {
  const { signIn } = useAuth();
  const { navigate, query } = useRouter();
  const next = query.get("next") || "/account";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await signIn(email, password);
      navigate(next);
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
          {" · "}
          <Link to="/signup">Create account</Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const { signUp } = useAuth();
  const { navigate } = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notificationsOptIn, setNotificationsOptIn] = useState(false);
  const [shippingAddress, setShippingAddress] = useState<ShippingAddressFields>({
    line1: "",
    line2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "US",
  });
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleAddressSelect = useCallback((address: ShippingAddressFields) => {
    setShippingAddress((current) => ({
      ...address,
      line2: address.line2 || current.line2,
      country: address.country || "US",
    }));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (password.length < 6) {
      setErr("Please choose a password with at least 6 characters.");
      return;
    }
    if (
      !shippingAddress.line1.trim() ||
      !shippingAddress.city.trim() ||
      !shippingAddress.state.trim() ||
      !shippingAddress.postalCode.trim() ||
      !shippingAddress.country.trim()
    ) {
      setErr("Please add a complete shipping address before creating your account.");
      return;
    }
    setBusy(true);
    try {
      const { needsEmailConfirmation } = await signUp({
        email,
        password,
        firstName,
        lastName,
        notificationsOptIn,
        shippingAddress,
      });
      if (needsEmailConfirmation) {
        setMsg(
          "Check your email to confirm your account, then sign in. You can close this tab.",
        );
      } else {
        navigate("/account");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign up failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your account">
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
        <div className="gg-field">
          <label>Shipping address</label>
          <GoogleAddressAutocomplete onSelect={handleAddressSelect} />
        </div>
        <div className="gg-form-grid gg-signup-address-grid">
          <div className="gg-field gg-field-span2">
            <label htmlFor="su-address1">Street address</label>
            <input
              id="su-address1"
              autoComplete="shipping address-line1"
              required
              value={shippingAddress.line1}
              onChange={(e) =>
                setShippingAddress((address) => ({ ...address, line1: e.target.value }))
              }
            />
          </div>
          <div className="gg-field gg-field-span2">
            <label htmlFor="su-address2">Apartment, suite, etc. (optional)</label>
            <input
              id="su-address2"
              autoComplete="shipping address-line2"
              value={shippingAddress.line2}
              onChange={(e) =>
                setShippingAddress((address) => ({ ...address, line2: e.target.value }))
              }
            />
          </div>
          <div className="gg-field">
            <label htmlFor="su-city">City</label>
            <input
              id="su-city"
              autoComplete="shipping address-level2"
              required
              value={shippingAddress.city}
              onChange={(e) =>
                setShippingAddress((address) => ({ ...address, city: e.target.value }))
              }
            />
          </div>
          <div className="gg-field">
            <label htmlFor="su-state">State</label>
            <input
              id="su-state"
              autoComplete="shipping address-level1"
              required
              value={shippingAddress.state}
              onChange={(e) =>
                setShippingAddress((address) => ({ ...address, state: e.target.value }))
              }
            />
          </div>
          <div className="gg-field">
            <label htmlFor="su-postal">ZIP / postal code</label>
            <input
              id="su-postal"
              autoComplete="shipping postal-code"
              required
              value={shippingAddress.postalCode}
              onChange={(e) =>
                setShippingAddress((address) => ({ ...address, postalCode: e.target.value }))
              }
            />
          </div>
          <div className="gg-field">
            <label htmlFor="su-country">Country</label>
            <input
              id="su-country"
              autoComplete="shipping country"
              required
              value={shippingAddress.country}
              onChange={(e) =>
                setShippingAddress((address) => ({ ...address, country: e.target.value }))
              }
            />
          </div>
        </div>
        <label className="gg-check" style={{ margin: "0.25rem 0 0" }}>
          <input
            type="checkbox"
            checked={notificationsOptIn}
            onChange={(e) => setNotificationsOptIn(e.target.checked)}
          />
          Email me about my order &amp; shipping status and Sell Your Cards submission
          updates
        </label>
        <button className="gg-btn" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>
        <p className="gg-card-meta" style={{ textAlign: "center" }}>
          These notifications are off by default and you can turn them on or off
          any time from your account. Creating an account does not sign you up
          for marketing email — you can subscribe separately any time.
        </p>
        <div style={{ textAlign: "center", fontSize: "0.9rem" }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </form>
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
