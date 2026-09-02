import { useState, type FormEvent } from "react";

type Status =
  | "idle"
  | "submitting"
  | "sent" // confirmation email sent
  | "validation_error"
  | "server_error";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupForm() {
  const [email, setEmail] = useState("");
  // Honeypot field. Real users never see or fill it; bots often do.
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const submitting = status === "submitting";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();

    if (!EMAIL_RE.test(value)) {
      setStatus("validation_error");
      setMessage("Please enter a valid email address.");
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value, website, source: "storefront" }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        message?: string;
      };

      if (res.ok && data.ok) {
        setStatus("sent");
        setEmail("");
        return;
      }

      if (res.status === 400 || data.status === "validation_error") {
        setStatus("validation_error");
        setMessage(data.message ?? "Please enter a valid email address.");
        return;
      }

      setStatus("server_error");
      setMessage(
        data.message ?? "Something went wrong. Please try again shortly.",
      );
    } catch {
      setStatus("server_error");
      setMessage("We couldn’t reach the server. Please try again shortly.");
    }
  }

  if (status === "sent") {
    return (
      <div className="signup">
        <div className="confirmed" role="status" aria-live="polite">
          <div className="check" aria-hidden="true">
            ✓
          </div>
          <div>
            <h3>Check your inbox</h3>
            <p>
              We’ve sent a confirmation link to your email. Click it to finish
              signing up and we’ll notify you the moment the shop opens.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isError = status === "validation_error" || status === "server_error";

  return (
    <form className="signup" onSubmit={handleSubmit} noValidate>
      <h2>Get the launch notice</h2>
      <p className="signup-sub">
        Browsing is open now. Join the list and we’ll email you the moment
        checkout goes live — no spam, just the launch.
      </p>

      <div className="field">
        <label htmlFor="signup-email" className="visually-hidden">
          Email address
        </label>
        <input
          id="signup-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (isError) {
              setStatus("idle");
              setMessage("");
            }
          }}
          disabled={submitting}
          aria-invalid={status === "validation_error"}
          aria-describedby="signup-note"
          required
        />

        {/* Honeypot: hidden from users + assistive tech, catches bots. */}
        <div className="hp-field" aria-hidden="true">
          <label htmlFor="signup-website">Leave this field empty</label>
          <input
            id="signup-website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        <button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Notify me"}
        </button>
      </div>

      <p
        id="signup-note"
        className={`note ${isError ? "error" : ""}`}
        role={isError ? "alert" : "status"}
        aria-live={isError ? "assertive" : "polite"}
      >
        {message}
      </p>
    </form>
  );
}
