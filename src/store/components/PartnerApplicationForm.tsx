import { useEffect, useRef, useState } from "react";
import { UsStateSelect } from "./UsStateSelect";
import { getAttribution } from "../lib/attributionStore";
import {
  PARTNER_CATEGORIES,
  PARTNER_PROFESSIONS,
  type PartnerCategory,
  type PartnerKind,
  type PartnerProfession,
} from "../lib/partnerTypes";

// The application on /for-stores (kind "store": stores that buy the leads)
// and /referral-partners (kind "referrer": people who send sellers our way).
// POST /api/partner-applications stores it as an application for the owner to
// approve; nothing is shared with anyone until then.

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

const AGREEMENT: Record<PartnerKind, string> = {
  store:
    "My store will follow the partner standards on this page: contact sellers within one business day, make fair, no-pressure offers, use their details only for that offer, and tell Geega Games how it went.",
  referrer:
    "I'll share my referral link only with people who want an offer, and I'll ask before passing anyone's details along.",
};

export default function PartnerApplicationForm({ kind }: { kind: PartnerKind }) {
  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [categories, setCategories] = useState<PartnerCategory[]>([]);
  const [coverage, setCoverage] = useState("");
  const [buysByMail, setBuysByMail] = useState(false);
  const [profession, setProfession] = useState<PartnerProfession | "">("");
  const [notes, setNotes] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [fax, setFax] = useState(""); // honeypot
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const doneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  function toggleCategory(value: PartnerCategory) {
    setCategories((prev) => (prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!businessName.trim() || !contactName.trim()) return setError("Please give your business name and your name.");
    if (!isValidEmail(email)) return setError("Please enter a valid email address.");
    if (!city.trim() || !state) return setError("Please give your city and state.");
    if (kind === "store" && categories.length === 0) return setError("Please choose what your store buys.");
    if (kind === "referrer" && !profession) return setError("Please choose what you do.");
    if (!agreed) {
      return setError(
        kind === "store"
          ? "Please confirm your store will follow the partner standards."
          : "Please confirm you'll only share our link with people who want an offer.",
      );
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/partner-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          businessName,
          contactName,
          email,
          phone,
          website,
          city,
          state,
          categories: kind === "store" ? categories : [],
          coverage: kind === "store" ? coverage : undefined,
          buysByMail: kind === "store" ? buysByMail : undefined,
          profession: kind === "referrer" ? profession : undefined,
          notes,
          agreed,
          attribution: getAttribution() ?? undefined,
          fax,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        throw new Error((body && typeof body.message === "string" && body.message) || "Something went wrong. Please try again.");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="gg-referral-done" ref={doneRef} tabIndex={-1} role="status">
        <h3>Thanks{contactName ? `, ${contactName.split(" ")[0]}` : ""} — we got your application!</h3>
        <p>
          We read every application ourselves and will be in touch by email
          {kind === "referrer" ? " with your personal referral link" : ""}. We emailed you a copy.
        </p>
      </div>
    );
  }

  const id = (name: string) => `pa-${kind}-${name}`;

  return (
    <form className="gg-referral-form" onSubmit={submit} noValidate>
      <div className="gg-form-grid">
        <div className="gg-field">
          <label htmlFor={id("business")}>{kind === "store" ? "Store name" : "Business name"}</label>
          <input
            id={id("business")}
            autoComplete="organization"
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor={id("contact")}>Your name</label>
          <input
            id={id("contact")}
            autoComplete="name"
            required
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor={id("email")}>Email</label>
          <input
            id={id("email")}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor={id("phone")}>Phone (optional)</label>
          <input id={id("phone")} type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="gg-field">
          <label htmlFor={id("city")}>City</label>
          <input
            id={id("city")}
            autoComplete="address-level2"
            required
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor={id("state")}>State</label>
          <UsStateSelect id={id("state")} value={state} onChange={setState} />
        </div>
        <div className="gg-field gg-field-span2">
          <label htmlFor={id("website")}>Website or social page (optional)</label>
          <input
            id={id("website")}
            inputMode="url"
            autoComplete="url"
            placeholder="yourstore.com"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>
      </div>

      {kind === "store" ? (
        <>
          <fieldset className="gg-sellcheckgroup">
            <legend>What does your store buy?</legend>
            <div className="gg-sellcheckgroup__grid">
              {PARTNER_CATEGORIES.map((c) => (
                <label key={c.value} className="gg-check">
                  <input
                    type="checkbox"
                    checked={categories.includes(c.value)}
                    onChange={() => toggleCategory(c.value)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="gg-field">
            <label htmlFor={id("coverage")}>Where do you meet sellers? (optional)</label>
            <textarea
              id={id("coverage")}
              rows={2}
              maxLength={1000}
              placeholder="e.g. At our store, or anywhere within 30 miles of downtown St. Louis"
              value={coverage}
              onChange={(e) => setCoverage(e.target.value)}
            />
          </div>
          <label className="gg-check">
            <input type="checkbox" checked={buysByMail} onChange={(e) => setBuysByMail(e.target.checked)} />
            We also buy by mail from anywhere in the US
          </label>
        </>
      ) : (
        <div className="gg-field">
          <label htmlFor={id("profession")}>What do you do?</label>
          <select
            id={id("profession")}
            value={profession}
            onChange={(e) => setProfession(e.target.value as PartnerProfession | "")}
          >
            <option value="">Select one</option>
            {PARTNER_PROFESSIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="gg-field">
        <label htmlFor={id("notes")}>Anything else we should know? (optional)</label>
        <textarea
          id={id("notes")}
          rows={3}
          maxLength={2000}
          placeholder={
            kind === "store"
              ? "e.g. How you usually buy collections, typical turnaround, anything you don't buy"
              : "e.g. How often you come across collections, the area you work in"
          }
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* Honeypot — hidden from people and screen readers. */}
      <div className="gg-referral-hp" aria-hidden="true">
        <label htmlFor={id("fax")}>Fax</label>
        <input id={id("fax")} tabIndex={-1} autoComplete="off" value={fax} onChange={(e) => setFax(e.target.value)} />
      </div>

      <label className="gg-check gg-referral-consent">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>{AGREEMENT[kind]}</span>
      </label>

      {error && (
        <p className="gg-alert gg-alert-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="gg-btn" disabled={submitting}>
        {submitting ? "Sending…" : kind === "store" ? "Apply to be a partner store" : "Apply to be a referral partner"}
      </button>
    </form>
  );
}
