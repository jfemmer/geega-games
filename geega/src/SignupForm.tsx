import { useState, type FormEvent } from "react";

type Status = "idle" | "submitting" | "error" | "confirmed";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();

    if (!EMAIL_RE.test(value)) {
      setStatus("error");
      setMessage("Enter a valid email address.");
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      // ─────────────────────────────────────────────────────────────
      // BACKEND STUB — frontend only for now.
      // When the backend is ready, replace this block with:
      //
      //   const res = await fetch("/api/subscribe", {
      //     method: "POST",
      //     headers: { "Content-Type": "application/json" },
      //     body: JSON.stringify({ email: value }),
      //   });
      //   if (!res.ok) throw new Error((await res.json()).message);
      //
      // The /api/subscribe function will write to Supabase and send
      // the welcome email via Resend. Nothing else in this file changes.
      // ─────────────────────────────────────────────────────────────
      await new Promise((r) => setTimeout(r, 700)); // simulate network

      setStatus("confirmed");
      setEmail("");
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
    }
  }

  if (status === "confirmed") {
    return (
      <div className="confirmed" role="status">
        <div className="check" aria-hidden="true">✓</div>
        <div>
          <h3>You’re on the list</h3>
          <p>
            We’ll email you the moment the shop opens and payment
            processing goes live. No spam, just the launch.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form className="signup" onSubmit={handleSubmit} noValidate>
      <h2>Get the launch notice</h2>
      <div className="field">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          aria-label="Email address"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === "error") {
              setStatus("idle");
              setMessage("");
            }
          }}
          disabled={status === "submitting"}
        />
        <button type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? "Adding…" : "Notify me"}
        </button>
      </div>
      <p className={`note ${status === "error" ? "error" : ""}`}>
        {message}
      </p>
    </form>
  );
}
