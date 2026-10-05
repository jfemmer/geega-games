import { useEffect, useRef, useState, type FormEvent } from "react";

// The email list signup on the home page: one email field, then a
// confirmation link by email (double opt-in — see api/_lib/subscribers.ts).
//
// Every line of copy here is a promise about what we send, so keep it to what
// the shop really does: newly listed cards, price drops and sales (Deals &
// Specials, storewide sales) and one-off offers. The two emails a subscriber
// gets say the same thing (api/_lib/emails/ConfirmSubscription.ts and
// SubscriptionConfirmed.ts) — change them together.

type Status =
  | "idle"
  | "submitting"
  | "sent" // confirmation email sent
  | "validation_error"
  | "server_error";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What subscribers hear about. */
const LIST_PERKS: { title: string; body: string }[] = [
  {
    title: "New arrivals and restocks.",
    body: "Often a single copy, so it pays to see them first.",
  },
  {
    title: "Discounts and sales.",
    body: "Price drops, storewide sales and new Deals & Specials.",
  },
  {
    title: "Crazy deals.",
    body: "The occasional offer that won’t last long.",
  },
];

export default function SignupForm() {
  const [email, setEmail] = useState("");
  // Honeypot field. Real users never see or fill it; bots often do.
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const confirmedRef = useRef<HTMLDivElement>(null);

  const submitting = status === "submitting";
  const sent = status === "sent";

  // The "check your inbox" message takes the place of the email field, so it
  // shows up right where the visitor was typing — on a phone the top of the
  // box is usually scrolled up behind the header by then. Moving focus to it
  // lets screen readers read it out; the field that had focus is gone.
  useEffect(() => {
    if (sent) confirmedRef.current?.focus({ preventScroll: true });
  }, [sent]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (sent) return;
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
        body: JSON.stringify({ email: value, hp_ref: website, source: "storefront" }),
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

  const isError = status === "validation_error" || status === "server_error";

  return (
    <form className="signup" onSubmit={handleSubmit} noValidate aria-labelledby="signup-title">
      <h2 id="signup-title">Join the email list</h2>
      <p className="signup-sub">
        New arrivals, discounts and crazy deals, straight to your inbox.
      </p>

      <ul className="signup-points">
        {LIST_PERKS.map((perk) => (
          <li key={perk.title}>
            <span>
              <strong>{perk.title}</strong> {perk.body}
            </span>
          </li>
        ))}
      </ul>

      {sent ? (
        <div className="confirmed" role="status" aria-live="polite" tabIndex={-1} ref={confirmedRef}>
          <div className="check" aria-hidden="true">
            ✓
          </div>
          <div>
            <h3>Check your inbox</h3>
            <p>
              We’ve sent a confirmation link to your email. Click it to finish
              joining the list. If you don’t see it in a few minutes, check
              your spam folder.
            </p>
          </div>
        </div>
      ) : (
        <>
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
              aria-describedby="signup-note signup-fine"
              required
            />

            {/* Honeypot: hidden from users + assistive tech, catches bots.
                Named 'hp_ref' (not 'website'/'email'/'name') so browser autofill
                and password managers do not populate it for real users. */}
            <div className="hp-field" aria-hidden="true">
              <label htmlFor="signup-hp-ref">Do not fill this in</label>
              <input
                id="signup-hp-ref"
                name="hp_ref"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>

            <button type="submit" disabled={submitting}>
              {submitting ? "Joining…" : "Join the list"}
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

          <p id="signup-fine" className="signup-fine">
            No spam — only when there’s something worth opening. We never sell your
            email, and you can unsubscribe any time.
          </p>
        </>
      )}
    </form>
  );
}
