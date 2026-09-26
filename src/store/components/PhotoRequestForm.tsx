import { useEffect, useRef, useState } from "react";
import {
  PHOTO_REQUEST_MAX_NOTE,
  PHOTO_REQUEST_REPLY_HOURS,
} from "../lib/photoRequestTypes";

// "Request a photo" on a card page: the shopper asks to see the actual copy
// of one listing (the storefront shows stock images). POST /api/photo-requests;
// staff answer from the admin Inventory → Photo requests tab and the photos
// arrive by email.

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function PhotoRequestForm({
  inventoryItemId,
  listingLabel,
  cardPath,
  defaultEmail,
  onClose,
}: {
  inventoryItemId: string;
  /** "Commander Masters #395 · Near Mint · foil" */
  listingLabel: string;
  cardPath: string;
  defaultEmail?: string | null;
  onClose: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string; duplicate: boolean } | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || !isValidEmail(email)) {
      setError("Please enter your first name and a valid email so we can send the photo.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/photo-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventoryItemId, firstName, email, note, cardPath, website }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        throw new Error(
          (body && typeof body.message === "string" && body.message) || "Something went wrong. Please try again.",
        );
      }
      setDone({ reference: String(body.referenceNumber), duplicate: Boolean(body.duplicate) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="gg-photoreq-form gg-photoreq-form--done" ref={doneRef} tabIndex={-1} role="status">
        <p>
          <strong>{done.duplicate ? "We already have your request." : "Request sent!"}</strong> We&rsquo;ll email a
          photo of this exact card to <strong>{email.trim()}</strong> within {PHOTO_REQUEST_REPLY_HOURS} hours.
        </p>
        <p className="gg-card-meta">Reference: {done.reference}</p>
        <button type="button" className="gg-btn gg-btn-ghost gg-btn-sm" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  return (
    <form className="gg-photoreq-form" onSubmit={submit} noValidate aria-label="Request a photo of this card">
      <p className="gg-photoreq-form__intro">
        We&rsquo;ll photograph <strong>this exact copy</strong> ({listingLabel}) and email it to you within{" "}
        {PHOTO_REQUEST_REPLY_HOURS} hours.
      </p>
      <div className="gg-photoreq-form__grid">
        <div className="gg-field">
          <label htmlFor={`pr-first-${inventoryItemId}`}>First name</label>
          <input
            id={`pr-first-${inventoryItemId}`}
            ref={firstFieldRef}
            autoComplete="given-name"
            required
            maxLength={100}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor={`pr-email-${inventoryItemId}`}>Email</label>
          <input
            id={`pr-email-${inventoryItemId}`}
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>
      <div className="gg-field">
        <label htmlFor={`pr-note-${inventoryItemId}`}>Anything specific? (optional)</label>
        <input
          id={`pr-note-${inventoryItemId}`}
          maxLength={PHOTO_REQUEST_MAX_NOTE}
          placeholder="e.g. the back corners, or the foil under light"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {/* Honeypot — hidden from people and screen readers. */}
      <div className="gg-referral-hp" aria-hidden="true">
        <label htmlFor={`pr-website-${inventoryItemId}`}>Website</label>
        <input
          id={`pr-website-${inventoryItemId}`}
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      {error && (
        <p className="gg-alert gg-alert-error" role="alert">
          {error}
        </p>
      )}
      <div className="gg-photoreq-form__actions">
        <button type="submit" className="gg-btn gg-btn-sm" disabled={submitting}>
          {submitting ? "Sending…" : "Send request"}
        </button>
        <button type="button" className="gg-btn gg-btn-ghost gg-btn-sm" onClick={onClose} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
